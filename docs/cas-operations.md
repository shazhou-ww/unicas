# CAS Middleware Operations

Runbooks, SLOs, and alerting for the independently deployed CAS middleware
(the `@unicas` packages in `packages/`). Production topology:

| Component | Worker / resource | Notes |
|---|---|---|
| UniCAS service (public) | `unicas` | Single `@unicas/service-cloudflare` Worker for `/v2/apps`, `/admin`, MCP/OAuth, and admin UI |
| OAuth KV | dedicated `OAUTH_KV` namespace | OAuth clients, grants, token hashes, and encrypted authorization transactions |
| Control D1 | `unicas-control` (`3a64d58d-…`) | Apps, issuers, members, and audit; physical tables still use Stack names |
| Data D1 | `unicas-tenant` (`c3924c96-…`) | App/Space nodes, edges, and Root Refs; resource name is a physical compatibility identifier |
| R2 | `unicas-content`, `unicas-content-preview` | node content |

Secrets live only as Worker secrets (Google OIDC client secret,
`SESSION_ENCRYPTION_KEYS`, `OAUTH_STATE_ENCRYPTION_KEY`,
`CAS_AUDIT_READER_KEY`, managed issuer private keys) — never
in vars or source. Deployment credentials are supplied through
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`; see
[Deployment and local configuration](deployment-and-local-configuration.md).

## SLOs and error budgets

| SLO | Target | Measurement | Error budget (30d) |
|---|---|---|---|
| Service availability | 99.9% | `/health` + Space/admin request success | 43.8 min |
| Space + admin availability | 99.9% | `/v2/apps` + `/admin` success | 43.8 min |
| Service p95 latency (live) | < 500 ms | Worker request duration | — |
| Space node read p95 (cached/DB) | < 200 ms | node metadata/content reads | — |
| Key rotation effectiveness | new key ≤ 60 s, revoked key ≤ 60 s | JWKS cache bounds (30 s TTL / 60 s hard stale) | — |
| Backup freshness | RPO ≤ 24 h | last successful D1 export timestamp | — |
| Restore | RTO ≤ 30 min | restore drill from exported SQL | — |

Error-budget burn: alert at 5% of monthly budget consumed per rolling 24 h,
page at 15%. Availability is measured from the unified service (`/health` plus
a routed probe like the live smoke's lease+read).

## Metrics and events

Existing structured logs (JSON to the worker's stdout, queryable via the
Cloudflare dashboard / logpush):

- `cas_app_authorization` — App/Space v2 authorization decisions.
- `cas_stack_authorization` — retained v1 telemetry identifier. Both events use `kind` ∈
   `authorized`, `rejected`, `fail_closed`, `registry_stale`. **`fail_closed`
   is an incident signal** (registry unreachable past the hard bound, or a cold
   outage). Rejected requests carry stable capability error codes such as
   `unknown_issuer` and `registry_unavailable` in their HTTP responses.
- `admin_oidc_callback_failed` — administrator login callback failures with a
   bounded reason and no token material.

Roll-up per 5-min window (via CF Analytics API or a logpush consumer):
service request count + 5xx rate, Space 401/403 rate by error code
(`invalid_token`, `unknown_issuer`, `registry_unavailable`,
`resource_scope_mismatch`), admin OIDC failures, D1 export success/failure.

## Alerting rules

| Alert | Condition | Severity | Response |
|---|---|---|---|
| Service 5xx rate | > 1% of requests over 5 min | P1 | Check `wrangler deployments list` for `unicas`; rollback if a recent deploy regressed |
| `fail_closed` burst | either authorization event kind=`fail_closed` ≥ 3 in 5 min | P1 | D1 reachability from the service Worker; registry row integrity |
| `registry_unavailable` 401/403 rate | > 0.5% of Space requests over 5 min | P1 | Same as above |
| Unknown-issuer spike | `unknown_issuer` > threshold after a rotation | P2 | Issuer active? discovery still resolves to the expected `jwks_uri`? |
| Key age | any active issuer key older than 90 days | P2 | Run the rotation drill |
| Backup failure | scheduled D1 export fails | P2 | Re-run export; verify file non-empty (`--remote`!) |
| Admin OIDC failures | login error rate > threshold | P2 | Google client config, redirect URI, session keys |

## Runbooks

### Deploy

UniCAS has one deployment unit. **Always rebuild first** because Wrangler
uploads `dist/` and stale output silently deploys old code:

```text
pnpm deploy:plan
pnpm deploy:production
pnpm smoke                    # App/Space v2; run twice 70s apart
pnpm smoke:v1                 # explicit frozen v1 compatibility check only
```

The v2 smoke script uses one dedicated `deploy-smoke` Space, per-run node hashes,
and per-run request IDs. It releases the parent Root Ref after assertions, so
subsequent runs do not accumulate positive Root Refs. It also checks an empty
isolation Space and rejects both token/route version mismatches.
HTTPS targets skip the paused-body concurrency probe because Cloudflare ingress
buffers the request body; set `UNICAS_SMOKE_ENABLE_CONCURRENCY=1` only when the
target preserves streaming ingress. Running smoke twice with a 70s gap also
proves the authority-cache refresh path.

### Rollback

`wrangler` retains prior versions; reverse-order rollback is verified on the
deployed middleware (admin drill 2026-08-26):

```text
cd packages/service-cloudflare
wrangler deployments list
wrangler rollback            # move traffic to the retained prior version
# verify the public service, then redeploy the current version if needed
wrangler deploy
```

### Backup and restore

Backup (manual or scheduled; daily target):

```text
wrangler d1 export unicas-control --remote --no-schema --output backup-cas-control.sql
wrangler d1 export unicas-tenant --remote --no-schema --output backup-cas-tenant.sql
```

`--remote` is mandatory (without it wrangler exports an empty local DB).
Store the SQL off-box (the gitignored `.wrangler/` copy is a working backup,
not a durable one). R2 content is referenced by node hashes in the physical
`unicas-tenant` D1
backup; a restore re-verifies blobs through the canonical read path.

For the split-origin smoke-only cutover, review the live reset plan after both
exports complete:

```powershell
node stacks/unicas/deploy/reset-smoke.mjs --expected-stack-id <current-smoke-stack-id>
```

This is a physical pre-cutover tool: its Stack/Tenant flags and output match the
current D1/R2 schema and are not v2 aliases. The command refuses inventories
containing another physical partition, object-key shape, or a managed issuer
not bound to `api.unicas.work`. After reviewing the
printed R2, OAuth KV, and D1 commands, execute only with the same explicit
physical Stack ID and the directory containing both non-empty exports:

```powershell
node stacks/unicas/deploy/reset-smoke.mjs --execute `
   --expected-stack-id <current-smoke-stack-id> `
   --backup-dir .wrangler/cas-deploy/backups/<cutover>
```

This tool targets only the isolated `unicas-*` resources committed in this
repository. It has no legacy Worker, route, database, bucket, or namespace
parameter.

Restore (disaster drill; destructive — clears target tables first):

```text
wrangler d1 execute unicas-control --remote --command "<clear tables>"
wrangler d1 execute unicas-control --remote --file=backup-cas-control.sql
wrangler d1 execute unicas-tenant --remote --command "<clear tables>"
wrangler d1 execute unicas-tenant --remote --file=backup-cas-tenant.sql
```

Backups were verified 2026-08-26 (control 4.1 KB, physical data D1 2.0 KB, content
inspected). Restore was not executed against production (destructive); a
throwaway-D1 restore drill is a pending ops item.

### App OAuth issuer key rotation

App signing keys come exclusively from the active issuer's discovered
`jwks_uri`; UniCAS has no manual or copied active-key table. Rotation happens
at the authorization server: it publishes the new key alongside the old one
(overlap), and UniCAS refreshes the remote JWKS after the authority cache TTL
and when an unknown `kid` is encountered outside the fetch cooldown.

Verification behavior:

- A key removed from a successfully refreshed JWKS stops validating immediately.
- Within the cache TTL the cached JWKS keeps verifying; past the hard stale
  bound a failed registry refresh fails closed (`registry_unavailable`) — it
   never silently falls back to a manual key set.

Operational checks:

1. Confirm the App's OAuth issuer is `active`
   (`unicas app-oauth-issuer get <appId>`).
2. After the provider rotates keys with overlap, confirm traffic still
   verifies with the new key after the refresh interval.
3. On suspected compromise, rotate the provider signing key, then verify the
   provider JWKS no longer lists the compromised `kid` and old tokens fail
   after the cache TTL.

### Key compromise

1. Rotate the authorization server's signing key so the compromised key stops
   being advertised (publish the replacement with overlap first).
2. Wait for UniCAS to refresh the remote JWKS and confirm tokens signed by the
   compromised `kid` are rejected.
3. Rotate any secrets that may share the compromise (audit reader key,
   session encryption keys) and review `cas_control_audit_events` for the
   affected window.

### Incident checklist

1. Confirm service `/health`; confirm `/v2/apps` + `/admin/apps` probes.
2. `wrangler deployments list` for `unicas` — recent deploy?
   Rollback first, diagnose later.
3. Grep `cas_app_authorization` (and retained v1 `cas_stack_authorization`) for `fail_closed` / `unknown_issuer` —
   registry reachability vs key/issuer config.
4. Check the service Worker's D1 bindings (`CAS_CONTROL_DB`,
   `unicas-control`) and `wrangler d1 execute ... SELECT` reachability.
5. After resolution, run the smoke twice (70 s apart) to confirm both the
   happy path and the cache-refresh path.

## Pending ops items

- Scheduled backup job (Workers Cron or external) with alerting on failure.
- Throwaway-D1 restore drill (destructive restore not yet executed).
- Alert delivery integration (Cloudflare alerting webhooks or an external
  monitor like Better Stack / Grafana) wired to the rules above.
- Cloudflare analytics/logpush consumption for the 5-min roll-ups.

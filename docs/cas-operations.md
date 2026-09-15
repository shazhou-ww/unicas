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

The UniCAS service remains one application deployment unit, while a complete
production release publishes three independently owned Workers: service,
product site, then documentation site. A promotion pull request from `main`
into `release` is the normal release boundary. Its merged `release` revision
runs the protected `deploy-production` job after CI validation. That job checks
out and builds the exact validated commit, runs canonical smoke after the
service publish, deploys the two static Workers, and verifies all four public
origins. A separate job then records a successful push deployment as an
immutable `production-YYYYMMDD-<workflow-run-number>` annotated tag pointing
to that exact revision; manual recovery runs do not create production tags.

For a manual recovery attempt, dispatch the **CI** workflow from `release`. A
dispatch from `main` or any other branch cannot enter the `Production`
environment or run a production command. The manual path repeats validation;
it does not bypass it.

Local emergency deployment remains explicit. **Always rebuild first** because
Wrangler uploads `dist/` and stale output silently deploys old code:

```text
pnpm deploy:plan
pnpm deploy:production
pnpm deploy:site
pnpm deploy:docs
pnpm smoke                    # App/Space v2; run twice 70s apart
pnpm smoke:v1                 # explicit frozen v1 compatibility check only
```

The v2 smoke script uses one dedicated `deploy-smoke` Space, per-run node hashes,
and per-run request IDs. After acquiring the parent Root Ref, it releases that
ref in a `finally` path even when a later assertion fails, so subsequent runs
do not accumulate positive Root Refs. It also checks an empty isolation Space
and rejects both token/route version mismatches.
HTTPS targets skip the paused-body concurrency probe because Cloudflare ingress
buffers the request body; set `UNICAS_SMOKE_ENABLE_CONCURRENCY=1` only when the
target preserves streaming ingress. Running smoke twice with a 70s gap also
proves the authority-cache refresh path.

#### Failure diagnosis

Use the named failed step and its non-secret Wrangler output to identify the
deployment unit. Validation failures publish nothing. A failure in the service
publish or canonical smoke leaves the product and documentation Workers
untouched, although the service version may already be live. A product-site
failure occurs after a successful service smoke. A documentation failure
occurs after both earlier units succeed. A final HTTPS-check failure means the
publishes completed but one public route did not return a successful response.

A `tag-production` failure happens only after all deployment and verification
steps passed, so production is live even though its audit marker is missing.
Use **Re-run failed jobs** on that original workflow run; do not dispatch a new
manual run or create a tag by hand. The retry is idempotent when the existing
tag resolves to the deployed commit and fails without moving it on a conflict.
Follow [Deployment and local configuration](deployment-and-local-configuration.md)
for tag inspection, ruleset policy, and conflict escalation.

For any failure after a Wrangler command starts, compare the affected Worker's
`wrangler deployments list` output with the workflow commit and timestamps.
Do not print environment values or private-key files while diagnosing. The
workflow's `always()` cleanup removes its ephemeral smoke key even when the
service or smoke step fails. Fix a transient or configuration problem and use
a manual `release` dispatch; use version rollback for a bad artifact.

#### Credential rotation

To rotate the Cloudflare deployment token, create a replacement from the
**Edit Cloudflare Workers** template with the same single-account and
`unicas.work` zone scope. Replace the `CLOUDFLARE_API_TOKEN` secret in the
GitHub `Production` environment, complete a green manual run from `release`,
then revoke the old token.

To rotate the smoke signer, first publish the replacement public key through
the tracked `https://unicas.work/deploy-smoke` JWKS while retaining the old
key. Deploy the product-site Worker and wait for the verifier-cache overlap
window. During a deployment-free window, replace
`UNICAS_SMOKE_PRIVATE_KEY_PKCS8` and `UNICAS_SMOKE_KID` in the same GitHub
environment, then complete a green manual run before removing the old public
key in a later product-site deployment. The issuer URL and audience do not
change during signer rotation, so no new control-plane activation is needed.
Rotate Worker runtime secrets separately with `wrangler secret put`; never
copy them into GitHub deployment configuration.

### Rollback

Wrangler retains prior versions. Inspect each unit that may have changed and
select the known-good version ID. If more than one unit changed, roll them back
in reverse deployment order: documentation, product site, then service. Skip
units that the failed workflow never reached.

A Worker version rollback changes the code receiving traffic; it does not
undo D1, R2, KV, Durable Object storage, or Worker secret changes. Inspect the
target and failed versions for binding or Durable Object migration
compatibility before rolling back. Routine releases in this workflow do not
rewrite resources or runtime secrets, but a future migration can make an older
service version unsafe to restore.

```text
pnpm --filter @unicas/service-cloudflare exec wrangler deployments list --config ../../stacks/unicas/docs-site/wrangler.jsonc
pnpm --filter @unicas/service-cloudflare exec wrangler rollback <docs-version-id> --config ../../stacks/unicas/docs-site/wrangler.jsonc --yes --message "rollback failed production release"

pnpm --filter @unicas/service-cloudflare exec wrangler deployments list --config ../../stacks/unicas/site/wrangler.jsonc
pnpm --filter @unicas/service-cloudflare exec wrangler rollback <site-version-id> --config ../../stacks/unicas/site/wrangler.jsonc --yes --message "rollback failed production release"

pnpm --filter @unicas/service-cloudflare exec wrangler deployments list
pnpm --filter @unicas/service-cloudflare exec wrangler rollback <service-version-id> --yes --message "rollback failed production release"
```

After rollback, rerun the canonical smoke with provisioned operator
credentials and check `https://api.unicas.work/health`,
`https://console.unicas.work/`, `https://unicas.work/`, and
`https://docs.unicas.work/`. Do not use a source rebuild as a substitute for an
explicit version rollback: rebuilding a moving branch does not identify the
artifact receiving traffic. The service rollback procedure was verified in
the admin drill on 2026-08-26; include the two static Workers in the next full
rollback drill.

### Backup and restore

Backup (manual or scheduled; daily target):

```text
wrangler d1 export unicas-control --remote --no-schema --output <cutover>/unicas-control.sql
wrangler d1 export unicas-tenant --remote --no-schema --output <cutover>/unicas-tenant.sql
```

`--remote` is mandatory (without it wrangler exports an empty local DB).
Store the SQL off-box (the gitignored `.wrangler/` copy is a working backup,
not a durable one). R2 content is referenced by node hashes in the physical
`unicas-tenant` D1
backup; a restore re-verifies blobs through the canonical read path.

For the split-origin smoke-only cutover, review the live reset plan after both
exports complete:

```powershell
node stacks/unicas/deploy/reset-smoke.mjs `
   --expected-stack-id <current-smoke-stack-id> `
   --backup-dir <off-machine-cutover-directory>
```

This is a physical pre-cutover tool: its Stack/Tenant flags and output match the
current D1/R2 schema and are not v2 aliases. The command refuses inventories
containing another physical partition in any scoped control or data table, an
unexpected object-key shape, or a managed issuer not bound to
`api.unicas.work`. The rendered D1 commands drop the legacy physical tables;
they do not merely delete rows, because retained `stack_id`/`tenant_id` columns
would block the new Worker from creating the clean App/Space schema.

With `--backup-dir`, the rendered plan downloads every D1-derived canonical R2
object before showing its delete. Execution verifies each downloaded object's
SHA-256 against its canonical key and writes `backup-manifest.json` containing
the D1 and R2 sizes and hashes. A missing, empty, stale, or mismatched backup
aborts before any R2 delete or D1 drop.

Run the destructive command only inside the approved maintenance window, then
deploy the new Worker immediately so it can create the `app_id`/`space_id`
tables. Do not reuse this one-time pre-cutover tool after the physical cutover.
After reviewing the printed R2, OAuth KV, and D1 commands, execute only with
the same explicit physical Stack ID and the directory containing both
non-empty exports:

```powershell
node stacks/unicas/deploy/reset-smoke.mjs --execute `
   --expected-stack-id <current-smoke-stack-id> `
   --backup-dir <off-machine-cutover-directory>
```

This tool targets only the isolated `unicas-*` resources committed in this
repository. It has no legacy Worker, route, database, bucket, or namespace
parameter.

Restore (disaster drill; destructive — clears target tables first):

```text
wrangler d1 execute unicas-control --remote --command "<clear tables>"
wrangler d1 execute unicas-control --remote --file=unicas-control.sql
wrangler d1 execute unicas-tenant --remote --command "<clear tables>"
wrangler d1 execute unicas-tenant --remote --file=unicas-tenant.sql
```

The 2026-09-15 App/Space cutover verified both data-only exports by rebuilding
the pre-cutover schemas in temporary SQLite databases, importing the exports,
and checking the expected control/data counts. Every R2 backup was also
rehashed against its canonical key. Production restore remains a destructive
incident action and was not executed as part of the drill.

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

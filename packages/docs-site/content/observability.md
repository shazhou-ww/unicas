# Observability

UniCAS exposes three current diagnostic surfaces:

1. `Server-Timing` headers on Space data-plane responses.
2. Worker stdout/stderr through Cloudflare logs or the local Miniflare terminal.
3. Durable control-plane and Root Ref audit records through authenticated admin
   APIs, the `unicas` CLI, or MCP tools.

Do not log bearer capabilities, session cookies, CSRF tokens, private keys, or
OAuth authorization codes.

## Server-Timing

Space routes return a `Server-Timing` header and `Timing-Allow-Origin: *`.
Repeated operations are aggregated and include a call count. Depending on the
request path, entries can include:

| Metric | Work measured |
| --- | --- |
| `cas_edge` | Total edge service time |
| `cas_schema` | Lazy D1 schema initialization |
| `cas_auth` | Space capability verification |
| `cas_do` | Durable Object dispatch |
| `cas_d1_*` | D1 lease, node, Root Ref, and commit operations |
| `cas_r2_get`, `cas_r2_put`, `cas_r2_head`, `cas_r2_prefix` | R2 operations |

Inspect headers from a Space request with `curl -i` or the browser network
panel. A representative header is:

```text
Server-Timing: cas_schema;dur=2.1, cas_auth;dur=4.5, cas_do;dur=11.8, cas_edge;dur=20.3
Timing-Allow-Origin: *
```

Use the metric breakdown to identify the controlling layer before changing
timeouts: auth latency points at issuer/JWKS work, `cas_do` includes actor
serialization, and an individual D1 or R2 metric points at storage.

The public `GET /health` endpoint intentionally returns only service health and
does not initialize storage or emit timing metrics.

## Runtime logs

Production Worker logs are available with Wrangler:

```powershell
pnpm --filter @unicas/service-cloudflare exec wrangler tail
```

The current structured events are:

- `cas_app_authorization`: App/Space v1 capability authorization decisions,
  including the decision kind.
- `admin_oidc_callback_failed`: administrator OIDC callback failures with a
  bounded reason such as `state_mismatch` or `id_token_invalid`.
- `cas_usage_reconciliation`: bounded App usage maintenance counts (`examined`,
  `observed`, `missing`, `failed`, and whether the pass served backfill). It
  also reports whether one oldest Space summary was repaired. It contains no
  App ID, Space ID, node hash, or usage amount.

Unexpected Space authorization, service actor, Durable Object, administrator
BFF, and R2 upload failures are written to stderr with an exception. These are
incident signals; expected protocol rejections remain structured HTTP
responses and are not logged as exceptions.

`pnpm dev` writes Miniflare and Worker logs to the terminal. It does not create a
repository JSONL log file. Redirect terminal output only into a gitignored path
when a reproducible local investigation needs a retained transcript, and review
it for credentials before sharing.

## Control-plane audit

Control mutations append audit records containing the App, stable Account,
exact authenticated External Identity, action, target, request identity, trace
identity, caller channel, and timestamp. Read
those records through authenticated control-plane surfaces:

```powershell
unicas app-audit control <appId> --limit 50
unicas app-ref-domains list <appId>
unicas app-audit root-domain-refs <appId> <refDomain> [--space-id S] --limit 50
unicas app-audit root-domain-events <appId> <refDomain> [--space-id S] --limit 50
```

Use the returned cursor unchanged for the next control or balance page. Root
Ref event pagination uses `--after`. A stale balance cursor means the snapshot
changed; restart from the first page instead of combining revisions.

The Worker's `/_internal/audit/*` routes are private adapter RPCs protected by
`CAS_AUDIT_READER_KEY`. They fail closed as 404 without the exact key and are
not operator-facing public APIs. Prefer the CLI, WebUI, or MCP surface.

## Operational checks

For a basic local or production triage:

1. Check `GET /health` for edge reachability.
2. Reproduce one authenticated Space request and inspect `Server-Timing`.
3. Correlate unexpected failures in `wrangler tail` or the local terminal.
4. Read the App's control and Root Ref audit records for the business action.
5. Verify active issuer state with `unicas app-oauth-issuer get <appId>` when
   authorization fails.

The detailed SLOs, alerts, backup procedure, and incident runbooks live in
[CAS middleware operations](cas-operations.md).

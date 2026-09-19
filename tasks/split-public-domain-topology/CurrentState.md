# Current deployment state

Observed: 2026-09-14

## New isolated environment

- Worker: `unicas`
- Current public origin: `https://unicas.work`
- D1: `unicas-control` and `unicas-tenant`
- R2: `unicas-content` and `unicas-content-preview`
- OAuth KV: `UNICAS_OAUTH`
- Durable Object namespaces belong to Worker `unicas` and are distinct from
  legacy namespaces.
- `unicas.work` is an exact custom domain.
- `api.unicas.work`, `console.unicas.work`, and `docs.unicas.work` are not yet
  routed.

The committed resource IDs are in
[`packages/service-cloudflare/wrangler.toml`](/packages/service-cloudflare/wrangler.toml).

## Legacy environment

- Worker: `unidocs-cas`
- Route: `unicas.shazhou.work/* -> unidocs-cas`
- Its deployment, D1, R2, KV, Durable Objects, issuers, and data were verified
  unchanged after the isolated deployment.

Do not use the new repository's deploy or smoke tooling against the legacy
origin.

## OAuth

- Google Cloud project: `unicas-506709`
- OAuth client: `unicas-admin-webui-prod`
- The client ID matches the non-secret Worker variable and cfg value.
- Legacy and localhost callbacks remain registered.
- The current apex JavaScript origin and callbacks are registered:

```text
https://unicas.work
https://unicas.work/admin/auth/callback
https://unicas.work/oauth/google/callback
```

- Administrator login and real MCP dynamic registration + PKCE both reached
  Google without `redirect_uri_mismatch`.
- Add the API and console callbacks from the finalized domain topology before
  cutover; do not remove existing callbacks during the migration window.

## Secrets

Cloudflare credentials are supplied by cfg through
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Google OAuth credentials
are stored under the existing shared cfg keys. New Worker session, OAuth state,
audit reader, managed issuer, and administrator allowlist backups also exist in
cfg as secret values. Inspect key names with `cfg list`; never print values into
task files or logs.

R2 S3 credentials are not provisioned. Legacy body upload works and has been
validated. Direct-upload support requires new bucket-scoped credentials before
it is considered production-ready.

## Smoke-only state

- The new control plane contains the dedicated `Production Smoke` resource.
- Its current managed issuer uses the apex origin and must not be silently
  reinterpreted after `CAS_PUBLIC_ORIGIN` moves to the API host.
- Production smoke passed health, lease, read, metadata, Root Ref update and
  idempotency, usage, GC, and Root Ref cleanup.
- HTTPS ingress buffers paused request bodies, so the concurrency probe runs by
  default only against local HTTP targets.

Before destructive reset, export both new D1 databases and re-check that no
real App or Space data has appeared.

## Repository state

- Repository: <https://github.com/shazhou-ww/unicas>
- Branch: `main`
- The domain and terminology plans are backlog tasks.
- Build, typecheck, full tests, Wrangler dry-run, gitleaks, and CI passed before
  this state was recorded.
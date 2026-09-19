# UniCAS domain topology plan

Status: planned, not yet executed

Date: 2026-09-14

The finalized [UniCAS terminology](/docs/terminology.md) defines the
public resource model that should be introduced with the new API and console
origins. Coordinate with the `migrate-app-space-terminology` task in separate
reviewable phases, then combine them at the smoke-only environment cutover.

## Decision

Use the product apex for the developer-facing website and separate the human
administrator surface from machine-facing protocols:

| Origin | Audience | Surface |
| --- | --- | --- |
| `https://unicas.work` | Developers and evaluators | Product overview, quick start, and links to the console, documentation, and source |
| `https://api.unicas.work` | Services, SDKs, CLIs, and agents | App/Space data API, managed issuers, OAuth/MCP, discovery, and health |
| `https://console.unicas.work` | App administrators | Administrator WebUI, BFF, invitations, and CLI login |
| `https://docs.unicas.work` | Developers and operators | Product, protocol, deployment, and operations documentation |

UniCAS has no end-user application surface. Downstream products own end-user
identity, Space mapping, and product workflows. The console is only for people
who administer a UniCAS App.

Prefer `console.unicas.work` over `admin.unicas.work`: "console" describes the
stack-operator product without implying a separate platform-superuser plane.

## Current transition state

The isolated Cloudflare environment currently serves all API and administrator
paths from `https://unicas.work`. It has its own Worker, D1 databases, R2
buckets, KV namespace, Durable Object namespaces, and secrets. The previous
`unidocs-cas` Worker and `unicas.shazhou.work` route remain a separate legacy
environment and must not be modified by this migration.

Only the dedicated `Production Smoke` stack exists in the new control database.
Its managed issuer and audience use the current apex origin. Do not change only
the origin variables: the persisted issuer record would no longer match the
managed issuer implementation. Reset or recreate this smoke-only state at the
domain cutover.

`docs.unicas.work` is intentionally unconfigured until a documentation site is
ready. An exact custom domain for `unicas.work` does not cover subdomains.

## Configuration boundary

The current `PUBLIC_ORIGIN` binding is shared by the Admin BFF and MCP OAuth.
Split it before adding the new hosts:

```text
CAS_PUBLIC_ORIGIN=https://api.unicas.work
MCP_PUBLIC_ORIGIN=https://api.unicas.work
ADMIN_PUBLIC_ORIGIN=https://console.unicas.work
```

Keep `PUBLIC_ORIGIN` only as a temporary compatibility fallback while tests and
local development migrate. New URL generation must use the owning origin:

- stack audiences, tenant resource metadata, and managed issuers use
  `CAS_PUBLIC_ORIGIN`;
- MCP resource metadata, OAuth endpoints, consent forms, and token audience use
  `MCP_PUBLIC_ORIGIN`;
- administrator callbacks, invitations, session/CSRF checks, and CLI
  authorization use `ADMIN_PUBLIC_ORIGIN`.

The CLI default administrator origin becomes `https://console.unicas.work`.

## Host routing

The same Cloudflare Worker may serve `api.unicas.work` and
`console.unicas.work`, but it must enforce an explicit host/path matrix:

| Host | Allowed paths |
| --- | --- |
| `api.unicas.work` | `/health`, `/.well-known/*`, `/stacks/*`, `/managed-issuers/*`, `/mcp`, `/oauth/*` |
| `console.unicas.work` | `/`, `/admin/*` |

Reject paths on the wrong host. During a short compatibility window,
`https://unicas.work/admin/*` may redirect to the console and machine paths may
redirect to the API only when preserving method and authorization semantics is
safe. Do not rely on redirects for capability-bearing writes.

The console and its BFF stay same-origin. Administrator cookies remain
host-only and never reach the tenant or MCP origin. The API origin does not
accept administrator session cookies as authentication.

The apex website and documentation site should be separate static deployments
so their releases and security policies are independent from the storage
service.

## Migration sequence

### 1. Finish and publish the current safety changes

- Commit the production smoke target allowlist.
- Keep production smoke mandatory in the deployment wrapper.
- Keep one fixed `deploy-smoke` tenant and release its Root Ref after every run.
- Confirm CI passes before beginning origin changes.

### 2. Split origin configuration in code

- Add `ADMIN_PUBLIC_ORIGIN` and `MCP_PUBLIC_ORIGIN` types and parsers.
- Update Admin BFF, MCP/OAuth, and Worker routing to use only their owning
  origin.
- Add host-routing tests for allowed and denied path combinations.
- Retain the single-origin localhost topology or introduce local host aliases;
  either way, keep local integration tests deterministic.

### 3. Prepare external domains and OAuth

- Add exact Worker custom domains for `api.unicas.work` and
  `console.unicas.work`.
- Keep the apex Worker route temporarily while validating the new origins.
- Register these Google OAuth callbacks without removing existing callbacks:

```text
https://console.unicas.work/admin/auth/callback
https://api.unicas.work/oauth/google/callback
```

- Keep `docs.unicas.work` without a Worker route.

### 4. Cut over the smoke-only environment

- Export both new D1 databases before destructive cleanup.
- Confirm that `Production Smoke` remains the only stack and that no real
  tenant data exists.
- Reset the new control/tenant state and smoke R2 objects, or recreate the new
  resources with the same intended names and update their IDs.
- Do not touch the legacy `unidocs-cas` Worker, route, databases, buckets, KV,
  Durable Objects, or issuer records.
- Deploy the split-origin Worker and recreate `Production Smoke` through
  `console.unicas.work`.

### 5. Validate before releasing the apex

- Administrator Google login and stack CRUD succeed on the console.
- CLI login defaults to the console and persists a valid session.
- MCP discovery, dynamic registration, Google login, consent, token refresh,
  revocation, and reauthorization succeed on the API origin.
- Managed issuer metadata and JWKS use `api.unicas.work`.
- Tenant lease, read, metadata, Root Ref, usage, and GC smoke passes against
  `api.unicas.work`.
- Console cookies are absent from API requests.
- Wrong-host routes fail closed.
- The legacy Worker deployment ID and route remain unchanged.

### 6. Move the apex to the product website

- Remove the apex custom domain from the UniCAS API Worker only after API and
  console validation passes.
- Deploy a separate static product site at `unicas.work`.
- The initial site can be small: product definition, architecture summary,
  quick start, current status, and links to GitHub, docs, and console.
- Deploy documentation separately at `docs.unicas.work` when ready.

### 7. Cleanup after the stability window

- Remove apex API compatibility routes and old apex Google callbacks only after
  clients have migrated.
- Keep legacy `unicas.shazhou.work` callbacks while the legacy environment is
  intentionally online.
- Decide whether to provision R2 S3 credentials for direct uploads; the legacy
  upload path works without them, but direct-upload clients require dedicated
  `CAS_R2_ACCESS_KEY_ID` and `CAS_R2_SECRET_ACCESS_KEY` secrets scoped to the
  new bucket.

## Acceptance criteria

- `unicas.work` serves only the product website.
- `api.unicas.work/health` returns the UniCAS health response.
- `console.unicas.work` completes administrator login and stack management.
- `docs.unicas.work` is independently deployable and never handled by the API
  Worker.
- Machine APIs and browser administration use distinct canonical origins.
- Production deployment cannot run without explicit smoke configuration and
  cannot target the legacy or documentation origins by mistake.
- Full build, typecheck, tests, Wrangler dry-run, production smoke, and CI pass.
- Legacy Cloudflare resources and `unicas.shazhou.work` remain unchanged.

## Rollback

Keep the apex route and prior Worker version until the API and console hosts are
verified. If the split fails, restore traffic to the last known-good Worker
version and retain the apex service temporarily. Roll back routes and code
forward; do not restore the entire repository or alter the legacy deployment.
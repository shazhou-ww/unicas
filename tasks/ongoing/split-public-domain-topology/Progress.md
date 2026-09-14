# Progress

Updated: 2026-09-14

## Checklist

- [x] Split CAS, MCP, and administrator public-origin configuration.
- [x] Enforce and test the public host/path routing matrix.
- [x] Update Worker domain configuration, OAuth callbacks, and CLI defaults.
- [x] Cut over and recreate the smoke-only environment.
- [x] Validate the API and console before moving the apex website.
- [ ] Complete repository and production acceptance validation.

## Current state

The Worker now assigns CAS, MCP/OAuth, and administrator routes to their owning
origins and returns 404 for wrong-host requests. Production Wrangler config
declares exact `api.unicas.work` and `console.unicas.work` custom domains while
retaining the apex route for rollback; local development explicitly maps all
three origins to its existing single localhost origin. The administrator CLI
defaults to `https://console.unicas.work`.

Google OAuth now includes the split console and API callbacks while retaining
legacy, localhost, and apex callbacks. Both isolated D1 databases were exported
to a non-empty gitignored cutover backup. Read-only inventory confirmed that
the environment still contains only `Production Smoke`, its `deploy-smoke`
tenant, two indexed R2 objects, and one OAuth client key.

The split-origin Worker is deployed as version
`f9a9b1c8-775e-41ce-9799-264403626636`. `Production Smoke` was recreated as
`cas_hHO73aWq3q__` through `console.unicas.work`; its active managed issuer and
audience use `api.unicas.work`. The API production smoke, console login, CLI
login, and two complete MCP OAuth flows pass.

The apex now serves the independent `unicas-site` static Worker. The API Worker
owns only `api.unicas.work` and `console.unicas.work`; `docs.unicas.work`
remains unconfigured and independent.

Next concrete action: commit the final deployment-boundary test update, push
the completed cutover commits, and verify GitHub CI before archiving the task.

## Decisions

- Follow the migration sequence in `Plan.md`; do not change DNS or reset the
  smoke-only environment before split-origin code and wrong-host tests pass.
- Keep `unicas.shazhou.work` and every legacy Cloudflare resource untouched.
- Keep the terminology migration separately reviewable until the planned
  smoke-only cutover gate.
- Treat a missing or malformed owner origin as a fail-closed route mismatch;
  local and test environments must configure their intentional single origin.

## Validation

- Working tree was clean before task activation.
- `pnpm check:tasks` passed (7 tests) after task activation.
- Focused origin configuration tests passed (12 tests).
- Focused Worker routing and MCP OAuth tests passed (22 tests).
- Focused administrator CLI tests passed (4 tests).
- Focused audit-reader integration tests passed (7 tests).
- `pnpm --filter @unicas/service-cloudflare test` passed (185 tests).
- Service-cloudflare and admin-cli TypeScript project builds passed.
- Direct Wrangler deployment dry-run passed and reported all three public
  origin variables; no production request was made.
- Stage commit `b6afee8` records the split-origin code and configuration.
- Google OAuth callback save was reloaded and verified with all prior callbacks
  retained.
- Remote D1 inventory showed one `Production Smoke` stack and one
  `deploy-smoke` tenant with two nodes.
- Remote D1 exports succeeded: control 11,030 bytes and tenant 6,391 bytes in
  the gitignored cutover backup directory.
- Current `unicas` deployment version is `eb2732bc-7103-40d8-ae16-d3d1fdacec32`;
  current legacy `unidocs-cas` version is
  `17f07f91-0771-413d-8b48-ff93c3cbf703`.
- Focused deployment/reset guardrail tests passed (10 tests).
- Production smoke now defaults to `https://api.unicas.work`; the default
  allowlist rejects the apex, legacy, and documentation origins.
- Guarded reset completed and post-reset D1/KV counts were zero; Wrangler
  confirmed both indexed R2 objects were deleted.
- Split-origin Worker version `f9a9b1c8-775e-41ce-9799-264403626636` deployed
  with apex retained for rollback, plus API and console exact domains.
- API health returned 200; API/admin and console/machine wrong-host requests
  returned 404. Console root redirects to `/admin/` on the console origin.
- Console Google login and stack recreation succeeded. CLI login defaulted to
  and persisted `https://console.unicas.work`; `whoami` and `stacks list`
  succeeded.
- API production smoke passed lease, read, metadata, Root Ref idempotency and
  cleanup, usage, and GC against the recreated stack.
- MCP OAuth passed metadata, dynamic registration, Google login, consent,
  authorization-code exchange, `whoami`, refresh rotation, RFC 7009 revocation,
  revoked-token rejection, and a second complete reauthorization flow. Test
  clients were removed afterward and OAuth KV returned to zero keys.
- Post-cutover data contains only `Production Smoke` and its `deploy-smoke`
  tenant. The managed issuer and audience use `https://api.unicas.work`.
- `docs.unicas.work` remains absent from Worker custom domains and DNS.
- Legacy Worker version and all three `unicas.shazhou.work` route assignments
  matched their pre-cutover baselines after deployment.
- The independent product site passed Wrangler dry-run and desktop/mobile
  browser validation; the mobile hero ends at 762 px in a 844 px viewport with
  no horizontal overflow.
- Product site version `1ffd3f9a-6f58-4237-ba44-709128ba09f8` owns the apex;
  final API Worker version `02275f3c-82ec-4e90-8cfd-103d43135f2c` owns only
  the API and console domains.
- Final public checks passed: apex product title and root 200, apex API/admin
  and unknown paths 404, API health 200, console root 302, and wrong-host
  routes 404.
- Full workspace build and typecheck passed. Full repository/package tests
  passed, including 101 repository checks and 185 service-cloudflare tests.
- Final API Worker and product-site Wrangler dry-runs passed.
- Gitleaks 8.30.1 scanned 315 commits and reported no leaks.
- Final production smoke passed after the apex transfer; the frozen legacy
  deployment and route baselines remained unchanged.
- The guarded live reset plan passed its remote inventory checks and targets
  exactly two R2 objects, one OAuth KV key, and the isolated tenant/control D1
  tables.
- Legacy route baseline: two exact OAuth routes remain on `unidocs-gateway` and
  `unicas.shazhou.work/*` remains on `unidocs-cas`.

## Blockers

None.

## Outcome

In progress.

# Progress

Updated: 2026-09-14

## Checklist

- [x] Split CAS, MCP, and administrator public-origin configuration.
- [x] Enforce and test the public host/path routing matrix.
- [x] Update Worker domain configuration, OAuth callbacks, and CLI defaults.
- [ ] Cut over and recreate the smoke-only environment.
- [ ] Validate the API and console before moving the apex website.
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

No Worker deployment, DNS removal, or destructive reset has been performed.

Next concrete action: commit the guarded smoke reset tool, execute its reviewed
plan for the verified smoke stack, then deploy the split-origin Worker before
recreating `Production Smoke` on the new origins.

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
- The guarded live reset plan passed its remote inventory checks and targets
  exactly two R2 objects, one OAuth KV key, and the isolated tenant/control D1
  tables.
- Legacy route baseline: two exact OAuth routes remain on `unidocs-gateway` and
  `unicas.shazhou.work/*` remains on `unidocs-cas`.

## Blockers

The destructive reset and Worker deployment remain intentionally blocked until
the guarded reset plan is committed.

## Outcome

In progress.

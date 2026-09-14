# Progress

Updated: 2026-09-14

## Checklist

- [x] Split CAS, MCP, and administrator public-origin configuration.
- [x] Enforce and test the public host/path routing matrix.
- [ ] Update Worker domains, OAuth callbacks, and CLI defaults.
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

No Cloudflare deployment, DNS change, Google OAuth callback change, production
data export, or destructive reset has been performed.

Next concrete action: add both split Google OAuth callbacks without removing
the apex callbacks, then run the pre-cutover Cloudflare and smoke-state checks
before deploying the new Worker domains.

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

## Blockers

Production cutover requires Cloudflare and Google OAuth control-plane changes,
plus verified backups and confirmation that the isolated environment remains
smoke-only. These have intentionally not started during the code phase.

## Outcome

In progress.

# Split the UniCAS public domain topology

Created: 2026-09-14

## Goal

Separate the product website, machine API, administrator console, and
documentation onto their intended origins without modifying the legacy
`unicas.shazhou.work` environment.

## Context

The new isolated Worker currently serves API and administrator paths from
`https://unicas.work`. The apex should become the product website, while the
API and console need distinct security and ownership boundaries.

## Scope

- Split CAS, MCP, and administrator public-origin configuration.
- Enforce an explicit host/path routing matrix.
- Add `api.unicas.work` and `console.unicas.work` as exact Worker domains.
- Keep `docs.unicas.work` independent from the API Worker.
- Update Google OAuth callbacks and CLI defaults.
- Reset and recreate only the smoke-only new environment at cutover.
- Move the apex to a separate product website after API and console validation.

## Out of scope

- Modifying or migrating `unicas.shazhou.work` or its Cloudflare resources.
- Building the complete documentation site.
- Migrating UniDocs consumers.
- Performing the App/Space terminology change as an unreviewed part of the
  origin refactor.

## Acceptance criteria

- [ ] `unicas.work` serves only the product website.
- [ ] `api.unicas.work` serves machine APIs, OAuth/MCP, managed issuers, and
      health.
- [ ] `console.unicas.work` serves the administrator UI/BFF and CLI login.
- [ ] `docs.unicas.work` is not routed to the API Worker.
- [ ] Console cookies and CSRF authority do not cross onto the API origin.
- [ ] Production smoke passes against the API origin.
- [ ] Wrong-host routes fail closed.
- [ ] The legacy Worker deployment and route remain unchanged.
- [ ] Build, typecheck, tests, Wrangler dry-run, gitleaks, and CI pass.

## Constraints

- Split the overloaded `PUBLIC_ORIGIN` before changing DNS.
- Preserve the apex Worker route until API and console rollback checks pass.
- The current smoke App has an apex-bound managed issuer and must be recreated
  rather than silently reinterpreted.
- Do not use redirects for capability-bearing writes.
- Keep this task reviewable separately from the terminology migration; combine
  them only at the planned smoke-only cutover gate.

## References

- [Task execution plan](Plan.md)
- [Current deployment state](CurrentState.md)
- [Finalized domain topology](../../../docs/domain-topology.md)
- [Finalized terminology](../../../docs/terminology.md)
- [Deployment and local configuration](../../../docs/deployment-and-local-configuration.md)
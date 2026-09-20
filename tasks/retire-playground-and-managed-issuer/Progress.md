# Progress

Updated: 2026-09-20

## Current state

Revision A is published as commit `6228714`. Revision B is implemented and
verified: the final first-party issuer runtime, persistence bootstrap,
configuration, interfaces, generated contracts, and current Playground
residuals are removed. External OAuth issuer and App/Space behavior remain
available. The next action is to publish this final implementation to primary
for delivery acceptance.

## Decisions

- Use two immutable code revisions: an issuance freeze followed by final
  verification-path removal after the production drain boundary.
- Keep the external OAuth issuer inspect/prove/activate and verifier paths
  unchanged.
- Do not perform production deployment, D1 mutation, signing-key
  revocation/deletion, or garbage collection from this task implementation.
- Keep the retired D1 rows and deployment secret physically intact during the
  rollback window; their eventual deletion requires separate explicit human
  approvals after the 3,660-second drain.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user approved primary commit `6c831d7` on 2026-09-20 and authorized implementation. |
| Interface | Approved | Requesting user reviewed [InterfaceRetirement.md](./InterfaceRetirement.md) and [UiReview.html](./UiReview.html), requested visual alignment and removal of one explanatory callout, then approved primary commit `6c831d7` on 2026-09-20. |
| Business and data model | Approved | Requesting user approved [BusinessDataModel.md](./BusinessDataModel.md) in primary commit `6c831d7` on 2026-09-20. |
| Architecture | Approved | Requesting user approved [Architecture.md](./Architecture.md) in primary commit `6c831d7` on 2026-09-20. |
| Delivery acceptance | Pending | Requires the final integrated primary commit, complete validation evidence, and production runbook. |

## Validation

- Focused Revision B tests: 109 passed across Admin protocol, CLI, service, and
  Cloudflare worker route, adapter, authority, MCP, repository, and schema
  coverage.
- `@unicas/service-cloudflare`: complete package suite, 27 files and 251 tests,
  passed after removing the retired implementation and test files.
- All 13 workspace packages passed `pnpm typecheck` and `pnpm build`.
- Admin OpenAPI and embedded Console assets were regenerated. OpenAPI drift,
  documentation-site, workspace-boundary, deployment-plan, and task checks
  passed.
- `pnpm deploy:plan` produced only the expected dry-run build, Wrangler,
  smoke-build, and smoke commands; no deployment was executed.
- The repository aggregate check's 5-second `repoledger-patch` test timed out
  twice under concurrent load; the same test passed in 9.8 seconds with a
  15-second test timeout.

## Blockers

- None.

## Outcome

Revision A removes first-party issuer operations from the Admin API, admin
client, CLI/MCP catalog and handlers, BFF, and Console. New App creation no
longer provisions issuer state, and the implicit Account-derived personal
Space capability path is gone.

Revision B removes the remaining public metadata/JWKS/authorization/token
routes, verifier and authority-resolution branches, D1 table/index bootstrap,
signing-key configuration, implementation files, generated OpenAPI fields,
tests, and current documentation. The residue inventory finds no active
Playground or first-party issuer product references outside the intentional
production retirement runbook and historical task records. External issuer
inspection, activation, discovery, and JWT capability verification remain.

Production work remains manual: deploy Revision A first, record the successful
cutoff, wait at least 3,660 seconds, obtain approval for Revision B, preserve
rollback material, then separately approve D1 table/index deletion and signing
key revocation. Do not run garbage collection. See
[`docs/managed-issuer-retirement.md`](../../docs/managed-issuer-retirement.md).

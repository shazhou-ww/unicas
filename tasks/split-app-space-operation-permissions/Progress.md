# Progress

Updated: 2026-09-21

## Current state

The reviewed Space capability v3 contract is implemented and validated across
the protocol vocabulary, service verifier, HTTP error envelope, Cloudflare
configuration, smoke issuer, generated OpenAPI, App-user guidance, deployment
runbook, glossary, and administrator Usage guidance. The next action is to
publish and integrate the implementation, then request delivery acceptance for
the exact primary commit.

## Decisions

- Keep the public Space HTTP API at v2 while advancing signed Space capability
  claims to `ver: 3`.
- Use six fixed exact permissions: `cas:nodes:read`, `cas:nodes:lease`,
  `cas:root-refs:read`, `cas:root-refs:update`, `cas:usage:read`, and
  `cas:gc:execute`.
- Treat the required signed `spaceId` as the sole Space scope. Permissions do
  not repeat a resource ID and do not imply one another.
- Keep `refDomain` as an additional signed requirement for both Root Ref
  operations. Permission denial is evaluated before domain validation.
- Reject v2 by default. An optional absolute
  `CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE` cutoff temporarily accepts only
  historically mapped v2 permissions issued before that instant; malformed,
  calendar-invalid, unknown-offset, or more-than-seven-days-future cutoffs
  fail closed.
- Return stable capability codes in the Space HTTP `error` field with an
  optional diagnostic `message`; preserve the frozen v1 response behavior.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user reviewed [Task.md](./Task.md) and approved continuing implementation on 2026-09-21, after revising v3 permissions to use the signed `spaceId` as their sole Space scope. The approved primary revision was `4f88af14826be8dca5c8d019bf11715193b7f36b`. |
| Interface | Approved | Requesting user reviewed [AuthorizationDesign.md](./AuthorizationDesign.md), stated there were no further comments, and directed execution on 2026-09-21. This approved capability `ver: 3`, the six fixed wire strings, route matrix, denial behavior, issuance profiles, and bounded v2 cutoff at primary revision `4f88af14826be8dca5c8d019bf11715193b7f36b`. |
| Business and data model | Not applicable | App, Space, Principal, Root Ref domain, node, lease, retention, and storage lifecycle are unchanged. |
| Architecture | Approved | Requesting user reviewed [AuthorizationDesign.md](./AuthorizationDesign.md) and approved implementation on 2026-09-21. The decision covered issuer-owned delivery, one signed Space scope, exact service enforcement, no browser/backend inference, Cloudflare cutoff wiring, rollout order, and continued direct-upload semantics at primary revision `4f88af14826be8dca5c8d019bf11715193b7f36b`. |
| Delivery acceptance | Pending | Requires the exact final integrated primary commit and the validation evidence below. |

## Validation

- `pnpm --filter @unicas/tenant-protocol test`: 41 protocol, route, and
  contract tests passed, including all six constructors, strict parsing, and
  v1/v3 parser separation.
- `pnpm --filter @unicas/service test`: 144 tests passed, including exact route
  mapping, bidirectional lease/Root Ref denial, node/Root Ref read separation,
  usage/GC/data isolation, both Root Ref domain checks, v2 cutoff boundaries,
  issuer lifetime enforcement, HTTP error codes, and frozen v1 regressions.
- `pnpm --filter @unicas/service-cloudflare test -- tests/worker.test.ts`: the
  final focused Worker run passed 25 tests, including valid cutoff wiring,
  high-precision fractional seconds, known offsets, and fail-closed malformed
  date, calendar, time, and unknown-offset cases.
- `pnpm test:packages`: all 13 package test targets passed before the final
  strict-cutoff refinement; its affected Worker suite was rerun afterward as
  recorded above.
- `pnpm typecheck`: all 13 package typecheck targets passed. The final affected
  Worker typecheck also passed after strict cutoff validation was added.
- `pnpm build`: all package build targets passed; Vite emitted only existing
  third-party sourcemap warnings.
- `pnpm check:openapi`: all three generated OpenAPI drift checks passed.
- `pnpm docs:check`: all three documentation build/link checks passed after
  the final glossary update.
- Repository task, deployment-plan, documentation, workspace-boundary,
  OpenAPI, and repoledger patch checks passed 118 tests with
  `--testTimeout=15000`. The standard 5-second repoledger patch-test budget
  timed out during temporary Git operations; the unchanged assertion passed
  in 9.89 seconds with the wider budget.
- `node --check scripts/cas-app-space-smoke.mjs`: passed.
- `pnpm deploy:plan`: passed without publishing.
- A live App/Space smoke was not run because it requires deployment
  credentials, an active issuer, and a deployed environment. The updated smoke
  issuer passed build and syntax validation.

## Blockers

- None for source publication or primary integration. Delivery acceptance and
  any live deployment smoke remain external checkpoints.

## Outcome

An App can now issue a node lease/upload capability without granting durable
Root Ref mutation. Root Ref read and update, usage inspection, and GC execution
are independently grantable, while every capability remains bound to one
signed Space and one verified App issuer. Legacy broad v2 authority has a
bounded rollout path and is not accepted in steady state.

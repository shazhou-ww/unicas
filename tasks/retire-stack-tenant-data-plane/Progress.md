# Progress

Updated: 2026-09-22

## Current state

The reviewed Stack/Tenant App-user data plane has been removed from maintained
protocol, client, service, Cloudflare, authorization, OpenAPI, deployment,
smoke, and current-documentation surfaces. Retired HTTP routes and protected
resource metadata now fall through to `404` without schema initialization,
capability verification, or Durable Object dispatch. Retired claim and
permission shapes cannot authorize an App/Space request, and legacy or mixed
trusted scope headers fail closed with `400 INVALID_SCOPE_HEADERS`.

The released App/Space v1 route, capability, package-root clients, direct-upload
flow, storage kernels, Admin API, Admin WebUI, and Spaces App remain. Physical
bindings, Durable Object class identities, current App/Space D1/R2 data,
historical audit records, the private audit-reader port, and external identity
provider tenant vocabulary are unchanged. Focused and workspace-wide
validation are complete.

## Decisions

- Delete the unpublished Stack/Tenant route, claim, permission, verifier,
  client, browser-cache adapter, OpenAPI, smoke, and package subpath surfaces
  without aliases or credential translation.
- Keep the package-root App/Space v1 contract and all seven operations
  unchanged. Old public routes return ordinary `404`; old claim shapes fail
  App/Space authentication.
- Reject every occurrence of `X-CAS-Stack-Id` or `X-CAS-Tenant-Id` at the Space
  Durable Object instead of translating a complete pair into App/Space scope.
- Keep `CAS_DB`, `CAS_DO`, `CAS_DOMAIN_DO`, deployed Durable Object class names,
  `CAS_TENANT_AUDIT_READER`, historical audit vocabulary, provider tenant IDs,
  and physical reset inventory labels isolated in their owning adapters.
- Preserve all persisted data, schemas, keys, object namespaces, actor
  identities, browser databases, audit history, ownership, retention, and
  lifecycle state. Reopen business/data-model review before changing any of
  them.
- Make Admin and Spaces Web UI/API regression tests a hard delivery gate, as
  required by the requesting user.
- Add a maintained retirement guard for removed files, public export maps,
  symbols, smoke configuration, and current guidance while excluding negative
  runtime tests and historical task records.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | On 2026-09-22, with primary at `afacd80d5b0f3ae8d0f8bff3fa4a2ba1afda8c98`, the requesting user explicitly approved proceeding with the deletion and required that the Admin and Spaces Web UI/API remain unbroken. |
| Interface | Approved | On 2026-09-22, the requesting user approved the complete removal described in [InterfaceReview.md](./InterfaceReview.md) without requiring line-item review, conditional on preserving the released Admin and App/Space interfaces. |
| Business and data model | Not applicable | The implementation changes only code, interfaces, generated contracts, tests, configuration, and current guidance. It does not modify persisted data, schemas, keys, ownership, retention, or lifecycle state. |
| Architecture | Approved | On 2026-09-22, the requesting user approved the code-only deletion described in [Architecture.md](./Architecture.md), with unchanged Admin/App/Space behavior and unchanged physical storage and actor identities as mandatory constraints. |
| Delivery acceptance | Pending | Requires the final integrated primary commit and complete validation evidence. |

## Validation

- `pnpm --filter @unicas/space-protocol test`: 23 App/Space protocol,
  capability, route, and OpenAPI tests passed.
- `pnpm --filter @unicas/space-protocol typecheck`: passed.
- `pnpm check:openapi`: both maintained Admin and App/Space documents match
  their generators; no tenant OpenAPI document remains.
- `pnpm --filter @unicas/space-client test`: 4 package-root App/Space client
  tests passed; typecheck passed.
- `pnpm --filter @unicas/space-browser-cache test`: 11 App/Space cache tests
  passed; typecheck passed.
- `pnpm --filter @unicas/service test`: 135 tests passed; typecheck passed.
  The retired seven-route family is unmatched and invokes neither
  authorization nor actor dispatch.
- Focused Cloudflare Worker, App authority, and Durable Object validation: 42
  tests passed, including retired route `404`, no initialization/dispatch,
  legacy-header rejection, direct upload, reads, GC, and cross-App isolation.
- `pnpm --filter @unicas/service-cloudflare test`: all 254 tests passed across
  Worker routing, Admin BFF/API, MCP, audit, storage, and Durable Objects.
- `pnpm --filter @unicas/admin-protocol test`: 59 tests passed; typecheck
  passed.
- `pnpm --filter @unicas/admin-client test`: 14 tests passed; typecheck passed.
- `pnpm --filter @unicas/admin-webui test`: 79 UI/API tests passed; typecheck
  passed.
- `pnpm --filter @unicas/spaces test`: 59 App/API tests passed; typecheck
  passed.
- `pnpm docs:check`: all 7 documentation inventory, link, metadata, and
  deterministic-build tests passed.
- `pnpm exec vitest run tests/deploy-plan.test.mjs
  tests/stack-tenant-retirement.test.mjs`: all 39 deployment and retirement
  guard tests passed.
- `pnpm test:exhaustive`: all 138 repository checks and all 15 workspace
  package test suites passed.
- `pnpm clean && pnpm build`: all 15 workspace package builds passed from an
  empty generated-output state. Rebuilt protocol, client, service, Worker, and
  embedded Admin UI assets contain no retired contract, client, verifier, or
  compatibility-support identifier.
- `pnpm typecheck`: all 15 workspace package targets passed after final
  dependency cleanup.
- `pnpm deploy:plan`: produced the expected non-deploying Worker, protocol,
  client, and App/Space smoke plan.
- `pnpm check:tasks` and `git diff --check`: passed; Repoledger reports only
  the expected pending delivery-acceptance warnings.

## Blockers

- None for implementation or publication. Delivery acceptance remains the
  final human checkpoint after primary integration.

## Outcome

The legacy App-user entrypoints are removed while the released Admin and
App/Space products retain their tested behavior. The implementation is ready
for source publication, primary integration, and exact-commit delivery
acceptance.

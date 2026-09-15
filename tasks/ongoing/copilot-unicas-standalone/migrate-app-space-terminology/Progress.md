# Progress

Updated: 2026-09-14

## Checklist

- [x] Verify the new control-plane list is still smoke-only.
- [x] Inventory and classify Stack/Tenant occurrences by compatibility boundary.
- [x] Freeze the v1/v2 compatibility matrix.
- [x] Define the first contract-first implementation slice and its focused tests.
- [x] Add isolated v2 App/Space data routes and capability vocabulary.
- [x] Add the App/Space verifier with bidirectional token/route denial tests.
- [x] Define exported App, Space, Principal, and Profile schemas.
- [x] Generate a separately named Space v2 OpenAPI artifact without changing tenant v1.
- [x] Add the complete App-scoped administrator route family.
- [x] Define the core App, membership, and invitation administrator contract.
- [x] Extend the App contract with issuer, Playground, and audit operations.
- [x] Generate the separate App admin v2 OpenAPI artifact.
- [x] Introduce App/Space operations in the cloud-neutral service core.
- [x] Wire Space authority and scoped App administrator handlers in the platform adapter.
- [ ] Implement v2 managed capability issuance and shared admin route cutover.

## Current state

Phase 0 source classification and the compatibility matrix are complete. A
read-only query against the current control-plane origin returned exactly one
active resource named `Production Smoke`. The protocol package now exports an
isolated v2 App/Space route family plus `ver: 2`, `spaceId`, and `spaces:` CAS
capability vocabulary without changing v1 exports. The cloud-neutral service
now provides an independent App/Space verifier that retains issuer-derived App
authority and rejects both cross-version directions. It is not wired into the
Worker, so v2 remains unreachable at ingress. Shared App/Space identity now
lives in the data protocol, while the management protocol defines nested
Principal, Profile, App, and AppMembership schemas through the permitted
one-way protocol dependency. The Space data plane now has an independent
contract, generator, package export, and drift artifact. Its generator is a
separate command and does not write tenant v1. Milestone commit `c94a818`
records that foundation.
Second milestone commit `7818640` records the App routes and core contract. The
remaining issuer, managed capability, Playground, and audit operations now
complete the 23-operation typed App contract, and `admin-v2.openapi.json` is
generated independently from admin v1. Milestone commit `21549ff` records the
complete administrator contract. The cloud-neutral actor now classifies v2
Space and App administrator routes independently, accepts optional v2
authorization and handler ports, and dispatches authorized Space operations
with App/Space actor keys and trusted headers. Existing platform adapters that
do not provide those ports return 501 instead of falling through to v1. The
Cloudflare adapter now resolves App authority through an explicit adapter over
the current physical Stack issuer tables, accepts exactly one trusted v1 or v2
scope-header family, and maps scoped `/admin/apps/*` requests and responses
without changing physical schema names. Space requests now pass through the v2
verifier and reach the existing physical data repositories through that
explicit adapter. Managed Space capability issuance still returns 501 rather
than exposing a v1 token as v2. The next concrete action is to implement true
`ver: 2` managed issuance and choose the cutover behavior for shared
`/admin/me` and invitation-accept routes.

## Decisions

- Begin with the compatibility inventory and matrix required by the accepted
  plan; do not make implementation renames until those boundaries are explicit.
- Keep package access-plane names unchanged during the first contract slice.
- Treat route version, capability version, scope claim, and permission grammar
  as one authorization boundary; no implicit v1/v2 translation is allowed.
- Keep v1 and v2 OpenAPI generation commands separate so iterating on the new
  contract cannot rewrite a frozen legacy artifact.
- Build the App administrator contract in typed slices, but do not publish an
  incomplete admin v2 OpenAPI artifact.
- Keep platform v2 hooks optional until the adapter has explicit App authority
  and persistence implementations; recognized unconfigured routes fail 501.
- Until a backed-up physical rebuild is approved, map App/Space to the existing
  Stack/Tenant storage dimensions only inside an explicit versioned adapter and
  reject requests that mix the two trusted header families.
- Never translate a v1 managed capability response into v2; fail 501 until the
  signer emits `ver: 2`, `spaceId`, and `spaces:` permissions itself.

## Validation

- `pnpm check:tasks` passed: 1 file and 7 tests.
- `pnpm --filter @unicas/admin-cli build` passed.
- Repository CLI `status` confirmed an authenticated session bound to
  `https://console.unicas.work`.
- Repository CLI `stacks list --limit 100` returned exactly one active
  `Production Smoke` item and no next page.
- Initial focused protocol tests failed only on the intentionally absent v2
  route and capability exports; the existing contract tests remained green.
- `pnpm --filter @unicas/tenant-protocol test` passed: 3 files and 33 tests.
- `pnpm --filter @unicas/tenant-protocol typecheck` passed for source and test
  TypeScript projects.
- Focused App/Space verifier tests passed: 1 file and 4 tests, including mixed
  tokens carrying both v1 and v2 scope fields.
- `pnpm --filter @unicas/service test` passed: 12 files and 94 tests.
- `pnpm --filter @unicas/service typecheck` passed.
- `pnpm --filter @unicas/tenant-protocol test` passed: 3 files and 34 tests;
  its source and test typechecks passed.
- `pnpm --filter @unicas/admin-protocol test` passed: 4 files and 43 tests;
  its source and test typechecks passed.
- Workspace dependency boundaries passed: 1 file and 81 tests.
- `pnpm --filter @unicas/tenant-protocol test` passed after the v2 contract: 3
  files and 35 tests; source and test typechecks passed.
- `pnpm --filter @unicas/tenant-protocol docs:generate:v2` generated only
  `space-v2.openapi.json`.
- OpenAPI drift passed for admin v1, tenant v1, and Space v2: 3 tests.
- The Space v2 artifact contains no Stack/Tenant identifiers or descriptions;
  the tenant v1 artifact has no staged or working content diff.
- `pnpm test` passed all repository checks and all workspace package tests.
- `pnpm typecheck` passed all 13 workspace package TypeScript projects.
- Milestone commit `c94a818` (`feat: add App and Space v2 contract foundation`)
  was created with a clean post-commit worktree.
- Focused App administrator route tests passed all 50 v1 and v2 cases.
- `pnpm --filter @unicas/admin-protocol test` passed after the core App
  contract: 4 files and 70 tests.
- `pnpm --filter @unicas/admin-protocol typecheck` passed; editor diagnostics
  for the touched admin protocol files are clear.
- Milestone commit `7818640` (`feat: add App administrator core contract`) was
  created with a clean post-commit worktree.
- Complete App administrator contract tests passed: 4 files and 72 tests.
- `pnpm --filter @unicas/admin-protocol typecheck` passed after all 23
  operations were added.
- OpenAPI drift passed for admin v1, App admin v2, tenant v1, and Space v2: 4
  tests.
- `pnpm check:repo` passed after the complete App admin v2 artifact: 5 files
  and 106 tests.
- Milestone commit `21549ff` (`feat: complete App administrator v2 contract`)
  was created and pushed with the preceding migration commits.
- Focused cloud-neutral actor tests passed: 1 file and 7 tests.
- `pnpm --filter @unicas/service test` passed: 12 files and 98 tests; its
  typecheck passed.
- `pnpm --filter @unicas/service-cloudflare test` passed: 19 files and 185
  tests; its typecheck passed.
- Focused Worker routing tests passed: 1 file and 14 tests, including explicit
  501 behavior for unconfigured v2 routes.
- `pnpm --workspace-concurrency=1 test` passed all repository and package tests;
  serialized execution avoids Miniflare ephemeral-port collisions seen when
  package suites start concurrently.
- `pnpm typecheck` passed all 13 workspace package TypeScript projects after
  the cloud-neutral core change.
- Space authority, DO scope normalization, Worker routing, and App admin adapter
  tests passed in a serialized focused run: 4 files and 50 tests.
- `pnpm --filter @unicas/service-cloudflare typecheck` passed after platform
  wiring; `pnpm check:repo` passed 106 tests.
- App authority repository, trusted DO scope normalization, Worker Space
  routing, and scoped App admin compatibility tests passed: 4 files and 50
  tests.
- The complete Cloudflare test command remains intermittently affected by
  Miniflare ephemeral-port `EADDRINUSE`; all directly affected tests pass when
  run as a serialized focused batch.

## Blockers

- The CLI result covers the control-plane list only. Fresh D1 exports and
  direct D1, R2, KV, and relevant Durable Object inventories are still required
  before any destructive schema or resource cutover.

## Outcome

In progress.

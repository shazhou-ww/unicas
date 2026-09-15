# Progress

Updated: 2026-09-15

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
- [x] Implement v2 managed capability issuance.
- [x] Cut over shared administrator routes with the App client and WebUI.
- [x] Break down the remaining implementation and documentation work.
- [x] Complete the App administrator client transport.
- [x] Complete App CLI operations.
- [x] Complete remote/stdio App MCP operations and catalog parity.
- [x] Complete the WebUI and Playground App/Space migration.
- [x] Complete the App/Space browser-cache migration.
- [x] Add App/Space smoke coverage while retaining frozen v1 smoke.
- [x] Complete the documentation tracker.
- [x] Clear the physical inventory and strategy gate.
- [ ] Implement the clean physical App/Space schema and key source changes.
- [ ] Execute the approved production reset, deploy, smoke, and rollback validation.

## Current state

The compatibility matrix, v2 contracts, generated OpenAPI artifacts, verifier,
Worker ingress, physical compatibility adapter, and managed Space capability
issuance are implemented. V2 requests are authorized by issuer-derived App
authority and exact Space scope, while v1 remains a separate frozen contract.
Milestone commits through `83e502e` record the contract foundation and the
completed public App/Space surfaces before the physical storage slices.

The new environment returns App-shaped responses for the shared `/admin/me` and
invitation-accept paths. Admin client, CLI, remote/stdio MCP, and WebUI control
surfaces now expose App operations while retained v1 names and schemas remain
explicit compatibility contracts. The Playground keeps file roots as
Principal-owned control records but uses managed Space capabilities, v2 data
routes, and a versioned App/Space browser cache.

`RemainingWork.md` now owns the dependency-ordered implementation breakdown,
and `Documentation.md` owns documentation classification and completion. The
complete App administrator transport covers CRUD, membership, Playground,
issuer, managed capability, and App/Space audit operations while retaining all
v1 methods unchanged. The App CLI exposes version-distinct App CRUD,
membership, issuer, ref-domain, and audit commands, with `--space-id` on v2
audit operations and an explicit legacy v1 help section. A shared protocol
catalog now defines all 23 App MCP tools; remote and stdio use the same input
schemas, descriptions, annotations, and names while legacy tools remain
unchanged. The WebUI control surface now uses `#/apps/{appId}`, `/admin/apps`,
App membership with separate Principal/Profile, App issuer operations, and
App-shaped control audit. The Playground now retains Principal-owned file roots
while using managed Space capabilities, `/v2/apps/{appId}/spaces/{spaceId}`
data routes, and a non-colliding v2 browser cache keyed by Principal, App, and
Space. App/Space smoke is the deployment default, frozen v1 smoke remains
explicit, and the documentation tracker is complete with all retained old
terminology classified. The next concrete action is the section 7 physical
source slice in `RemainingWork.md`: replace the new environment's physical
control/data schema, Durable Object naming, and R2 keys with App/Space names,
then update the reset plan and tests. `CutoverInventory.md` proves the current
environment is smoke-only and selects a clean rebuild. Production reset/deploy
was not executed and still requires fresh off-machine backups, repeated
inventory, rendered plan review, and explicit approval.

The clean physical source cutover has started. Control D1 now creates
`cas_apps`, `cas_app_members`, and related App tables with `app_id`; its
repository, authority resolver, Worker issuer lookups, and direct D1 fixtures
use the same schema. The clean migration no longer alters, copies, or deletes
legacy Stack tables. Data D1, Durable Object names, R2 keys, reset tooling, and
all production execution remain unchanged. The next concrete action is the
data D1 `app_id`/`space_id` slice.

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
- Do not negotiate two schemas on the shared `/admin/me` or invitation-accept
  URLs through extra fields or an undocumented version header. Keep v1 active
  during staging, then switch the new environment's BFF, client, and WebUI to
  the App response shapes in one change; the frozen legacy deployment remains
  untouched.
- Track implementation dependencies in `RemainingWork.md` and documentation in
  `Documentation.md`; keep stable docs for accepted consensus and task-specific
  inventories and execution state inside this task folder.

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
- Managed issuer tests passed: 1 file and 3 tests, including independent v1 and
  v2 JWT signature and claim verification.
- Cloud-neutral control administrator tests passed: 1 file and 14 tests,
  including membership and active-issuer enforcement for both issuance paths.
- App adapter and administrator BFF tests passed: 2 files and 34 tests; v2 mint
  requires session CSRF, returns 201, and is never cacheable.
- D1-backed control-plane integration passed: 1 file and 12 tests; the managed
  Space token was authorized by `AppAuthorityRepository` and
  `AppSpaceCapabilityVerifier`.
- `@unicas/service` and `@unicas/service-cloudflare` typechecks passed; editor
  diagnostics for the touched implementation files are clear.
- Admin client tests passed: 1 file and 10 tests, including explicit v1/v2
  identity contract mismatch rejection.
- Focused WebUI tests passed: 2 files and 20 tests for App identity consumption
  and invitation acceptance; its production build and typecheck passed.
- Admin CLI tests passed: 6 files and 31 tests; remote MCP tests passed: 1 file
  and 5 tests. Both catalogs expose `get_current_principal` while preserving
  the legacy `whoami` schema.
- Shared-route actor, App adapter, and Worker tests passed: 3 files and 28
  tests, covering App precedence plus exact Principal, Profile, and membership
  response mapping.
- `pnpm typecheck` passed all 13 workspace package projects.
- `pnpm check:repo` passed 5 files and 106 tests, including all four OpenAPI
  drift checks and repository dependency boundaries.
- `pnpm --workspace-concurrency=1 test` passed every repository and package
  suite, including 198 Cloudflare adapter tests and 49 WebUI tests.
- `pnpm build` passed all 13 workspace packages, including the production
  WebUI bundle and generated Cloudflare Worker assets.
- App administrator client completion passed 1 file and 14 tests, covering App
  paths, response vocabulary, CSRF, ETags, idempotency, pagination, and
  `spaceId` audit filters; its typecheck and editor diagnostics passed.
- App CLI CRUD passed 2 focused files and 18 tests, covering `/admin/apps`
  dispatch, App-shaped JSON, ETag resolution, CSRF, idempotency, and explicit
  legacy help separation; the CLI typecheck and editor diagnostics passed.
- The completed App CLI package passed 6 files and 41 tests plus typecheck,
  covering App membership confirmation, issuer activation, ref domains,
  Principal audit actors, and `spaceId` Root Ref filters while preserving v1.
- Shared App MCP catalog validation passed 72 admin-protocol tests, 42
  admin-cli/stdio tests, and 15 focused remote/adapter tests. Remote D1 tests
  cover App CRUD, Principal/Profile membership, Playground records, App audit,
  physical `tenantId` to public `spaceId` mapping, and mutation gates; the
  Cloudflare package typecheck passed.
- The App WebUI control surface passed all 9 files and 49 tests plus typecheck;
  the production bundle and Worker inlined assets were regenerated. Routes,
  list/detail, members, issuer, control audit, and Playground now use App/Space
  vocabulary and routes while file roots remain Principal-owned records.
- Space transport and cache validation passed 10 tenant-client tests, 12
  browser-cache tests, and 30 focused Playground tests. V2 keys isolate App and
  Space and cannot collide with v1; existing verifier tests cover cross-App,
  cross-Space, and bidirectional cross-version denial.
- App/Space smoke is now the deployment default and covers the canonical CAS
  flow, Root Ref idempotency, cross-Space isolation, and bidirectional
  cross-version denial. The original v1 script remains available as
  `pnpm smoke:v1`; 12 deployment tests, script syntax checks, and
  `pnpm deploy:plan` passed. Live smoke remains a deployment-gate action.
- The first documentation slice updated the stable CLI/MCP guides, admin-cli
  README, agent skill, and WebUI connection examples. The 18-page docs build,
  docs tests, and task-link checks passed; retained Stack/Tenant terms in this
  slice are explicitly legacy, physical mapping, or package identifiers.
- Documentation completion updated the normative baseline, architecture,
  binary/state/GC, OAuth migration record, operations, deployment,
  observability, package guides, product site, and agent skill. Final classified
  scan found only allowed legacy/physical/package/downstream/unrelated matches;
  docs build, 3 docs tests, 4 OpenAPI drift tests, and 7 task tests passed.
- Physical gate evidence is recorded in `CutoverInventory.md`: both remote D1
  exports are non-empty and hashed; one Production Smoke App and one
  `deploy-smoke` data scope remain; production R2's exact two-object set matches
  D1, preview R2 and OAuth KV are empty, and the DO classes have no persistent
  local storage. The non-executing reset validator passed; no destructive or
  deployment operation ran.
- Control D1 schema tests passed: 1 file and 4 tests, including idempotent clean
  App table creation, absence of Stack tables, `app_id` columns, and preserved
  managed issuer lifetime configuration.
- D1-backed control-plane integration passed all 12 tests after the repository
  and authority resolver moved to the App physical schema.
- Authority and Worker issuer lookup tests passed: 2 files and 20 tests.
- The complete `@unicas/service-cloudflare` suite passed: 20 files and 202
  tests; its TypeScript project typecheck passed.

## Blockers

- Production reset/deploy requires fresh off-machine backups, a repeated
  aggregate inventory, rendered reset-plan review, and explicit approval for
  the destructive maintenance window.

## Outcome

In progress.

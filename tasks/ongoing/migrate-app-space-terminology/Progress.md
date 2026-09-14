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
- [ ] Extend the App contract with issuer, Playground, and audit operations.
- [ ] Generate the separate App admin v2 OpenAPI artifact.

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
separate command and does not write tenant v1. The next concrete action is the
corresponding App administrator contract and artifact. Milestone commit
`c94a818` records that foundation. Since the commit, the protocol has gained
the complete 23-operation App route matcher and a typed 9-operation core
contract for identity, App CRUD, membership, and invitations. The next
concrete action is to add issuer, managed capability, Playground, and audit
contracts before generating the App admin v2 artifact.

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

## Blockers

- The CLI result covers the control-plane list only. Fresh D1 exports and
  direct D1, R2, KV, and relevant Durable Object inventories are still required
  before any destructive schema or resource cutover.

## Outcome

In progress.
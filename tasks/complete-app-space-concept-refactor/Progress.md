# Progress

Updated: 2026-09-21

## Current state

The reviewed public package-family cutover is implemented: all five data-plane
packages now use `space-*` directories and package specifiers, current
App/Space exports are canonical, frozen Stack/Tenant protocol and client
construction are available only through explicit `./v1` entrypoints, and the
file workflow exports only `SpaceFile*` names. Workspace consumers, build
paths, TypeScript references, the lockfile, current documentation links, and
the private Spaces App have migrated together.

Cloud-neutral node and Root Ref ports and Cloudflare repositories now carry
only `{ appId, spaceId }`. The Space Durable Object keeps its deployed class
and identity while its source module and shared actor port use Space names.
Frozen v1 authorization, routes, claims, clients, caches, and protected-resource
metadata are visibly versioned; private legacy Admin/audit and Microsoft OIDC
terms remain only in classified adapters. A reason-bearing terminology guard
rejects obsolete package identities, unclassified legacy identifiers, and
stale allowances.

Implementation and agent-verifiable acceptance checks are complete. The next
action is source publication, primary integration, and delivery acceptance for
the exact integrated commit.

## Decisions

- Rename `tenant-protocol`, `tenant-client`, `tenant-blob-client`,
  `tenant-file-client`, and `tenant-browser-cache` to the corresponding
  `space-*` packages without package aliases or a deprecation shell.
- Keep current App/Space protocol and transport exports at each package root.
  Keep frozen Stack/Tenant routes, claims, permissions, types, and client
  construction under `@unicas/space-protocol/v1` and
  `@unicas/space-client/v1`.
- Replace the ambiguous protocol `openapi.json` export with explicit
  `openapi-v1.json`; retain `openapi-v2.json` until the separate wire-version
  cutover task.
- Rename the public file workflow to `createSpaceFileSystem` and the complete
  `SpaceFile*` type family. Do not retain TypeScript aliases for obsolete
  `TenantFile*` names.
- Preserve both wire contracts, capability versions and permissions,
  persistence schemas, object keys, and Durable Object identities during this
  naming-only stage.
- Use one vocabulary-neutral transport core and browser-cache core while the
  package roots expose only App/Space keys and explicit `./v1` adapters own
  Stack/Tenant keys.
- Split capability ownership into shared mechanics, current Space vocabulary,
  and frozen-v1 vocabulary without changing error identity or token grammar.
- Require every retained identifier to have one exact path/term allowance with
  a category, reason, and removal condition. Exclude tasks and generated output
  structurally rather than through broad allowances.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | The requesting user reviewed [Task.md](./Task.md) and explicitly directed execution of this task on 2026-09-21. The approval was bound to primary revision `0cb717094e9cd0968a8e3c22f8c9c75e40c85e41`. |
| Architecture | Approved | The requesting user explicitly approved [Architecture.md](./Architecture.md) on 2026-09-21 at primary revision `0cb717094e9cd0968a8e3c22f8c9c75e40c85e41`. This covers the five-package map, explicit v1 boundary, canonical App/Space internals, unchanged persistence and Durable Object identities, terminology guard, staged migration, and rollback. |
| Interface | Approved | The requesting user explicitly approved [InterfaceDesign.md](./InterfaceDesign.md) on 2026-09-21 at primary revision `0cb717094e9cd0968a8e3c22f8c9c75e40c85e41`. This covers clean package cutover, root and `./v1` exports, file API renames, explicit OpenAPI subpaths, no aliases, and wire compatibility. |
| Business and data model | Not applicable | App, Space, Principal, node, lease, Root Ref, ownership, persistence, and lifecycle semantics are unchanged. |
| Delivery acceptance | Pending | Requires the final integrated primary commit and complete validation evidence. |

## Validation

- `pnpm check:workspace`: 123 workspace-boundary and deployment-plan tests
  passed after the five package-directory, manifest, dependency, TypeScript
  reference, and lockfile changes.
- `pnpm typecheck`: all 14 package targets passed after current and frozen-v1
  consumers were separated.
- `pnpm --filter @unicas/space-protocol test`: 41 protocol, capability,
  route, contract, and cross-version tests passed after the explicit v1 source
  split.
- `pnpm check:openapi`: all three generated OpenAPI documents matched their
  source; the frozen tenant v1 document remained unchanged.
- `pnpm --filter @unicas/space-client test`: 10 current and frozen-v1 client
  tests passed through the new root and `./v1` ownership.
- `pnpm --filter @unicas/service test`: 147 service tests passed, including
  frozen-v1 verification and cross-version capability denial.
- `pnpm --filter @unicas/space-file-client test`: 7 file workflow and
  manifest tests passed with the clean `SpaceFile*` API.
- `pnpm --filter @unicas/spaces test`: 59 private consumer tests passed after
  package and file API migration.
- `pnpm check:repo`: task, deployment, documentation, workspace-boundary,
  OpenAPI, and terminology checks passed 130 tests. The unchanged repoledger
  temporary-Git test exceeded its default five-second budget, then passed in
  9.7 seconds with `--testTimeout=15000`.
- `pnpm --filter @unicas/admin-protocol test`: 59 Admin contract and
  cross-plane tests passed after adding current Space and explicit v1 policy
  entries.
- Focused Cloudflare scope validation passed 63 Root Ref, audit, and Durable
  Object tests; Worker and Durable Object module validation passed another 57
  tests after the explicit v1/Space module split.
- `pnpm --filter @unicas/space-browser-cache test`: 12 persistence, isolation,
  invalidation, cancellation, and v1/current collision tests passed.
- `pnpm check:terminology`: the complete maintained-source inventory passed
  with no old package identities, unclassified identifiers, or stale entries.
- `pnpm docs:check`: all three documentation inventory, anchor/link rewrite,
  and generated-link checks passed.
- `pnpm test:packages`: all 14 workspace package test targets passed.
- `pnpm build`: all 14 workspace package build targets passed; Vite reported
  only existing third-party sourcemap warnings.

## Blockers

- None for source publication or primary integration. Delivery acceptance
  remains the final human checkpoint.

## Outcome

Maintained consumers and current/shared internals now identify the public data
plane by App and Space. Frozen Stack/Tenant compatibility remains testable and
behaviorally unchanged behind explicit versioned imports and ingress adapters.
Current consumers cannot accidentally import its route, claim, client, or cache
vocabulary from a canonical package root, and CI rejects reintroduction of old
package identities or unexplained legacy terms.
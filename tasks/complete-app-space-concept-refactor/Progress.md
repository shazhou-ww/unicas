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

The next implementation stage is to rename cloud-neutral and Cloudflare
current/shared scopes from Stack/Tenant to App/Space, isolate the remaining v1
ingress and control-record adapters, and add the reviewed reason-bearing
terminology guard.

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
- `pnpm check:repo`: task, deployment, documentation, workspace-boundary, and
  OpenAPI checks passed 129 tests. The unchanged repoledger temporary-Git test
  exceeded its default five-second budget, then passed in 9.9 seconds with
  `--testTimeout=15000`.

## Blockers

- None for the next implementation stage.

## Outcome

Maintained consumers now identify the public data plane by Space rather than
Tenant. Frozen Stack/Tenant compatibility remains testable and behaviorally
unchanged behind explicit versioned imports, while current consumers cannot
accidentally import its route, claim, or client-construction vocabulary from a
canonical package root.
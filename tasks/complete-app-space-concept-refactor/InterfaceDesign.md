# Package and export interface review

Status: Approved by the requesting user on 2026-09-21.

## Decision requested

Approve a clean repository cutover from the five `@unicas/tenant-*` package
specifiers to `@unicas/space-*`, with no temporary package aliases or root
export aliases.

The packages are currently version `0.1.0`, all maintained consumers are in
this workspace, and beta package preparation/publication is owned by later
tasks. Frozen v1 wire compatibility is retained through explicit `./v1`
exports in the renamed protocol and transport packages; retaining old package
identities is not required to retain v1 behavior.

## Package compatibility matrix

| Current package | Replacement package | Old specifier after cutover | Consumer action |
| --- | --- | --- | --- |
| `@unicas/tenant-protocol` | `@unicas/space-protocol` | Absent | Replace imports; use root for current Space APIs or `./v1` for frozen v1. |
| `@unicas/tenant-client` | `@unicas/space-client` | Absent | Replace imports; construct current clients from root or frozen clients from `./v1`. |
| `@unicas/tenant-blob-client` | `@unicas/space-blob-client` | Absent | Replace imports; neutral `CasBlob*` APIs otherwise keep their signatures. |
| `@unicas/tenant-file-client` | `@unicas/space-file-client` | Absent | Replace imports and rename `TenantFile*` symbols to `SpaceFile*`. |
| `@unicas/tenant-browser-cache` | `@unicas/space-browser-cache` | Absent | Replace imports; use the explicit v1 cache adapter only for frozen clients. |

No alias packages, npm deprecation shells, re-export-only compatibility
packages, `paths` aliases, or dual package names are introduced. A repository
source scan and workspace dependency guard reject reintroduction of the old
specifiers.

## Protocol exports

`@unicas/space-protocol` exports:

| Subpath | Owned surface |
| --- | --- |
| `.` | Current App/Space contract, routes, schemas, capability vocabulary, and neutral CAS types. |
| `./v1` | Frozen Stack/Tenant contract, routes, headers, claims, permission vocabulary, and v1-only types. |
| `./openapi-v1.json` | Frozen `tenant-v1.openapi.json` document. |
| `./openapi-v2.json` | Generated current `space-v2.openapi.json` document. |

The package root keeps current names such as `SpaceApiBasePath`,
`spaceApiContract`, `AppSpaceRoute`, `appSpaceRoutes`, `matchAppSpaceRoute`,
`SpaceCapabilityClaims`, and the six exact Space operation permissions.
Neutral `CasHash`, node, Root Ref, usage, error, and response types remain at
the root when they are shared by current consumers.

The `./v1` subpath owns `CasTenantApiBasePath`, `casTenantApiContract`,
`CasStackPath`, `CasTenantPath`, `CasRoute`, `casRoutes`, `matchCasRoute`,
`TenantCapabilityClaims`, and the v1 permission vocabulary. These symbols keep
their spellings and runtime values; only their source/package ownership
becomes explicit.

The ambiguous old `./openapi.json` subpath is removed with the old package
identity. Consumers select an explicit versioned OpenAPI subpath.

## Client exports

`@unicas/space-client` root:

```ts
export {
  createSpaceCasClient,
  DEFAULT_SPACE_NODE_LEASE_OPTIONS,
  CasClientError,
};

export type {
  SpaceCasClient,
  SpaceCasClientConfig,
  SpaceCasNodeCacheKey,
  CasHttpFetcher,
  CasNodeCache,
  CasNodeRange,
  CasNodeSource,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
};
```

`@unicas/space-client/v1`:

```ts
export { createTenantCasClient };
export type {
  TenantCasClient,
  TenantCasClientConfig,
  TenantCasNodeCacheKey,
};
```

Frozen v1 factory arguments, request construction, routes, headers,
capability acceptance, and results remain unchanged. The v1 factory delegates
through one compatibility adapter to the canonical implementation; current
Space callers never receive `stackId` or `tenantId` fields.

## Higher-level exports

`@unicas/space-blob-client` keeps neutral public names:

- `createCasBlobClient`
- `CasBlobClient`, `CasBlobHandle`, `CasBlobRef`, `CasBlobSource`
- `storeNodeContent`, `leaseNodeContent`
- blob-index types and encoding helpers

Only package specifiers, comments, and internal scopes change unless a public
name actually contains obsolete Stack/Tenant vocabulary.

`@unicas/space-file-client` renames the complete public family:

| Current export | Replacement export |
| --- | --- |
| `createTenantFileSystem` | `createSpaceFileSystem` |
| `TenantFileRootInfo` | `SpaceFileRootInfo` |
| `TenantFileRootCatalog` | `SpaceFileRootCatalog` |
| `TenantFileRoot` | `SpaceFileRoot` |
| `TenantFileSystem` | `SpaceFileSystem` |
| `TenantFileSystemOptions` | `SpaceFileSystemOptions` |
| `TenantFileStat` | `SpaceFileStat` |
| `TenantFileWriteOptions` | `SpaceFileWriteOptions` |
| `TenantFileManifest*` | `SpaceFileManifest*` |

No deprecated symbol aliases remain. The private `@unicas/spaces` App migrates
in the same change and supplies compile-time consumer coverage.

`@unicas/space-browser-cache` exposes App/Space cache keys and policy from its
root. Any Stack/Tenant cache-key shape needed by `createTenantCasClient` is
owned by an explicit v1 adapter and remains partitioned from App/Space cache
entries exactly as today.

## Source and tooling paths

The repository cutover updates together:

- package directories, package `name` and descriptions, workspace dependency
  keys, `pnpm-lock.yaml`, root and package TypeScript references;
- every TypeScript/JavaScript import and dynamic built-package path;
- local runtime aliases, deploy filters, smoke scripts, Spaces bootstrap and
  preflight scripts;
- package READMEs, `/packages/README.md`, `/GLOSSARY.md`, current architecture,
  operations, App-user API, debug, and smoke documentation;
- OpenAPI generation inputs and drift tests;
- package boundary tests and the final task-local terminology inventory.

Tooling must not depend on compatibility filesystem paths. Generated `dist`,
TypeScript build info, Wrangler state, docs-site output, and bundled UI source
are cleaned or regenerated; they are never hand-edited.

## Wire and authorization compatibility

| Surface | Result |
| --- | --- |
| App/Space v2 paths and JSON | Unchanged. The separate cutover task owns `/v2` to `/v1`. |
| Space capability claim version and grammar | Unchanged. |
| Six Space permissions | Unchanged and still exact-operation permissions. |
| Stack/Tenant v1 paths and JSON | Unchanged. |
| Stack/Tenant v1 capability and permissions | Unchanged and accepted only on v1 routes. |
| Cross-version authorization | Unchanged: neither claim family authorizes the other route family. |
| D1 schema and persisted rows | Unchanged; already keyed by `app_id` and `space_id`. |
| R2 keys and Durable Object identities | Unchanged. |
| Package and TypeScript source API | Intentional clean break described above. |

The v1 subpaths are compatibility ownership boundaries, not aliases between
wire versions. They do not translate v1 requests into App/Space routes or
allow v1 capabilities on current routes.

## Consumer migration

Current Space consumer:

```ts
import { createSpaceCasClient } from "@unicas/space-client";
import type { SpaceCapabilityClaims } from "@unicas/space-protocol";
```

Frozen v1 compatibility consumer:

```ts
import { createTenantCasClient } from "@unicas/space-client/v1";
import type { TenantCapabilityClaims } from "@unicas/space-protocol/v1";
```

File workflow consumer:

```ts
import {
  createSpaceFileSystem,
  type SpaceFileRootCatalog,
} from "@unicas/space-file-client";
```

Consumers replace package specifiers and renamed file symbols in one update.
Runtime endpoint configuration, capabilities, persisted identifiers, and data
do not migrate.

## Compatibility duration and removal

- Old `@unicas/tenant-*` package names cease to exist when this repository
  change lands; there is no deprecation window because no beta package has
  been published from the later publication workflow.
- Frozen v1 wire and `./v1` exports remain until the dedicated
  `retire-stack-tenant-data-plane` task is reviewed, implemented, and accepted.
- Current `v2` source/module labels remain until
  `cut-over-app-space-api-to-v1`; this task does not pre-apply that wire change.
- If external package publication or an unsupported external consumer is
  discovered before implementation, this review reopens. No alias is added
  without a new compatibility decision and explicit removal version.

## Validation contract

The implementation must prove:

- old package specifiers and obsolete current symbols are absent from
  maintained source outside the reviewed task-local inventory;
- each renamed package passes directory/name, dependency/import, TypeScript
  reference, build, typecheck, and focused tests;
- generated current OpenAPI matches source and frozen v1 OpenAPI remains
  behaviorally unchanged;
- current App/Space and frozen Stack/Tenant clients both pass runtime tests;
- cross-version claims and routes remain mutually rejecting;
- the private Spaces App and smoke scripts compile and run through public
  packages only.

## Review question

Approve the clean five-package cutover, exact root and `./v1` exports, file API
renames, explicit OpenAPI subpaths, absence of aliases/deprecation shells, and
the stated wire and consumer compatibility contract?
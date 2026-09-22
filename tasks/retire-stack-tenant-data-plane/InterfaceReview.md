# Stack/Tenant data-plane removal inventory and interface review

Status: Pending review.

## Decision requested

Approve complete removal of the unpublished Stack/Tenant App-user interface,
with no route, capability, client, package-export, configuration, or parser
alias. The released App/Space v1 interface remains unchanged.

Legacy HTTP requests and protected-resource metadata requests will return the
ordinary unsupported-route response. Legacy JWTs will have no parser or
verifier in the App-user path and cannot be translated into App/Space
authority. Existing persisted App/Space data and physical storage identities
will not be renamed, deleted, or migrated.

## Replacement prerequisite

The completed App/Space v1 cutover provides the surviving seven-operation
contract at `/v1/apps/{appId}/spaces/{spaceId}` with exact-operation
permissions, cross-App and cross-Space isolation, generated OpenAPI, public
clients, runtime dispatch, and production smoke coverage. This review does not
change that contract.

## Removal inventory

### Protocol and generated contract

| Maintained surface | Current legacy interface | Removal result |
| --- | --- | --- |
| `packages/space-protocol/src/v1.ts` and `src/v1/**` | `CasTenantApiBasePath`, `casTenantApiContract`, legacy HTTP types, `casRoutes`, `matchCasRoute`, `CasRoute`, capability claims, permission constructors and parsers | Delete the legacy source family. Keep the package-root App/Space v1 surface. |
| `packages/space-protocol/package.json` | `./v1` and `./v1/openapi.json` exports | Remove both exports without aliases. |
| `packages/space-protocol/scripts/openapi.ts` and `scripts/generate-openapi.ts` | `generateV1OpenApiDocument` and the tenant document writer | Remove legacy generation while preserving App/Space generation. |
| `packages/space-protocol/openapi/tenant-v1.openapi.json` | Generated Stack/Tenant contract | Delete through the maintained generator workflow and update drift checks. |
| `stacks/unicas/local/runtime.mjs` | Legacy OpenAPI package mapping | Remove the mapping. |

The removed route family contains these operations:

| Operation | Legacy path |
| --- | --- |
| `readContent` | `GET /stacks/{stackId}/tenants/{tenantId}/cas/nodes/{hash}/content` |
| `readMetadata` | `GET /stacks/{stackId}/tenants/{tenantId}/cas/nodes/{hash}/metadata` |
| `leaseNode` | `POST /stacks/{stackId}/tenants/{tenantId}/cas/nodes/{hash}/lease` |
| `getUsage` | `GET /stacks/{stackId}/tenants/{tenantId}/cas/usage` |
| `runGc` | `POST /stacks/{stackId}/tenants/{tenantId}/cas/gc` |
| `listRootRefs` | `GET /stacks/{stackId}/tenants/{tenantId}/root-refs` |
| `updateRootRefs` | `POST /stacks/{stackId}/tenants/{tenantId}/root-refs` |

### Capability and authorization

Delete the complete legacy claim family from
`packages/space-protocol/src/v1/capability.ts`:

- `TenantCapabilityClaims`, `SessionCapabilityClaims`, and
  `VerifiedCapability`;
- `CapabilityPermission` and parsed permission types;
- `casReadPermission`, `casWritePermission`, and `casManagePermission`;
- session permission constructors; and
- `parseCapabilityPermission` and `hasCapabilityPermission`.

The removed grammar is:

```text
tenants:{tenantId}:cas:read
tenants:{tenantId}:cas:write
tenants:{tenantId}:cas:manage
tenants:{tenantId}:sessions:create
tenants:{tenantId}:sessions:{sessionId}:read
tenants:{tenantId}:sessions:{sessionId}:write
```

Delete the legacy verifier and authority adapter:

| Owner | Legacy surface | Removal result |
| --- | --- | --- |
| `packages/service/src/v1/tenant-auth.ts` | `V1StackTenantCapabilityVerifier`, resolver and event types, payload normalization, stale-authority cache, `v1PermissionFor` | Delete; do not reuse its parser for App/Space. |
| `packages/service/src/index.ts` | Public re-exports of the legacy verifier and route types | Remove exports. |
| `packages/service-cloudflare/src/control-authority.ts` | `AuthorityRepository` translating the App issuer registry into Stack authority | Delete the Stack repository and `toAuthority`; keep `AppAuthorityRepository`. |
| `packages/service-cloudflare/src/worker.ts` | Verifier construction, legacy authorization callback, Stack protected-resource metadata and scopes | Delete all legacy branches. |
| `packages/admin-protocol/src/authz.ts` and `threat-model.ts` | Active-policy entries for the legacy data plane | Remove support claims while retaining the administrator/App-user separation rules. |

There is no cutoff, broad-permission fallback, dual claim, hidden parser, or
translation period. A token containing the old claim shape is merely an
unrecognized credential for the surviving App/Space route.

### Clients and browser cache

| Maintained surface | Current legacy interface | Removal result |
| --- | --- | --- |
| `packages/space-client/src/v1.ts` and `src/v1/**` | `createTenantCasClient`, `TenantCasClient*`, `TenantCasNodeCacheKey`, `V1CasNodeCache` | Delete source, types, fixtures, and focused legacy tests. |
| `packages/space-client/package.json` | `./v1` export | Remove without an alias. |
| `packages/space-browser-cache/src/v1.ts` | Stack/Tenant cache-key adapter and `createBrowserCasNodeCache` compatibility surface | Delete the adapter and legacy tests. |
| `packages/space-browser-cache/package.json` | `./v1` export | Remove without an alias. |
| `unicas-node-cache-v1` | Legacy browser database namespace | Stop opening it; do not delete users' browser data. Browser storage cleanup is client-owned and outside this task. |

`@unicas/space-client`, `@unicas/space-browser-cache`,
`@unicas/space-blob-client`, and `@unicas/space-file-client` retain their
package-root App/Space APIs. Canonical node media types and binary formats in
`@unicas/codec` are shared storage formats, not Stack/Tenant interfaces, and
remain unchanged.

### Runtime, configuration, and verification

| Maintained surface | Current legacy interface | Removal result |
| --- | --- | --- |
| `packages/service/src/actor.ts` | `v1-stack-tenant` route union, contexts, matcher, authorization callback, dispatch, trusted Stack/Tenant headers | Delete the branch. Unknown Stack/Tenant paths do not reach authorization or a Durable Object. |
| `packages/service/src/control-validation.ts` | `v1StackOAuthResource` | Delete. |
| `packages/service-cloudflare/src/worker.ts` | `/stacks/` origin ownership and `/.well-known/oauth-protected-resource/stacks/{stackId}` | Remove; both paths fall through to `404`. |
| `packages/service-cloudflare/src/space-do.ts` | Translation of `X-CAS-Stack-Id` and `X-CAS-Tenant-Id` into App/Space scope | Remove translation and reject legacy or mixed scope headers. |
| `scripts/cas-middleware-smoke.mjs` and root `smoke:v1` | Executable Stack/Tenant regression smoke | Delete after equivalent App/Space survival and legacy rejection checks are in place. |
| `.github/workflows/ci.yml` and `tests/deploy-plan.test.mjs` | Frozen-v1 smoke step, IDs, command, and ordering assertions | Remove legacy execution; require App/Space smoke and retirement rejection guards. |
| Stack and package documentation | Current setup, debugging, architecture, migration, and operation guidance for the old interface | Remove or rewrite as App/Space-only guidance. Historical task records remain unchanged. |

Current tests that positively exercise frozen routes, claims, clients, cache
keys, verifier behavior, protected-resource metadata, and trusted-header
translation are removed or rewritten as negative retirement guards. Current
App/Space isolation, exact-permission, Root Ref, usage, GC, and direct-upload
tests remain.

## Retained names and adapters

These occurrences are not public Stack/Tenant compatibility. They remain
isolated from the released HTTP, SDK, capability, and package-export surfaces.

| Name or adapter | Owner | Reason retained | Isolation boundary | Removal condition |
| --- | --- | --- | --- | --- |
| `unicas-tenant` and `CAS_DB` | Cloudflare deployment and local runtime | Stable physical D1 database and binding used by current App/Space data | Wrangler/runtime binding only; no wire or SDK field | Separately approved storage migration with backup, recovery, and deployment plan |
| `CAS_DO`, `CAS_DOMAIN_DO`, `CasDurableObject`, and `RootRefDomainDurableObject` | Cloudflare adapter | Stable current single-writer identities | Worker binding and actor implementation only | Separately approved Durable Object migration |
| `apps/{appId}/spaces/{spaceId}/nodes-v2/{hash}` | R2 repository | Current immutable object namespace | Repository adapter only | Separately approved object migration and recovery plan |
| `_uploads/v1/**` and `_uploads/v2/**` | Direct-upload repository and reset tooling | Historical temporary object generations may remain recoverable | R2 cleanup/recovery implementation only | Proven-empty inventory plus an approved retention and deletion plan |
| Existing audit action strings and records | Control/data audit storage | Historical events must remain readable and immutable | Audit persistence/decoding only | Never rewrite history; stop emitting a value only through a separately reviewed audit compatibility change |
| `CAS_TENANT_AUDIT_READER`, internal `stackId`/`tenantId` audit query names | Admin BFF/MCP to local audit-reader adapter | Current administrator Root Ref audit reads still use this internal port | Private same-deployment RPC; public admin inputs and outputs use App/Space names; it never authorizes App-user requests | Rename in a coordinated internal audit-port change after all BFF/MCP callers and operational configuration can move atomically |
| Microsoft/Entra tenant identifiers | `control-auth` and provider adapters | External identity-provider vocabulary | Provider-specific claims and configuration | Only if the provider contract changes |
| JavaScript error `stack`, UI layout stacks, TanStack, and historical `tasks/**` prose | Language, framework, and immutable task history | Unrelated vocabulary or accepted historical record | Outside maintained App-user contract scans | Not part of this retirement |

Current D1 schemas use `app_id` and `space_id`; current R2 keys and Durable
Object keys are already App/Space-shaped. No row, object, schema, key,
namespace, cache database, audit record, or lifecycle state is deleted or
migrated by this decision.

## Rejection and migration behavior

| Caller behavior | Result after removal |
| --- | --- |
| Call `/stacks/{stackId}/tenants/{tenantId}/...` | `404`; no capability verification or storage dispatch |
| Fetch Stack protected-resource metadata | `404` |
| Import `@unicas/space-protocol/v1` or its OpenAPI subpath | Package export absent |
| Import `@unicas/space-client/v1` or `@unicas/space-browser-cache/v1` | Package export absent |
| Present a legacy capability to App/Space v1 | Authentication failure; no legacy parser or authority translation |
| Send legacy trusted-scope headers directly to the Space actor | Rejected; never translated |
| Use released App/Space v1 clients and capabilities | Unchanged |

Because the old surface was unpublished, migration means moving prototype
callers to the released package-root App/Space clients and obtaining an
App/Space capability. No compatibility alias or automatic credential
conversion is provided.

## Review and validation contract

Implementation must add maintained-source and structured package/export
guards for the removed routes, claims, permissions, symbols, subpaths,
generated contract, smoke configuration, and current-documentation guidance.
Runtime tests must prove `404` rejection without verifier or Durable Object
dispatch, rejection of legacy internal headers, surviving App/Space
authorization denial, and cross-App/cross-Space isolation.

Focused validation:

```text
pnpm --filter @unicas/space-protocol test
pnpm --filter @unicas/space-client test
pnpm --filter @unicas/space-browser-cache test
pnpm --filter @unicas/service test
pnpm --filter @unicas/service-cloudflare test
pnpm check:openapi
pnpm docs:check
pnpm check:workspace
pnpm typecheck
pnpm build
pnpm test:exhaustive
pnpm deploy:plan
```

## Review question

Approve the classified inventory, complete no-alias interface removal,
ordinary rejection behavior, unchanged App/Space v1 contract, retained-name
policy, and absence of any persisted-data or lifecycle migration?
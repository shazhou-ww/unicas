# App/Space v1 cutover architecture review

Status: Approved by the requesting user on 2026-09-21.

## Decision requested

Approve one clean repository cutover from prototype App/Space HTTP v2 and
Space capability versions 2/3 to the released App/Space v1 interface in
[InterfaceDesign.md](./InterfaceDesign.md), without a v2 alias or persisted
data migration.

Approval permits route, authorization, client, Cloudflare adapter, generated
artifact, smoke, and current-documentation changes. Frozen Stack/Tenant v1
remains isolated and behaviorally unchanged.

## Ownership boundaries

```text
App/Space v1 source and public packages
  @unicas/space-protocol root
    -> @unicas/space-client
      -> @unicas/space-blob-client
        -> @unicas/space-file-client
          -> @unicas/spaces

Cloud-neutral dispatch
  @unicas/service App/Space route matcher + capability verifier
    -> trusted App/Space scope headers
      -> @unicas/service-cloudflare Worker + CasDurableObject

Frozen Stack/Tenant compatibility
  @unicas/space-protocol/v1
    -> @unicas/space-client/v1
      -> explicit V1StackTenant verifier and ingress adapter
```

No default/root App/Space export depends on or translates through the frozen
Stack/Tenant modules.

## Protocol source and generation

Rename prototype-owned source to released ownership:

| Prototype | Released |
| --- | --- |
| `src/space-v2-contract.ts` | `src/space-contract.ts` |
| `/v2/apps/{appId}/spaces/{spaceId}` | `/v1/apps/{appId}/spaces/{spaceId}` |
| prototype `*Space*` operation IDs | neutral released operation IDs |
| `openapi/space-v2.openapi.json` | `openapi/app-space-v1.openapi.json` |
| `openapi-v2.json` export | package-root `openapi.json` export |

Keep `spaceApiContract`, `SpaceApiBasePath`, `appSpaceRoutes`, and
`matchAppSpaceRoute` as the canonical root symbols; their values represent the
only released App/Space interface. No `v2` builder, matcher, contract, or
operation identifier remains exported or maintained.

The frozen Stack/Tenant generator continues to import only `src/v1/*` and
writes `tenant-v1.openapi.json`. Its package export moves under
`./v1/openapi.json` so both v1 families remain unambiguous.

OpenAPI remains source-generated. Generated JSON is never manually edited.

## Service routing and authorization

`matchUniCasServiceRoute` keeps three explicit branches:

```text
v1-stack-tenant  /stacks/{stackId}/tenants/{tenantId}/...
space            /v1/apps/{appId}/spaces/{spaceId}/...
app-admin         /admin/...
```

The App/Space matcher never recognizes `/v2/apps/...`; the frozen matcher never
recognizes `/v1/apps/...`. Unknown prototype routes reach the existing `404`
path, not a redirect, rewrite, or compatibility adapter.

The control plane's `appOAuthResource` derivation changes from
`<public-origin>/v2/apps/{appId}` to `<public-origin>/v1/apps/{appId}`. Issuer
inspection/replacement persists this exact value as the authority audience;
verification continues to compare JWT `aud` with the persisted value. Existing
frozen Stack/Tenant protected-resource metadata remains unchanged.

The App/Space verifier accepts only released Space claim `ver: 1`. Remove:

- `LEGACY_SPACE_CAPABILITY_VERSION`;
- `legacyV2IssuedBefore` options and branches;
- `legacyAppSpacePermissionFor`;
- `CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE` parsing/configuration; and
- all prototype v2/v3 issuance acceptance tests except explicit denial tests.

The verifier still derives App authority from the verified issuer, checks
signed Space scope, exact permission, lifetime, and signed Root Ref domain.
Frozen Stack/Tenant authorization remains in `service/src/v1` and continues to
accept only its own ver 1 grammar.

## Trusted internal dispatch

Public route versions do not define persistence identity. Replace the current
internal `X-CAS-Api-Version: 2` selector with an unversioned trusted marker:

```text
X-CAS-Route-Family: app-space
```

The service creates this header only after App/Space route matching and
authorization. The Space DO uses it to select the JSON lease flow; absence
continues to select frozen-v1 lease handling. External callers cannot select
scope or authorization because the edge actor overwrites trusted headers.

The DO continues to reject mixed `X-CAS-App-Id`/`X-CAS-Space-Id` and
`X-CAS-Stack-Id`/`X-CAS-Tenant-Id` families.

## Cloudflare edge

Update public-origin ownership to recognize `/v1/apps` on the App API origin.
Keep `/v2/apps` unowned and unsupported. The Worker still serves one deployment
unit for App/Space, frozen v1, Admin, MCP/OAuth, and static Admin assets.

Do not rename or recreate:

- `CAS_DO` or `CAS_DOMAIN_DO` bindings;
- `CasDurableObject` or `RootRefDomainDurableObject` class exports;
- actor identity encoding;
- D1 tables, columns, indexes, triggers, or rows; or
- R2 buckets and object keys.

## Clients, cache, and workflows

`@unicas/space-client` keeps its public methods and configuration shape. Only
route construction changes to `/v1`. Change the public
`SpaceCasNodeCacheKey.version` discriminant from prototype `2` to released `1`.
This is an intentional clean break for custom cache implementations; the key's
App, Space, hash, and cache behavior are unchanged.

`@unicas/space-browser-cache` continues to encode existing private namespace
and database strings (`"v2"`, `unicas-node-cache-v2`) so browser persistence is
not migrated or invalidated by a wire-only cutover. It accepts the released
public `version: 1` key and maps it to those existing private identifiers.
Those strings are private storage format identifiers and are narrowly excluded
from the prototype-route scan.

Blob and file clients require no method or business-semantics changes. Their
underlying `SpaceCasClient` route behavior changes atomically. The Spaces App
updates capability issuance, preflight, bootstrap, smoke probe, and worker
composition to released claim ver 1.

## Root Ref behavior

Keep one `POST .../root-refs` update carrying a mixed signed delta map. No
directional routes, methods, permissions, request schemas, or internal
commands are introduced.

The cloud-neutral kernel remains responsible for canonicalization, ready-node
validation for positive deltas, non-negative aggregate validation,
idempotency, revision planning, and atomic commit. Any bounded post-commit GC
hint is based on actual committed negative deltas and is not encoded in route
identity.

## Physical compatibility invariants

The following remain byte-for-byte or identity compatible:

- D1 keys beginning with `(app_id, space_id)`;
- Root Ref request/event/revision/projection keys;
- R2 `apps/{appId}/spaces/{spaceId}/nodes-v2/{hash}` keys;
- temporary `_uploads/v2/{generation}` keys;
- Space actor key `encode(appId)|encode(spaceId)`;
- Root-domain actor key `encode(appId)|encode(refDomain)`;
- `unicas-node-cache-v2` and its internal key prefix;
- canonical-node and file-manifest bytes; and
- historical audit events.

No schema migration, data rewrite, cache migration, or Durable Object identity
change belongs to this task.

## Prototype removal guard

Add a narrow API-version regression test, not a general terminology policy.
It scans maintained source, current docs, examples, scripts, and package
metadata for these forbidden public artifacts:

```text
/v2/apps
space-v2-contract
space-v2.openapi.json
openapi-v2.json
readSpaceContent
readSpaceMetadata
leaseSpaceNode
getSpaceUsage
runSpaceGc
listSpaceRootRefs
updateSpaceRootRefs
CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE
legacyV2IssuedBefore
X-CAS-Api-Version
```

The test excludes historical `tasks/**`, generated/build output, third-party
dependencies, Microsoft `/v2.0` endpoints, and the exact private persistence
strings listed above. Protocol runtime tests separately prove `/v2/apps/...`
does not match or dispatch.

## Cross-version proofs

Focused tests must prove:

- every released method/path matches exactly under `/v1/apps/...`;
- every prototype `/v2/apps/...` path is unmatched and returns `404`;
- frozen Stack/Tenant paths remain matched only by the frozen matcher;
- released Space ver 1 claims authorize only App/Space v1;
- prototype Space ver 2 and ver 3 claims authorize no released operation;
- frozen Stack/Tenant ver 1 claims cannot authorize App/Space v1;
- released Space ver 1 claims cannot authorize frozen Stack/Tenant routes;
- broad permissions never satisfy exact permissions;
- App, Space, and refDomain mismatches fail closed; and
- atomic mixed-sign Root Ref retries and conflicts remain unchanged.

## Generated and documentation surfaces

Update together:

- protocol exports and package export maps;
- Space OpenAPI generator, drift tests, and Scalar docs-site input;
- local runtime aliases;
- `appOAuthResource` audience derivation and issuer inspection/replacement
  fixtures;
- service and Cloudflare fixtures;
- public client, browser cache types, and higher-level package fixtures;
- Spaces App issuer and workflows;
- App/Space smoke and deployment-plan assertions;
- architecture, operations, deployment, topology, App-user API, and migration
  guidance.

Current documentation contains no prototype route or capability acceptance
guidance after cutover. Frozen-v1 documentation remains visibly scoped.

## Rollout and rollback

The repository and release artifact cut over atomically. There is no checked-in
dual-route phase because neither prototype surface is supported publicly.

Deployment order for one release window:

1. validate App issuer replacement/inspection can produce the released v1
   audience and claim grammar;
2. deploy the service Worker with only App/Space v1 support;
3. deploy the Spaces App and smoke consumer using v1;
4. run released v1 smoke, frozen-v1 regression smoke, and prototype rejection
   probes; and
5. publish docs and later package releases from the same accepted commit.

A transient mismatch during this unpublished deployment window fails closed.
Rollback restores the previous Worker and Spaces App artifacts together. It
does not restore a database, object key, Durable Object namespace, or audit
record. Do not add a v2-to-v1 alias as rollback machinery.

## Validation

Focused:

```text
pnpm --filter @unicas/space-protocol test
pnpm --filter @unicas/space-client test
pnpm --filter @unicas/service test
pnpm --filter @unicas/service-cloudflare test
pnpm --filter @unicas/spaces test
pnpm check:openapi
pnpm docs:check
```

Repository and build:

```text
pnpm check:workspace
pnpm typecheck
pnpm build
pnpm test:exhaustive
pnpm deploy:plan
```

Behavioral smoke requires a deployed target and credentials:

```text
pnpm smoke:v1
pnpm smoke
pnpm spaces:smoke -- --base-url <target>
```

## Review question

Approve the clean no-alias cutover, Space claim ver 1, exact service and
Cloudflare boundaries, unchanged persistence identities, narrow prototype
guard, coordinated rollout, rollback, and validation plan?

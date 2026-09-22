# Stack/Tenant data-plane retirement architecture review

Status: Pending review.

## Decision requested

Approve deletion of the Stack/Tenant route and authority pipeline from each
owning layer, while leaving the App/Space v1 pipeline and all physical storage
identities unchanged. Approval permits service, authorization, Cloudflare,
client, generated-contract, deployment, guard, and current-documentation
changes described here and in [InterfaceReview.md](./InterfaceReview.md).

## Boundary after retirement

```mermaid
flowchart LR
  Caller[App user] --> Protocol[@unicas/space-protocol]
  Protocol --> Client[@unicas/space-client]
  Client --> Worker[Cloudflare Worker]
  Worker --> Matcher[App/Space route matcher]
  Matcher --> Verifier[Space capability verifier]
  Verifier --> Actor[Cloud-neutral Space actor]
  Actor --> Headers[Trusted App/Space scope headers]
  Headers --> DO[CasDurableObject]
  DO --> D1[(CAS_DB)]
  DO --> R2[(CAS_BUCKET)]

  Legacy[Stack/Tenant route or token] --> Reject[404 or authentication failure]
  Reject -. no verifier or dispatch .-> Worker
```

The removed path is not redirected, rewritten, or translated into the
surviving path.

## Ownership changes

### Protocol and packages

`@unicas/space-protocol` owns only the package-root App/Space v1 contract and
its package-root OpenAPI export. Its `src/v1` implementation, `./v1` export,
legacy OpenAPI export, generator branch, and generated tenant document are
deleted together.

`@unicas/space-client` and `@unicas/space-browser-cache` delete their explicit
v1 adapters and export-map entries. Higher-level blob and file packages remain
on the package-root `SpaceCasClient` path. No compatibility package, TypeScript
path alias, conditional export, or source-only back door replaces the removed
subpaths.

### Cloud-neutral service

`matchUniCasServiceRoute` no longer imports or invokes the legacy matcher and
has no `v1-stack-tenant` union member. `ServiceContext` loses the legacy
authorization callback, and dispatch no longer creates
`X-CAS-Stack-Id`/`X-CAS-Tenant-Id`.

Delete `service/src/v1/tenant-auth.ts` rather than merging it into the current
verifier. The current `SpaceCapabilityVerifier` remains the only App-user JWT
capability verifier and continues to require the released claim version,
App-bound issuer authority, signed Space identity, exact operation permission,
lifetime bounds, and signed Root Ref domain where applicable.

### Cloudflare edge and adapters

The Worker stops classifying `/stacks/` as an App-user origin route, removes
Stack protected-resource metadata, removes the legacy verifier and authority
repository, and does not initialize or dispatch a legacy request context.

`CasDurableObject` accepts only trusted App/Space scope headers. Legacy or
mixed scope headers fail closed; there is no Stack/Tenant-to-App/Space
translation branch. The current App authority repository, service actor,
schema, repositories, and Root Ref domain actor remain.

The administrator audit-reader path is not an App-user authority path. Its
legacy internal names remain narrowly documented as described in
[InterfaceReview.md](./InterfaceReview.md); public administrator requests and
responses stay App/Space-shaped.

## Removal sequence

1. Add replacement and rejection tests plus a dedicated retirement guard.
2. Remove protocol/client/cache public exports and their positive legacy
   tests, then regenerate the surviving OpenAPI document.
3. Remove cloud-neutral route matching, dispatch, verifier, permission mapping,
   and public service exports.
4. Remove the Cloudflare authority adapter, metadata route, origin ownership,
   trusted-header translation, and positive legacy runtime tests.
5. Remove the legacy smoke script, workflow/configuration inputs, local
   OpenAPI alias, and deployment-plan expectations.
6. Remove or rewrite current documentation and run the final classified scan.

Each step keeps App/Space v1 tests executable. No step changes data or actor
identity, so there is no schema or data migration stage.

## Guard design

A dedicated repository test scans maintained source, tests, manifests,
scripts, stacks, workflows, and current documentation while excluding
`tasks/**`, dependencies, build output, and explicitly classified external or
physical vocabulary. It rejects reintroduction of:

```text
/stacks/{...}/tenants/{...}
@unicas/space-protocol/v1
@unicas/space-client/v1
@unicas/space-browser-cache/v1
tenant-v1.openapi.json
casTenantApiContract
casRoutes
TenantCapabilityClaims
createTenantCasClient
TenantCasClient
V1StackTenant*
v1StackOAuthResource
v1PermissionFor
authorizeV1StackTenantRequest
dispatchV1StackTenantRequest
X-CAS-Stack-Id
X-CAS-Tenant-Id
UNICAS_SMOKE_STACK_ID
UNICAS_SMOKE_TENANT_ID
smoke:v1
cas-middleware-smoke
```

Package-manifest assertions independently verify that the three `./v1`
subpaths and legacy OpenAPI export are absent. OpenAPI drift checks verify only
the generated App/Space document and assert that no maintained generator or
tenant document remains.

Runtime tests prove:

- Stack/Tenant paths are unmatched and return `404`;
- Stack protected-resource metadata returns `404`;
- no legacy authorization callback or authority resolver runs;
- legacy trusted headers are rejected by the Space actor;
- legacy claim grammar cannot authorize App/Space v1;
- App/Space route dispatch and exact permission checks still work; and
- cross-App, cross-Space, and Root Ref-domain mismatches still fail closed.

The guard uses exact API identifiers and path/package patterns, not a blanket
ban on words such as `tenant` or `stack`, so provider terminology, JavaScript
language terms, physical compatibility names, and historical task records are
not rewritten.

## Generated artifacts and documentation

The OpenAPI source generator is changed first and its maintained output is
then regenerated or removed through repository scripts. Generated `dist`,
docs-site output, and bundled UI assets are never hand-edited.

Current docs become App/Space-only. Historical task artifacts remain at their
stable paths. Any retained physical or external term is documented with its
owner and isolation boundary rather than presented as a supported route,
claim, client, or deployment option.

## Data-model assessment

Business and data-model review is not applicable to the approved code-only
retirement because it performs none of the following:

- D1 schema, row, index, or key changes;
- R2 object deletion or prefix migration;
- Durable Object class, namespace, or identity changes;
- browser database deletion;
- audit history rewriting; or
- ownership, retention, GC, or lifecycle changes.

Stop and reopen that checkpoint before any implementation that would alter
one of those facts. In particular, historical names are not permission to
delete or rename the resources they identify.

## Deployment and rollback

The repository produces one Worker that contains only the released App/Space
App-user route family. Before deployment, exhaustive tests and the deployment
plan must pass. After deployment, probes verify the released operations,
cross-scope denial, old route `404`, old protected-resource metadata `404`,
and absence of legacy dispatch.

Rollback redeploys the previous complete Worker and coordinated consumer
artifacts. It does not restore a database, object, actor namespace, browser
cache, or audit log because the retirement changes none of them. A rollback
alias is not checked into the forward implementation.

Repository configuration for the old smoke and its IDs is removed. Deleting
or rotating external secrets is an operational follow-up, not a prerequisite
for code retirement, and must not expose secret values in repository state.

## Validation

Focused package tests run after each ownership layer changes. Final validation
uses the commands listed in [InterfaceReview.md](./InterfaceReview.md), plus a
clean maintained-source scan and runtime rejection evidence. Deployment review
uses `pnpm deploy:plan`; production deployment remains an explicitly protected
operation.

## Review question

Approve the layer-by-layer deletion, fail-closed runtime behavior, targeted
guard design, unchanged physical storage and actor identities, no-data-change
assessment, and code-only rollback plan?
# App and Space migration inventory

Captured: 2026-09-14

This inventory classifies migration surfaces by compatibility boundary. It is
an ownership map, not a request for global text replacement.

## Current environment

The repository version of the administrator CLI was built and used for a
read-only query against `https://console.unicas.work`. The control plane
returned exactly one active resource named `Production Smoke` and no next
page. No resource identifiers or administrator profile data are recorded here.

This proves the current control-plane list is smoke-only. It does not prove the
tenant D1 database, R2 bucket, OAuth KV namespace, or Durable Object namespaces
contain no additional state. Direct remote inventories and non-empty D1
exports remain mandatory immediately before a destructive cutover.

## Public wire contracts

| Surface | Current owner | Current contract | Migration responsibility |
| --- | --- | --- | --- |
| Data routes | [`tenant-protocol/src/routes.ts`](/packages/tenant-protocol/src/routes.ts) | `/stacks/{stackId}/tenants/{tenantId}` | Add an explicit `/v2/apps/{appId}/spaces/{spaceId}` route family and retain version identity in matching. |
| Admin routes | [`admin-protocol/src/routes.ts`](/packages/admin-protocol/src/routes.ts) | `/admin/stacks/{stackId}` | Introduce App operations without silently changing a v1 operation schema. |
| Admin JSON | [`admin-protocol/src/types.ts`](/packages/admin-protocol/src/types.ts), [`schemas.ts`](/packages/admin-protocol/src/schemas.ts) | `CasStack*`, `stackId`, `tenantId` | Define `App`, `AppMembership`, `AppOAuthIssuer`, `AppAuditEvent`, and App/Space fields. |
| Data JSON | [`tenant-protocol/src/schemas.ts`](/packages/tenant-protocol/src/schemas.ts), [`http.ts`](/packages/tenant-protocol/src/http.ts) | Stack/Tenant-scoped usage and Root Ref payloads | Define v2 Space-scoped payloads while preserving Root Ref semantics. |
| Capabilities | [`tenant-protocol/src/capability.ts`](/packages/tenant-protocol/src/capability.ts) | `ver: 1`, `tenantId`, `tenants:{tenantId}:cas:*` | Add `ver: 2`, `spaceId`, and `spaces:{spaceId}:cas:*`; never translate one version implicitly. |
| OpenAPI | [`tenant-v1.openapi.json`](/packages/tenant-protocol/openapi/tenant-v1.openapi.json), `admin-v1.openapi.json` | Generated v1 artifacts | Keep v1 artifacts frozen and generate separately named v2 artifacts. |
| CLI | [`admin-cli/src/cli.ts`](/packages/admin-cli/src/cli.ts) | `stacks`, `<stackId>`, `--tenant-id` | Add the accepted `apps`, `<appId>`, and `--space-id` vocabulary with an explicit contract transition. |
| MCP | [`service-cloudflare/src/mcp/server.ts`](/packages/service-cloudflare/src/mcp/server.ts), [`admin-cli/src/mcp/catalog.ts`](/packages/admin-cli/src/mcp/catalog.ts) | `list_stacks`, `get_stack`, `stackId`, `tenantId` | Add App/Space tools and keep remote and stdio catalogs structurally identical. |
| WebUI | [`admin-webui/src/ui/app.tsx`](/packages/admin-webui/src/ui/app.tsx), [`views`](/packages/admin-webui/src/ui/views) | `#/stacks/{stackId}` and Stack labels | Move to `#/apps/{appId}` and accepted App/Space labels after protocol types exist. |
| Audit | [`admin-protocol/src/schemas.ts`](/packages/admin-protocol/src/schemas.ts) | `stackId`, optional `tenantId`, actor and target evidence | Expose `appId`, optional `spaceId`, and Principal while retaining immutable actor evidence. |

The current route and authorization tests intentionally freeze v1 behavior in
[`tenant-protocol/tests/routes.test.ts`](/packages/tenant-protocol/tests/routes.test.ts),
[`admin-protocol/tests/routes.test.ts`](/packages/admin-protocol/tests/routes.test.ts),
and [`service/tests/tenant-auth.test.ts`](/packages/service/tests/tenant-auth.test.ts).
There is no v2 route matcher or capability parser today, and `ver: 2` is
currently rejected.

## Cloud-neutral domain

- Control resources and operations are owned by
  [`admin-protocol`](/packages/admin-protocol/src) and
  [`service/src/account.ts`](/packages/service/src/account.ts).
  Their Stack types and operations become App concepts after the v2 contract is
  fixed.
- Data scopes, route inputs, and authorization are owned by
  [`tenant-protocol`](/packages/tenant-protocol/src) and
  [`service`](/packages/service/src). Tenant domain names become Space
  concepts without changing lease, usage, GC, Root Ref, or single-writer
  behavior.
- Issuer authority remains trusted platform data. A v2 token does not gain App
  authority from a caller-provided claim.

## Principal and Profile

The existing operator model already separates its immutable key from display
metadata through `CasOperatorIdentityKey`, `CasOperatorIdentity`, and
`ControlPlaneCallContext`. The v2 contract must make that separation explicit:

```text
Principal = (issuer, subject)
Profile   = displayName and emailForDisplay
```

Membership and authorization depend only on Principal identity. Profile
changes must not alter App membership or Space access.

## Physical storage

These identifiers are migration inputs, not blind rename targets:

| Storage boundary | Current owner | Current identity |
| --- | --- | --- |
| Control D1 | [`control-schema.ts`](/packages/service-cloudflare/src/control-schema.ts) | `cas_stacks`, `cas_stack_members`, related `stack_id` columns |
| Data D1 | [`schema.ts`](/packages/service-cloudflare/src/schema.ts) | `stack_id` and `tenant_id` dimensions across node, upload, Root Ref, usage, and GC state |
| Durable Objects | [`do-names.ts`](/packages/service-cloudflare/src/do-names.ts), [`tenant-do.ts`](/packages/service-cloudflare/src/tenant-do.ts) | Composite Stack/Tenant coordinator names |
| R2 | [`do-names.ts`](/packages/service-cloudflare/src/do-names.ts) | `stacks/{stackId}/tenants/{tenantId}/nodes-v2/{hash}` |
| Browser cache | [`tenant-browser-cache/src/index.ts`](/packages/tenant-browser-cache/src/index.ts) | Endpoint/Principal/Stack/Tenant namespace |

The physical migration is gated on fresh D1 exports plus direct D1, R2, KV,
and relevant Durable Object inventory. If state is not exclusively smoke data,
stop and retain physical v1 names behind adapters.

## Preserved legacy and unrelated contracts

- The `unicas.shazhou.work` environment, its routes, data, tokens, audiences,
  issuers, and Cloudflare resources remain unchanged.
- Canonical CAS bytes, hashes, `application/vnd.unidocs.cas-node.v1`, Root Ref
  semantics, and `refDomain` do not change.
- ETags, revisions, idempotency keys, cursors, upload headers, and lifecycle
  invariants do not change.
- `unidocs-cap+jwt` remains unchanged unless token branding is separately
  versioned and reviewed.
- Package directories keep their current access-plane names during the first
  contract slice. Package renames must follow, not lead, the boundary decision.

## First implementation slice

Add the v2 data route and capability vocabulary beside the frozen v1 contract,
with focused tests proving:

1. v2 routes extract `appId` and `spaceId`;
2. v2 capabilities accept only `spaceId` and `spaces:` permissions;
3. v1 tokens cannot authorize v2 routes;
4. v2 tokens cannot authorize v1 routes; and
5. issuer-derived App authority must match the v2 route App.

This slice is limited to protocol and cloud-neutral authorization. It does not
rename D1 tables, R2 keys, Durable Object names, cache namespaces, packages,
CLI commands, MCP tools, or WebUI routes.
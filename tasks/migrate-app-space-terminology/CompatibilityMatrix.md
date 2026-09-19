# App and Space compatibility matrix

Frozen: 2026-09-14

The version is part of the authorization boundary. App/Space is a v2 contract,
not an alias or reinterpretation of Stack/Tenant v1.

| Concern | V1 contract | V2 contract | Required boundary |
| --- | --- | --- | --- |
| Environment | Frozen `unicas.shazhou.work` deployment | New `unicas.work` deployment and target origins | Never migrate or route legacy resources through the new deployment. |
| Data route | `/stacks/{stackId}/tenants/{tenantId}/...` | `/v2/apps/{appId}/spaces/{spaceId}/...` | Match exact route families; no fallback between them. |
| Route identity | `stackId` and `tenantId` | `appId` and `spaceId` | Do not expose v1 field names in v2 JSON or route parameters. |
| Capability version | `ver: 1` | `ver: 2` | Missing, unknown, or route-mismatched versions fail closed. |
| Scope claim | `tenantId` | `spaceId` | Never read one claim as the other. |
| Permission | `tenants:{tenantId}:cas:{operation}` | `spaces:{spaceId}:cas:{operation}` | Parse separate grammars and require an exact route resource match. |
| App authority | Issuer resolves to Stack authority | Issuer resolves to App authority | Independently resolve issuer authority; never trust a caller-supplied App claim. |
| Token type | `unidocs-cap+jwt` | `unidocs-cap+jwt` unless separately versioned | Use the version claim, route family, and permission grammar together. |
| Admin resource | Stack and Stack member | App and App membership | New methods and schemas use App vocabulary; no silent response-schema change. |
| Principal | Issuer and subject operator identity | `Principal { issuer, subject }` | Identity key remains immutable across profile changes. |
| Profile | Display name and display email metadata | `Profile { displayName, emailForDisplay }` | Profile remains non-authoritative. |
| Audit dimension | `stackId`, optional `tenantId` | `appId`, optional `spaceId` | Preserve actor evidence, ordering, cursor, and revision semantics. |
| OpenAPI | `tenant-v1` and `admin-v1` artifacts | Separately named v2 artifacts | Do not overwrite or regenerate v1 from v2 schemas. |
| CLI | `stacks`, `--tenant-id` | `apps`, `--space-id` | Transition explicitly; do not change v1 machine JSON under an old command name. |
| MCP | Stack/Tenant tool names and schemas | App/Space tool names and schemas | Keep tool names version-distinct and remote/stdio catalogs equal. |
| WebUI | Stack routes and labels | App routes and Space labels | Do not treat a Playground file root as a Space. |
| Physical state | `stack_id`, `tenant_id`, Stack/Tenant object prefixes | `app_id`, `space_id`, App/Space object prefixes | Rebuild only after backup and a fresh smoke-only inventory; otherwise adapt. |
| Browser cache | Stack/Tenant namespace | Versioned App/Space namespace | Old and new entries must never collide. |
| Root Ref | Existing `refDomain`, balances, events, revisions | Same semantics with App/Space dimensions | Preserve ordering, idempotency, projection, and revision invariants. |
| CAS representation | Existing canonical bytes, hashes, media type | Unchanged | Terminology migration must not alter content identity. |

## Authorization combinations

| Route | Token | Result |
| --- | --- | --- |
| V1 Stack/Tenant | V1 matching Stack/Tenant | Evaluate existing v1 authorization. |
| V1 Stack/Tenant | V2 App/Space | Reject before operation authorization. |
| V2 App/Space | V1 Stack/Tenant | Reject before operation authorization. |
| V2 App/Space | V2 matching App/Space | Evaluate issuer-to-App, Space claim, and exact permission matches. |
| Either version | Missing or unknown version | Reject fail-closed. |
| V2 App/Space | V2 with mismatched issuer App, Space claim, or permission Space | Reject fail-closed. |

## Cutover gate

The 2026-09-14 read-only control-plane query returned only `Production Smoke`.
Immediately before physical replacement, repeat the control query, export both
D1 databases, inventory D1/R2/KV and relevant Durable Object state, and verify
all records and keys are within the explicit smoke target. Any other consumer
or data changes the strategy from rebuild to side-by-side adapters.
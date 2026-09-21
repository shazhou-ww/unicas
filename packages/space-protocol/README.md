# @unicas/space-protocol

Cloud-neutral UniCAS Space data-plane contracts and capability vocabulary.

The package keeps two disjoint contracts:

- frozen Stack/Tenant v1: `casTenantApiContract`, `casRoutes`, `ver: 1`,
  `tenantId`, and `tenants:` permissions;
- App/Space v1 HTTP API: `spaceApiContract`, `appSpaceRoutes`, capability
  `ver: 1`, signed `spaceId`, and exact `cas:{resource}:{action}` permissions.

Both cover node, lease, usage, garbage collection, and Root Ref operations.
Binary CAS node bodies remain streamable. Neither version reinterprets claims
or routes from the other.

Derive an implementation or client type from the shared contract:

```ts
import type { ContractRouterClient } from "@orpc/contract";
import { spaceApiContract } from "@unicas/space-protocol";
import { casTenantApiContract } from "@unicas/space-protocol/v1";

type TenantClient = ContractRouterClient<typeof casTenantApiContract>;
type SpaceClient = ContractRouterClient<typeof spaceApiContract>;
```

Generate the OpenAPI 3.1 JSON from the repository root:

```text
pnpm --filter @unicas/space-protocol docs:generate
pnpm --filter @unicas/space-protocol docs:generate:space
```

The generated files are `openapi/tenant-v1.openapi.json` and
`openapi/app-space-v1.openapi.json`. The package exports them as
`./v1/openapi.json` and `./openapi.json`, respectively. Generation commands are
separate and never overwrite the frozen v1 artifact.

Validate with:

```text
pnpm --filter @unicas/space-protocol typecheck
pnpm --filter @unicas/space-protocol test
```

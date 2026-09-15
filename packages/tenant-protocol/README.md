# @unicas/tenant-protocol

Cloud-neutral UniCAS data-plane contracts and capability vocabulary. The
`tenant-protocol` package name is a stable access-plane identifier; the public
v2 resource is Space.

The package keeps two disjoint contracts:

- frozen Stack/Tenant v1: `casTenantApiContract`, `casRoutes`, `ver: 1`,
  `tenantId`, and `tenants:` permissions;
- App/Space v2: `spaceApiContract`, `appSpaceRoutes`, `ver: 2`, `spaceId`, and
  `spaces:` permissions.

Both cover node, lease, usage, garbage collection, and Root Ref operations.
Binary CAS node bodies remain streamable. Neither version reinterprets claims
or routes from the other.

Derive an implementation or client type from the shared contract:

```ts
import type { ContractRouterClient } from "@orpc/contract";
import { casTenantApiContract, spaceApiContract } from "@unicas/tenant-protocol";

type TenantClient = ContractRouterClient<typeof casTenantApiContract>;
type SpaceClient = ContractRouterClient<typeof spaceApiContract>;
```

Generate the OpenAPI 3.1 JSON from the repository root:

```text
pnpm --filter @unicas/tenant-protocol docs:generate
pnpm --filter @unicas/tenant-protocol docs:generate:v2
```

The generated files are `openapi/tenant-v1.openapi.json` and
`openapi/space-v2.openapi.json`. The package exports them as `./openapi.json`
and `./openapi-v2.json`. Generation commands are separate and never overwrite
the frozen v1 artifact.

Validate with:

```text
pnpm --filter @unicas/tenant-protocol typecheck
pnpm --filter @unicas/tenant-protocol test
```
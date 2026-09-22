# @unicas/space-protocol

Cloud-neutral UniCAS Space data-plane contracts and capability vocabulary.

The package exposes the App/Space v1 HTTP API through `spaceApiContract`,
`appSpaceRoutes`, capability `ver: 1`, signed `spaceId`, and exact
`cas:{resource}:{action}` permissions. It covers node, lease, usage, garbage
collection, and Root Ref operations. Binary CAS node bodies remain streamable.

Derive an implementation or client type from the shared contract:

```ts
import type { ContractRouterClient } from "@orpc/contract";
import { spaceApiContract } from "@unicas/space-protocol";

type SpaceClient = ContractRouterClient<typeof spaceApiContract>;
```

Generate the OpenAPI 3.1 JSON from the repository root:

```text
pnpm --filter @unicas/space-protocol docs:generate
```

The generated file is `openapi/app-space-v1.openapi.json`. The package exports
it as `./openapi.json`.

Validate with:

```text
pnpm --filter @unicas/space-protocol typecheck
pnpm --filter @unicas/space-protocol test
```

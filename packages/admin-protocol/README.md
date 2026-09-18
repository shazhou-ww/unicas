# @unicas/admin-protocol

Cloud-neutral UniCAS administrator control-plane contracts for Apps and Accounts.

The package exports request/response types, route helpers, matchers, and Zod
resource schemas for `appAdminApiContract`. It also owns the shared App/platform MCP catalog used by remote and stdio
servers. It contains no transport or service implementation.

Derive an implementation or client type from the shared contract:

```ts
import type { ContractRouterClient } from "@orpc/contract";
import { appAdminApiContract } from "@unicas/admin-protocol";

type AppAdminClient = ContractRouterClient<typeof appAdminApiContract>;
```

Generate the OpenAPI 3.1 JSON from the repository root:

```text
pnpm --filter @unicas/admin-protocol docs:generate:v2
```

The generated file is `openapi/admin-v2.openapi.json`, exported as
`./openapi-v2.json`.

Validate with:

```text
pnpm --filter @unicas/admin-protocol typecheck
pnpm --filter @unicas/admin-protocol test
```
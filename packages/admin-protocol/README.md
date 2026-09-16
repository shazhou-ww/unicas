# @unicas/admin-protocol

Cloud-neutral UniCAS administrator control-plane contracts for App v2 and the
frozen Stack v1 compatibility surface.

The package exports the existing request/response types, route helpers, and
matchers together with Zod resource schemas. `appAdminApiContract` is the App
v2 contract; `casAdminApiContract` remains the frozen Stack v1 contract. The
package also owns the shared 32-tool App/platform MCP catalog used by remote and stdio
servers. It contains no transport or service implementation.

Derive an implementation or client type from the shared contract:

```ts
import type { ContractRouterClient } from "@orpc/contract";
import { appAdminApiContract, casAdminApiContract } from "@unicas/admin-protocol";

type AppAdminClient = ContractRouterClient<typeof appAdminApiContract>;
type LegacyAdminClient = ContractRouterClient<typeof casAdminApiContract>;
```

Generate the OpenAPI 3.1 JSON from the repository root:

```text
pnpm --filter @unicas/admin-protocol docs:generate
pnpm --filter @unicas/admin-protocol docs:generate:v2
```

The generated files are `openapi/admin-v1.openapi.json` and
`openapi/admin-v2.openapi.json`, exported as `./openapi.json` and
`./openapi-v2.json`. Their generators are intentionally separate.

Validate with:

```text
pnpm --filter @unicas/admin-protocol typecheck
pnpm --filter @unicas/admin-protocol test
```
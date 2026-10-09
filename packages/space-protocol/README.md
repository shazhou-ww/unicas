# @unicas/space-protocol

[![npm version](https://img.shields.io/npm/v/%40unicas%2Fspace-protocol?label=npm)](https://www.npmjs.com/package/%40unicas%2Fspace-protocol)
[![SDK CI](https://github.com/shazhou-ww/unicas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shazhou-ww/unicas/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/%40unicas%2Fspace-protocol)](https://github.com/shazhou-ww/unicas/blob/main/LICENSE)

Cloud-neutral UniCAS Space data-plane contracts and capability vocabulary.

## When to use this package

Use the protocol package for App/Space v1 request and response types, schemas,
route construction, capability vocabulary, or the published OpenAPI document.
It contains no HTTP transport, canonical byte codec, or application workflow.

## Install

```sh
npm install @unicas/space-protocol
```

The package exposes the App/Space v1 HTTP API through `spaceApiContract`,
`appSpaceRoutes`, capability `ver: 1`, signed `spaceId`, and exact
`cas:{resource}:{action}` permissions. It covers node, lease, usage, garbage
collection, and Root Ref operations. Binary CAS node bodies remain streamable;
the `readContent` contract also describes `Range`, `200`, `206`, `416`, and
their response headers.

Use the shared contract and route helpers without duplicating path strings:

<!-- sdk-snippet: space-protocol -->
```ts
import {
  appSpaceRoutes,
  type SpaceApiContract,
  SpaceIdSchema,
  spaceApiContract,
} from "@unicas/space-protocol";

const contract: SpaceApiContract = spaceApiContract;
const spaceId = SpaceIdSchema.parse("space-example");
const usagePath = appSpaceRoutes.usage({
  appId: "app-example",
  spaceId,
});
console.log(contract, usagePath);
```

Generate the OpenAPI 3.1 JSON from the repository root:

```text
pnpm --filter @unicas/space-protocol docs:generate
```

The generated file is `openapi/app-space-v1.openapi.json`. The package exports
it as `./openapi.json`. `SpaceCapabilityClaimsSchema` and
`SpaceOperationPolicies` are the same sources used by runtime authorization
and by the OpenAPI `x-unicas-capability` / `x-unicas-authorization`
extensions. These permissions are signed JWT claim values, not OAuth scopes.

The package is ESM-only. It supports Node.js 24+ and the browser engines in the
[compatibility matrix](https://docs.unicas.work/app-user-api/compatibility/).
Package semver, HTTP path version `v1`, capability claim version `1`, and
product deployment maturity are independent version axes. Only package-root
exports and `@unicas/space-protocol/openapi.json` are public.

Validate with:

```text
pnpm --filter @unicas/space-protocol typecheck
pnpm --filter @unicas/space-protocol test
```

## Documentation and support

- [SDK package guide](https://docs.unicas.work/app-user-api/sdk/)
- [TypeScript API reference](https://docs.unicas.work/app-user-api/sdk-reference/)
- [Versioning](https://docs.unicas.work/app-user-api/versioning/)
- [Changelog](https://docs.unicas.work/app-user-api/changelog/)
- [Support](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md)
- [Security](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md)

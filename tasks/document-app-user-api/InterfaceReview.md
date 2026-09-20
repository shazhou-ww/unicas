# App-user API interface review

Status: Approved by the requesting user on 2026-09-20 for primary commit
`b6eb183bc18d546020f1de52725eca5de2d1073f`.

## Decision requested

Approve the proposed canonical `docs/app-user-api/` guide represented by the
draft pages below:

- [Entry page and integration boundary](../../docs/app-user-api/README.md)
- [Scenarios and request sequences](../../docs/app-user-api/scenarios.md)
- [HTTP operation reference](../../docs/app-user-api/http-api.md)
- [Capability authorization](../../docs/app-user-api/authorization.md)

The approval permits publishing this reviewed material under
`docs/app-user-api/` and adding it to the documentation site. It does not
authorize any API, capability, client, service, or storage behavior change.

## Review focus

Please verify that the draft:

1. gives App developers a complete path from end-user authentication through
   capability delivery and Space operations;
2. keeps App administration and administrator credentials outside App-user
   request flows;
3. assigns user identity, Principal-to-Space mapping, sharing, business root
   catalogs, and application data formats to the App;
4. accounts for all seven public v2 Space operations and their required
   permissions;
5. accurately describes retry, idempotency, concurrency, streaming, range,
   retention, and garbage-collection behavior; and
6. clearly reports machine-readable contract gaps instead of silently
   presenting runtime-only behavior as OpenAPI guarantees.

## Evidence and compatibility statement

The draft was checked against:

- [Space v2 TypeScript contract](../../packages/tenant-protocol/src/space-v2-contract.ts)
- [Generated Space v2 OpenAPI](../../packages/tenant-protocol/openapi/space-v2.openapi.json)
- [Capability vocabulary](../../packages/tenant-protocol/src/capability.ts)
- [Public transport client](../../packages/tenant-client/src/client.ts)
- [Public transport client types](../../packages/tenant-client/src/types.ts)
- [Service authorization](../../packages/service/src/app-space-auth.ts)
- [Service authorization tests](../../packages/service/tests/app-space-auth.test.ts)
- [Service actor tests](../../packages/service/tests/actor.test.ts)
- [Node lease tests](../../packages/service/tests/node-lease.test.ts)
- [Node read tests](../../packages/service/tests/node-read.test.ts)
- [Root Ref tests](../../packages/service/tests/root-refs.test.ts)
- [Garbage collection tests](../../packages/service/tests/gc.test.ts)

The guide documents only the public App/Space v2 contract. Historical wire
vocabulary and physical compatibility identifiers are not aliases in this
guide. Existing package names such as `@unicas/tenant-client` are cited only as
published package identifiers.

## Source discrepancies retained in the draft

The review deliberately calls out these current differences:

- The TypeScript contract models node content as a binary stream, but the
  generated OpenAPI `200` response has no media type or response schema.
- The runtime and public client support byte-range reads, including partial and
  unsatisfiable responses, but generated OpenAPI does not declare the `Range`
  request header, `206`, `416`, or response headers.
- OpenAPI declares bearer JWT authentication and descriptive scope matching,
  but it does not machine-model capability claims or per-operation
  permissions.
- The shared generated error surface is broader than the errors naturally
  produced by every operation. Runtime-specific upload and Root Ref error codes
  are documented as service behavior rather than OpenAPI enums.

These are documentation findings only. This task will not change either source
to force agreement.

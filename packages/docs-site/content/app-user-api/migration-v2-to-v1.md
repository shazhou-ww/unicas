# Prototype v2 to App/Space v1 migration

The first supported App/Space release replaces the unpublished prototype in
one clean cutover. There is no route alias, token cutoff, or translation
period.

## Required consumer changes

1. Change the HTTP base path version from 2 to 1 while retaining the App and
   Space path segments and all seven operations.
2. Configure the App issuer audience as
   `https://api.unicas.work/v1/apps/{appId}` for the deployed public origin.
3. Issue Space claims with family-local `ver: 1`, signed `spaceId`, and only
   the exact operation permissions documented in
   [Capability authorization](authorization.md).
4. Change custom `CasNodeCache` implementations to accept the public
   `version: 1` App/Space key. Existing browser-cache database and key-prefix
   strings remain private persistence identifiers and are not migrated.
5. Deploy the service and every maintained client or App consumer from the
   same accepted repository revision.

SDK method names and client configuration do not change. Frozen Stack/Tenant
v1 remains available only through the explicit `@unicas/space-protocol/v1`,
`@unicas/space-client/v1`, and `@unicas/space-browser-cache/v1` subpaths.

## Root Ref updates

Keep one `updateRootRefs({ requestId, changes })` call. The `changes` map may
contain both positive and negative deltas, and the complete map commits
atomically. Reuse the same `requestId` and exact map after an uncertain
response. Do not split replacement into directional increase and decrease
calls. Any post-commit garbage-collection hint is derived from committed
negative deltas.

## Failure behavior

- Requests sent to the prototype HTTP route return `404`; there is no redirect.
- Prototype Space claim versions 2 and 3 return `401 invalid_token`.
- Broad prototype permissions are invalid claim values and return
  `401 invalid_token`.
- A released Space claim cannot authorize frozen Stack/Tenant routes, and a
  frozen Stack/Tenant claim cannot authorize App/Space routes.
- App, Space, exact permission, and Root Ref domain mismatches continue to fail
  closed with the documented authorization errors.

No database row, R2 key, Durable Object identity, canonical node encoding,
file manifest, browser cache database, or historical audit event is migrated
by this wire-contract cutover.
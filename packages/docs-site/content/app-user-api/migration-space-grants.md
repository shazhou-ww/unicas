# Single-Space capability to Space grants migration

The pre-release App/Space contract now uses canonical path-like Space IDs,
query-scoped HTTP resources, and capability grants. This is one clean cutover:
there is no route alias, token compatibility mode, or translation period.

## Required consumer changes

1. Convert every Space ID to a canonical value that begins with `/` and uses
   only ASCII letters, digits, `_`, and `-` in non-empty path segments. For
   example, convert `user-123` to `/users/user-123`.
2. Replace every `/v1/apps/{appId}/...` data-plane endpoint with the unified
   `/v1/cas/...` route. Send the target App and exact Space in required
   `appId` and `spaceId` query parameters. Node content is now
   `GET /v1/cas/nodes/{hash}` rather than a `/content` subpath. Use released
   route helpers rather than assembling or encoding the URL manually.
3. Configure the App issuer audience as
   `https://api.unicas.work/v1/cas/` for the deployed public origin.
4. Replace capability `ver: 1` top-level `spaceId` and `permissions` with
   `ver: 2` and a non-empty `grants` array. The direct replacement is one exact
   grant: `{ "selector": "/users/user-123", "permissions": [...] }`.
5. Keep selector and permission authority together in each grant. A request is
   allowed only when one grant both matches the route Space and contains the
   operation permission.
6. Update persisted Principal-to-Space mappings and deployment variables to
   canonical Space IDs before asking the issuer to mint capabilities.
7. Deploy the service and every maintained client or App consumer from the
   same accepted repository revision.

SDK method names and client configuration keys do not change. The value passed
as `spaceId` does change to the canonical form.

## Optional multi-Space grants

One token may carry at most 32 grants. Selectors may be:

- an exact Space ID, such as `/users/user-123`;
- a terminal single-segment prefix, such as `/shared/report-*`; or
- a terminal recursive prefix, such as `/archive/**`.

`*` does not cross `/`. `/**` matches descendants such as `/archive/2026/q1`,
but not `/archive` itself. Other wildcard placements are invalid.

## Root Ref updates

Keep one `updateRootRefs({ requestId, changes })` call. The `changes` map may
contain both positive and negative deltas, and the complete map commits
atomically. Reuse the same `requestId` and exact map after an uncertain
response. Do not split replacement into directional increase and decrease
calls. Any post-commit garbage-collection hint is derived from committed
negative deltas.

## Failure behavior

- Requests sent to old `/v1/apps/{appId}` data-plane paths return `404`; there
  is no redirect.
- Space capability versions 1 and 3 return `401 invalid_token`.
- Missing, empty, oversized, or malformed grants return `401 invalid_token`.
- A valid token with no selector matching the requested Space returns
  `403 resource_scope_mismatch`.
- A selector match without the required permission in that same grant returns
  `403 insufficient_permission`.
- Retired Stack/Tenant routes return `404` without capability verification or
   storage dispatch.
- Retired Stack/Tenant claim shapes cannot authorize App/Space routes and
   return `401 invalid_token`.
- App, grant, operation permission, and Root Ref domain mismatches fail closed
  with the documented authorization errors.

There is no automatic data migration. Changing a persisted Space ID changes
its Durable Object identity and storage namespace, and changing a client cache
key creates a distinct cache entry. Pre-release environments must explicitly
migrate or discard data bound to non-canonical IDs before cutover. Canonical
node encoding and file manifest formats do not change.
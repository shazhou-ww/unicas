# App/Space v1 interface review

Status: Pending requesting-user approval.

## Decision requested

Approve the first supported App/Space contract as:

- HTTP base path `/v1/apps/{appId}/spaces/{spaceId}`;
- Space capability claim `ver: 1` within the Space claim family;
- the existing six exact operation permissions and signed `spaceId`;
- one atomic mixed-sign Root Ref update operation;
- seven neutral operation IDs matching the public client methods;
- no App/Space `/v2` route, capability compatibility, issuance cutoff, or
  translation alias; and
- frozen Stack/Tenant v1 preserved only through the existing explicit
  `@unicas/space-protocol/v1` and `@unicas/space-client/v1` boundaries.

The App/Space claim version resets because this is its first supported beta
baseline. Claim versions are scoped to a claim family: frozen Stack/Tenant
`ver: 1` requires `tenantId` and broad resource-bound permissions, while
released App/Space `ver: 1` requires `spaceId` and exact operation permissions.
The route selects the verifier, and each verifier rejects the other grammar.

## Version axes

| Axis | Released value | Compatibility treatment |
| --- | --- | --- |
| App/Space HTTP | `v1` | `/v2/apps/...` is unsupported and returns `404`. |
| Space capability claim | `ver: 1` | Prototype broad `ver: 2` and exact-permission `ver: 3` claims are rejected. |
| Frozen Stack/Tenant HTTP | existing unprefixed `/stacks/.../tenants/...` | Unchanged until its retirement task. |
| Frozen Stack/Tenant capability | existing `ver: 1` family | Unchanged; grammar and route family keep it disjoint. |
| Canonical node encoding | media type version `1` | Unchanged. |
| File manifest encoding | manifest version `1` | Unchanged. |
| Physical/cache/upload identifiers | existing `nodes-v2`, `_uploads/v2`, cache v2 keys | Retained as private persistence identifiers, never exposed as HTTP compatibility. |

## Released operations

| Method and path | Operation ID | Client method | Permission |
| --- | --- | --- | --- |
| `GET /v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/content` | `readContent` | `readContent` | `cas:nodes:read` |
| `GET /v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/metadata` | `readMetadata` | `readMetadata` | `cas:nodes:read` |
| `POST /v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/lease` | `leaseNode` | `leaseNode` | `cas:nodes:lease` |
| `GET /v1/apps/{appId}/spaces/{spaceId}/cas/usage` | `getUsage` | `usage` | `cas:usage:read` |
| `POST /v1/apps/{appId}/spaces/{spaceId}/cas/gc` | `runGc` | `gc` | `cas:gc:execute` |
| `GET /v1/apps/{appId}/spaces/{spaceId}/root-refs` | `listRootRefs` | `listRootRefs` | `cas:root-refs:read` plus `refDomain` |
| `POST /v1/apps/{appId}/spaces/{spaceId}/root-refs` | `updateRootRefs` | `updateRootRefs` | `cas:root-refs:update` plus `refDomain` |

The operation identifiers `readSpaceContent`, `readSpaceMetadata`,
`leaseSpaceNode`, `getSpaceUsage`, `runSpaceGc`, `listSpaceRootRefs`, and
`updateSpaceRootRefs` are prototype identifiers and are removed.

## Common identity and authorization

Every operation requires `Authorization: Bearer <capability>`.

- `appId` and `spaceId` are non-empty path segments.
- `hash` is exactly 64 lowercase hexadecimal SHA-256 characters.
- the verified issuer resolves one App authority;
- issuer-derived `appId` must equal route `appId`;
- signed `spaceId` must equal route `spaceId`;
- only the route's exact permission authorizes the operation; and
- Root Ref list and update require a valid signed `refDomain`.

No query, request body, or caller-supplied internal header may select App,
Space, permission, or Root Ref domain.

## Capability grammar

Protected header:

```json
{
  "alg": "ES256",
  "kid": "APP_ISSUER_KEY_ID",
  "typ": "unidocs-cap+jwt"
}
```

Claims:

```json
{
  "ver": 1,
  "iss": "https://issuer.example",
  "sub": "principal-123",
  "aud": "https://api.unicas.work/v1/apps/APP_ID",
  "iat": 1760000000,
  "nbf": 1760000000,
  "exp": 1760000300,
  "jti": "cap-001",
  "spaceId": "SPACE_ID",
  "permissions": ["cas:nodes:read"],
  "refDomain": "files:primary"
}
```

Rules:

- `iss`, `sub`, `aud`, `jti`, and `spaceId` are non-empty strings.
- `aud` exactly matches the App authority registry value. During issuer
  inspection and replacement, the control plane derives and persists
  `<public-origin>/v1/apps/{appId}` as that value.
- `iat`, `nbf`, and `exp` are JWT NumericDate values.
- lifetime cannot exceed the App authority's configured maximum or the global
  seven-day maximum; verification allows 30 seconds clock tolerance.
- `permissions` is an array of exact strings from the fixed vocabulary below.
- `refDomain`, when present, is at most 64 characters, starts with a lowercase
  ASCII letter, and uses non-empty lowercase alphanumeric segments separated
  by `:`. Values beginning with `_` are reserved.

Exact permission vocabulary:

```text
cas:nodes:read
cas:nodes:lease
cas:root-refs:read
cas:root-refs:update
cas:usage:read
cas:gc:execute
```

Permissions do not imply one another. Prototype broad permissions such as
`spaces:{spaceId}:cas:read`, `spaces:{spaceId}:cas:write`, and
`spaces:{spaceId}:cas:manage` never authorize released v1 requests.

The `CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE` cutoff and its parser are removed.
There is no cutoff for prototype `ver: 2` or `ver: 3` claims.

## Node content

`GET .../content` returns the node's own immutable content bytes.

- no `Range`: `200` with the complete own-content stream;
- satisfiable single byte range: `206` with the requested bytes;
- unsatisfiable or malformed range: `416` with
  `Content-Range: bytes */<logical-size>`;
- successful responses include `Accept-Ranges: bytes`, `Content-Length`, and
  node `Content-Type`; `206` also includes `Content-Range`.

Multiple ranges are unsupported. The client treats a requested zero-length
range as an empty local stream and sends no request.

## Node metadata

`GET .../metadata` returns:

```ts
{
  metadata: {
    hash: string;
    size: number;
    contentType: string;
    refs: readonly string[];
  };
  state: {
    leaseStartedAt: number;
    leaseExpiresAt: number;
    childRefCount: number;
    rootRefCount: number;
  };
}
```

Sizes, timestamps, and `childRefCount` are non-negative integers. The aggregate
`rootRefCount` is an integer. Child refs retain canonical order.

## Lease and direct upload

Request body contains exactly:

```json
{ "leaseDurationMs": 900000 }
```

`leaseDurationMs` is a positive safe integer. The service clamps the effective
duration to 60,000 through 86,400,000 milliseconds; the SDK default is 900,000
milliseconds.

Response states:

- `ready`: hash plus lease start/expiry;
- `awaiting_upload`: signed `PUT` URL, expiry, and exact required headers;
- `awaiting_replacement_upload`: rejection plus replacement upload;
- `validated_awaiting_children`: one through 256 unready child hashes.

Canonical-node limits remain:

- maximum canonical bytes: 64 MiB;
- maximum child refs: 256;
- maximum content type: 1,024 printable ASCII bytes; and
- digest must equal the path hash.

Legacy Stack/Tenant lease headers are invalid on App/Space v1:

```text
X-CAS-Lease-Duration
X-CAS-Upload-Length
X-CAS-Upload-Id
```

Retry workflow: repeat lease after completing the returned `PUT`. Reuse the
current upload while it remains active. Retry `429 CAS_UPLOAD_LIMIT` only after
upload pressure drains. Lease calls have no caller-provided idempotency key;
generation fencing and immutable hashes make retries converge.

## Usage and garbage collection

Usage returns six non-negative integer counters:

```text
nodeCount
readyContentBytes
readyStoredBytes
reservedBytes
notReadyNodeCount
leasedNodeCount
```

GC accepts an optional body `{ "maxNodes": positiveInteger }`. Omitting it
uses `100`. The response contains non-negative `examined`, `deleted`, and
`reclaimedContentBytes`. GC is bounded and repeatable but has no idempotency
key and no automatic client retry promise.

## Root Refs

List query:

- `limit`: optional integer `1..200`; omitting it uses `50`;
- `cursor`: optional non-empty opaque string.

This closes the prototype mismatch in which OpenAPI admitted `201..1000` but
the runtime rejected values above `200`.

List response contains signed `refDomain`, non-negative snapshot `revision`,
ordered `{ hash, refCount }` items, and nullable `nextCursor`.

Update request:

```json
{
  "requestId": "stable-business-operation-id",
  "changes": {
    "<64-lowercase-hex-hash>": 1,
    "<another-hash>": -1
  }
}
```

- `requestId`: non-empty, maximum 256 characters;
- `changes`: non-empty, maximum 1,000 unique hash keys;
- each delta: non-zero safe integer with absolute value at most 1,000,000;
- duplicate JSON hash keys are rejected;
- positive deltas require ready nodes;
- every resulting aggregate count must be non-negative and safe.

The full mixed-sign map commits atomically. Exact replay of `requestId` and
canonical changes returns the original revision with `idempotent: true`.
Reusing the ID with different changes returns `409 IDEMPOTENCY_CONFLICT`.
No partial mutation occurs. Internal revision conflicts use at most five
attempts with 25 ms base delay, 800 ms maximum delay, and jitter; exhaustion
returns `503 ROOT_REF_BUSY`. A post-commit GC hint, when present, is derived
from committed negative deltas.

## Error contract

All JSON errors use:

```json
{ "error": "STABLE_CODE", "message": "optional diagnostic" }
```

The released contract exposes these status classes in generated OpenAPI:

| Status | Contract code |
| ---: | --- |
| `400` | `INVALID_REQUEST` |
| `401` | `UNAUTHORIZED` |
| `403` | `FORBIDDEN` |
| `404` | `NOT_FOUND` |
| `409` | `CONFLICT` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `429` | `RESOURCE_EXHAUSTED` |
| `503` | `SERVICE_UNAVAILABLE` |

Stable runtime codes give callers the more specific cause.

Authentication and authorization:

| Status | Codes |
| ---: | --- |
| `401` | `missing_token`, `invalid_token`, `unknown_issuer`, `registry_unavailable` |
| `403` | `unsupported_algorithm`, `APP_SUSPENDED`, `resource_scope_mismatch`, `insufficient_permission` |

Node and upload operations:

| Status | Codes |
| ---: | --- |
| `400` | `INVALID_REQUEST`, `CAS_UPLOAD_INVALID` |
| `404` | `NODE_NOT_FOUND` |
| `409` | `NODE_NOT_READY`, `NODE_CONFLICT`, `CAS_UPLOAD_CONFLICT` |
| `410` | `CAS_UPLOAD_EXPIRED` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `416` | `INVALID_REQUEST` with `Content-Range` for content reads |
| `429` | `CAS_UPLOAD_LIMIT` |
| `503` | `STORAGE_ERROR` |

Root Ref operations:

| Status | Codes |
| ---: | --- |
| `400` | `ROOT_REF_INVALID` |
| `404` | `NODE_NOT_FOUND` |
| `409` | `NODE_NOT_READY`, `NEGATIVE_AGGREGATE`, `IDEMPOTENCY_CONFLICT` |
| `503` | `ROOT_REF_BUSY` |

`NODE_TOO_LARGE`, `NODE_DIGEST_MISMATCH`, `INVALID_CANONICAL_NODE`, and
`NODE_CONFLICT` are also stable rejection codes inside a successful
`awaiting_replacement_upload` lease result; they are not error envelopes.

Generated OpenAPI must model all six released paths, seven operations, neutral
operation IDs, request/response schemas, limits, and contract error classes.
The generated document describes the content response as a binary stream;
human HTTP documentation and runtime tests remain authoritative for `Range`,
`206`, `416`, and response headers because the ORPC stream output cannot
faithfully express those variants. Runtime-specific codes remain stable values
of `error` and are documented alongside the generated contract.

## Package and OpenAPI exports

Released App/Space is the package root:

```text
@unicas/space-protocol
@unicas/space-client
@unicas/space-browser-cache
```

Frozen Stack/Tenant remains under explicit compatibility subpaths:

```text
@unicas/space-protocol/v1
@unicas/space-client/v1
@unicas/space-browser-cache/v1
```

OpenAPI exports become:

```text
@unicas/space-protocol/openapi.json     -> app-space-v1.openapi.json
@unicas/space-protocol/v1/openapi.json  -> tenant-v1.openapi.json
```

Remove `openapi-v1.json`, `openapi-v2.json`, and
`space-v2.openapi.json`. The generated App/Space document contains only the
six released v1 paths, seven operations, and neutral operation IDs. Frozen v1
generation and its artifact remain byte-stable.

## Consumer migration

Prototype consumer changes:

1. replace `/v2/apps/...` with `/v1/apps/...`;
2. mint Space claim `ver: 1` with the exact permission vocabulary;
3. replace prototype App audience `/v2/apps/{appId}` with
   `/v1/apps/{appId}` through normal issuer inspection/replacement;
4. remove broad-permission cutoff configuration;
5. change custom `CasNodeCache` implementations from the prototype
  `version: 2` key discriminant to released `version: 1`;
6. keep SDK method calls and client configuration unchanged; and
7. keep one atomic `updateRootRefs({ requestId, changes })` call, including
   mixed positive and negative deltas.

Prototype `ver: 2` and `ver: 3` claims receive `401 invalid_token` on released
v1. Released Space claims and frozen Stack/Tenant claims also reject one
another despite both using family-local version `1`.

There is no compatibility duration or alias. These contracts are unpublished,
and every maintained consumer migrates in this repository change.

## Review question

Approve the exact seven-operation App/Space v1 contract, neutral operation
IDs, Space claim `ver: 1`, exact permission and error vocabulary, limits,
retry/idempotency behavior, OpenAPI subpaths, and clean prototype removal?
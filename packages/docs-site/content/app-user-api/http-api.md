# HTTP operation reference

Status: published operation reference

For searchable schemas, request examples, and generated client snippets, open
the [interactive Scalar API reference](/app-user-api/reference/).

## Common request rules

Base origin: `https://api.unicas.work`

Every route is scoped by both `appId` and `spaceId`:

```text
/v1/apps/{appId}/spaces/{spaceId}/...
```

Send a Space capability through the HTTP bearer authentication scheme:

```http
Authorization: Bearer CAPABILITY
```

The HTTP API and Space capability claim both use family-local version `1`: the signed
`spaceId` must match the route and `permissions` must contain the operation's
exact authority.

`appId` and `spaceId` are non-empty strings. A node `hash` is exactly 64
lowercase hexadecimal characters. JSON requests use `application/json`.
Canonical node bytes use `application/vnd.unidocs.cas-node.v1`.

The generated OpenAPI declares the bearer JWT security scheme globally rather
than modeling `Authorization` as an ordinary operation header.

## Operation inventory

| Client operation | Method and path | Authority | Success |
| --- | --- | --- | --- |
| `readContent` | `GET /v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/content` | `cas:nodes:read` | Streamed canonical bytes |
| `readMetadata` | `GET /v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/metadata` | `cas:nodes:read` | Metadata and retention state |
| `leaseNode` | `POST /v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/lease` | `cas:nodes:lease` | Ready lease or direct-upload instructions |
| `usage` | `GET /v1/apps/{appId}/spaces/{spaceId}/cas/usage` | `cas:usage:read` | Space accounting |
| `gc` | `POST /v1/apps/{appId}/spaces/{spaceId}/cas/gc` | `cas:gc:execute` | Bounded collection result |
| `listRootRefs` | `GET /v1/apps/{appId}/spaces/{spaceId}/root-refs` | `cas:root-refs:read` + `refDomain` | Revision-stable page |
| `updateRootRefs` | `POST /v1/apps/{appId}/spaces/{spaceId}/root-refs` | `cas:root-refs:update` + `refDomain` | Atomic commit result |

There are no other public v1 Space operations in the current generated
OpenAPI.

## Read node content

```http
GET /v1/apps/APP_ID/spaces/SPACE_ID/cas/nodes/HASH/content
Authorization: Bearer CAPABILITY
Range: bytes=0-1023
```

The `Range` header is optional. The runtime accepts one standard byte range:
bounded (`bytes=2-5`), open-ended (`bytes=7-`), or suffix (`bytes=-3`).
Overshooting end positions are clamped to the object size.

- Full reads return `200` with a streamed body.
- Satisfiable ranges return `206` with the selected bytes.
- Invalid or unsatisfiable ranges return `416` and
  `Content-Range: bytes */{size}`.

Both successful forms return `Accept-Ranges: bytes`, `Content-Length`, and the
node's `Content-Type`. A `206` also returns
`Content-Range: bytes {start}-{end}/{size}`. This path does not emit an
`ETag`. The `416` JSON body is:

```json
{
  "error": "INVALID_REQUEST",
  "message": "Range is not satisfiable"
}
```

The public client exposes
`readContent(hash, { offset, length }?, { signal }?)`. A zero-length client
range returns an empty stream without making a request. Range offset and length
must be non-negative safe integers.

This read is repeatable. Use bounded retries only for transient failures and
honor cancellation.

## Read node metadata

```http
GET /v1/apps/APP_ID/spaces/SPACE_ID/cas/nodes/HASH/metadata
Authorization: Bearer CAPABILITY
```

`200` response:

```json
{
  "metadata": {
    "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "size": 1024,
    "contentType": "application/vnd.unidocs.cas-node.v1",
    "refs": []
  },
  "state": {
    "leaseStartedAt": 1760000000000,
    "leaseExpiresAt": 1760000900000,
    "childRefCount": 0,
    "rootRefCount": 1
  }
}
```

`size`, lease timestamps, and `childRefCount` are non-negative integers.
`rootRefCount` is an integer. The public client returns the metadata projection
and may use configured metadata caching.

## Lease or upload a node

```http
POST /v1/apps/APP_ID/spaces/SPACE_ID/cas/nodes/HASH/lease
Authorization: Bearer CAPABILITY
content-type: application/json

{"leaseDurationMs":900000}
```

The JSON property is required. Published clients use 15 minutes when the
caller omits the complete options argument; the service clamps accepted values
to 60 seconds through 24 hours.

Ready result:

```json
{
  "state": "ready",
  "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "leaseStartedAt": 1760000000000,
  "leaseExpiresAt": 1760000900000
}
```

Upload result:

```json
{
  "state": "awaiting_upload",
  "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "upload": {
    "method": "PUT",
    "url": "https://UPLOAD_TARGET",
    "expiresAt": 1760000300000,
    "headers": {
      "content-type": "application/vnd.unidocs.cas-node.v1",
      "if-none-match": "*"
    }
  }
}
```

Use the returned method, URL, and headers exactly, then repeat the same lease
request. `awaiting_replacement_upload` additionally returns a required
`rejection`; `validated_awaiting_children` returns every distinct unready child
hash in canonical order and requires no second parent upload.

The service validates canonical bytes against `HASH`. Ready-node calls renew
the lease without re-uploading, parsing, or hashing.

Creating a new upload generation can return `429 CAS_UPLOAD_LIMIT` when the
Space has too many active uploads. No generation is created for that request;
retry the same lease after active upload work has drained.

## Get Space usage

```http
GET /v1/apps/APP_ID/spaces/SPACE_ID/cas/usage
Authorization: Bearer CAPABILITY
```

`200` response:

```json
{
  "nodeCount": 12,
  "readyContentBytes": 8192,
  "readyStoredBytes": 6144,
  "reservedBytes": 1024,
  "notReadyNodeCount": 1,
  "leasedNodeCount": 3
}
```

Every field is a non-negative integer. This is current operational accounting,
not a business root catalog or billing contract. The GET is repeatable, but its
values may change concurrently.

## Run bounded garbage collection

```http
POST /v1/apps/APP_ID/spaces/SPACE_ID/cas/gc
Authorization: Bearer CAPABILITY
Content-Type: application/json

{ "maxNodes": 100 }
```

The body is optional. `maxNodes`, when present, is a positive integer. The
service default is 100.

`200` response:

```json
{
  "examined": 100,
  "deleted": 8,
  "reclaimedContentBytes": 4096
}
```

A pass is bounded and race-safe. Each candidate is rechecked immediately
before deletion; a node that became referenced or leased is skipped. Content
is deleted before its metadata deletion is committed. A storage failure aborts
without reporting that candidate as deleted.

The operation is not a promise to remove every eligible node. Additional
bounded calls are safe as maintenance, but no idempotency key or automatic
client retry is defined.

## List Root Refs

```http
GET /v1/apps/APP_ID/spaces/SPACE_ID/root-refs?limit=100&cursor=CURSOR
Authorization: Bearer CAPABILITY
```

Query:

| Name | Constraint |
| --- | --- |
| `limit` | Optional integer from 1 through 200 |
| `cursor` | Optional non-empty opaque string |

`200` response:

```json
{
  "refDomain": "files:primary",
  "revision": 42,
  "items": [
    {
      "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "refCount": 1
    }
  ],
  "nextCursor": null
}
```

The service selects the Root Ref domain from the verified capability, never
from query or body data. The capability must contain a valid `refDomain`.
`nextCursor` is either a non-empty opaque string or `null`; continue with the
same capability domain. Pages are revision-stable.

## Atomically update Root Refs

```http
POST /v1/apps/APP_ID/spaces/SPACE_ID/root-refs
Authorization: Bearer CAPABILITY
Content-Type: application/json

{
  "requestId": "commit-018",
  "changes": {
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef": 1
  }
}
```

`requestId` is a non-empty stable idempotency identity. `changes` maps
lowercase SHA-256 hashes to signed integer deltas. The runtime additionally
requires non-empty changes, rejects duplicate JSON keys, caps the map at 1000
entries, and bounds each delta to 1,000,000 in magnitude.

`200` response:

```json
{
  "success": true,
  "idempotent": false,
  "revision": 43
}
```

All deltas commit atomically within the capability's `refDomain`. A replay of
the exact request returns the original revision with `idempotent: true`. Reuse
of `requestId` with a different canonical payload returns
`409 IDEMPOTENCY_CONFLICT`. Missing nodes, unready positive targets, negative
aggregate balances, overflow, or an exhausted internal revision retry produce
an error and no partial commit.

After a lost response, resend exactly the same request and `requestId`.

## Error envelope

The shared contract and generated OpenAPI document:

```json
{
  "error": "ERROR_CODE",
  "message": "Optional safe detail"
}
```

Only `error` is required by OpenAPI. The shared operation error map is:

| Status | Contract error |
| --- | --- |
| `400` | `INVALID_REQUEST` |
| `401` | `UNAUTHORIZED` |
| `403` | `FORBIDDEN` |
| `404` | `NOT_FOUND` |
| `409` | `CONFLICT` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `429` | `RESOURCE_EXHAUSTED` |
| `503` | `SERVICE_UNAVAILABLE` |

The service returns more specific stable authorization codes such as
`missing_token`, `invalid_token`, `unknown_issuer`, `registry_unavailable`,
`unsupported_algorithm`, `APP_SUSPENDED`, `resource_scope_mismatch`, and
`insufficient_permission`. Upload and Root Ref validation likewise use specific
codes described above. Callers should branch on the stable `error` code and
treat `message` as optional diagnostic text.

## Contract gaps

The current sources have known representational gaps:

1. The TypeScript contract models `readContent` as
   `ReadableStream<Uint8Array>` using the canonical media type, while its
   generated OpenAPI `200` response has empty `content`.
2. Runtime and the public client support byte ranges, but the TypeScript
   operation inputs and generated OpenAPI do not declare `Range`, `206`, `416`,
   or response headers.
3. OpenAPI declares a bearer JWT scheme and says the Space and permission must
   match, but capability claims and per-operation permissions are descriptive,
   not machine-modeled OpenAPI scopes.
4. Runtime validation is intentionally stricter in several workflows, including
   inline upload length, Root Ref canonicalization and bounds, and specific
   error codes.

Integrators must not infer new routes or fields from these gaps. The
[generated OpenAPI](../../../space-protocol/openapi/app-space-v1.openapi.json)
remains the operation inventory, and runtime-only behavior above is supported
by service tests.

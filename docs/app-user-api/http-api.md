# HTTP operation reference

Status: published operation reference

## Common request rules

Base origin: `https://api.unicas.work`

Every route is scoped by both `appId` and `spaceId`:

```text
/v2/apps/{appId}/spaces/{spaceId}/...
```

Send a Space capability through the HTTP bearer authentication scheme:

```http
Authorization: Bearer CAPABILITY
```

The HTTP API remains v2. Its capability claim version is `3`: the signed
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
| `readContent` | `GET /v2/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/content` | `cas:nodes:read` | Streamed canonical bytes |
| `readMetadata` | `GET /v2/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/metadata` | `cas:nodes:read` | Metadata and retention state |
| `leaseNode` | `POST /v2/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/lease` | `cas:nodes:lease` | Ready lease or direct-upload instructions |
| `usage` | `GET /v2/apps/{appId}/spaces/{spaceId}/cas/usage` | `cas:usage:read` | Space accounting |
| `gc` | `POST /v2/apps/{appId}/spaces/{spaceId}/cas/gc` | `cas:gc:execute` | Bounded collection result |
| `listRootRefs` | `GET /v2/apps/{appId}/spaces/{spaceId}/root-refs` | `cas:root-refs:read` + `refDomain` | Revision-stable page |
| `updateRootRefs` | `POST /v2/apps/{appId}/spaces/{spaceId}/root-refs` | `cas:root-refs:update` + `refDomain` | Atomic commit result |

There are no other public v2 Space operations in the current generated
OpenAPI.

## Read node content

```http
GET /v2/apps/APP_ID/spaces/SPACE_ID/cas/nodes/HASH/content
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
GET /v2/apps/APP_ID/spaces/SPACE_ID/cas/nodes/HASH/metadata
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
POST /v2/apps/APP_ID/spaces/SPACE_ID/cas/nodes/HASH/lease
Authorization: Bearer CAPABILITY
content-type: application/json

{"leaseDurationMs":900000}
```

The JSON property is required. Published clients use 15 minutes when the
caller omits the complete options argument; the service clamps accepted values
to 60 seconds through 24 hours.

The response reports the state after UniCAS evaluates the current upload and
validation evidence. All four states below use HTTP `200`; only `ready` means
the node is readable and can be referenced by another node.

Ready result:

```json
{
  "state": "ready",
  "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "leaseStartedAt": 1760000000000,
  "leaseExpiresAt": 1760000900000
}
```

`ready` means the node is validated, readable, referenceable, and protected
from collection until `leaseExpiresAt`. Repeating the request for an active
lease preserves `leaseStartedAt` and never shortens `leaseExpiresAt`; an
expired lease starts a new lease interval.

Initial upload result:

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

`awaiting_upload` is a successful negotiation that requires caller action, not
an asynchronously running server job. Use the returned method, URL, and
headers exactly. The response exposes no upload ID, temporary object key,
storage credential, or App capability. After the PUT, repeat the same lease
request using only the node hash and requested duration.

Rejected upload result:

```json
{
  "state": "awaiting_replacement_upload",
  "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "rejection": {
    "code": "NODE_DIGEST_MISMATCH",
    "message": "Uploaded canonical bytes did not match the requested node hash"
  },
  "upload": {
    "method": "PUT",
    "url": "https://REPLACEMENT_UPLOAD_TARGET",
    "expiresAt": 1760000600000,
    "headers": {
      "content-type": "application/vnd.unidocs.cas-node.v1",
      "if-none-match": "*"
    }
  }
}
```

When a lease call detects malformed, oversized, or hash-mismatched bytes, it
retires that write-once upload and returns a replacement target. Repeating the
lease before a corrected PUT remains `awaiting_replacement_upload`, preserves
the rejection, and returns the current replacement target. If that target
expires without an object, UniCAS may rotate its URL and internal generation
while retaining the rejection.

Validated parent waiting for children:

```json
{
  "state": "validated_awaiting_children",
  "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "childHashes": [
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
  ]
}
```

`childHashes` contains every distinct child that is not ready, in canonical
first-occurrence order. The canonical format limits the complete list to 256
references. UniCAS retains the uploaded and structurally validated parent;
after making the listed children ready, repeat the same lease request to
publish it without another parent PUT, hash, or parse.

The service validates canonical bytes against `HASH`. Ready-node calls renew
the lease without re-uploading, parsing, or hashing.

Creating a new upload generation can return `429 CAS_UPLOAD_LIMIT` when the
Space has too many active uploads. No generation is created for that request;
retry the same lease after active upload work has drained.

## Get Space usage

```http
GET /v2/apps/APP_ID/spaces/SPACE_ID/cas/usage
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
POST /v2/apps/APP_ID/spaces/SPACE_ID/cas/gc
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
GET /v2/apps/APP_ID/spaces/SPACE_ID/root-refs?limit=100&cursor=CURSOR
Authorization: Bearer CAPABILITY
```

Query:

| Name | Constraint |
| --- | --- |
| `limit` | Optional integer from 1 through 1000 |
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
POST /v2/apps/APP_ID/spaces/SPACE_ID/root-refs
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
| `500` | `INTERNAL_ERROR` |

The service returns more specific stable authorization codes such as
`missing_token`, `invalid_token`, `unknown_issuer`, `registry_unavailable`,
`unsupported_algorithm`, `APP_SUSPENDED`, `resource_scope_mismatch`, and
`insufficient_permission`. Upload and Root Ref validation likewise use specific
codes described above. Callers should branch on the stable `error` code and
treat `message` as optional diagnostic text.

## Contract gaps

The current sources have known representational gaps:

1. The TypeScript contract models `readSpaceContent` as
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
[generated OpenAPI](../../packages/tenant-protocol/openapi/space-v2.openapi.json)
remains the operation inventory, and runtime-only behavior above is supported
by service tests.

# HTTP operation reference

Status: published operation reference

For searchable schemas, request examples, and generated client snippets, open
the [interactive Scalar API reference](/app-user-api/reference/).

## Common request rules

Base origin: `https://api.unicas.work`

Every route uses the unified CAS v1 base and is scoped by required query
`appId` and `spaceId`:

```text
/v1/cas/...?appId={appId}&spaceId={spaceId}
```

Send a Space capability through the HTTP bearer authentication scheme:

```http
Authorization: Bearer CAPABILITY
```

The HTTP path version is `v1`; the independent Space capability version is
`2`. At least one signed grant must both select the query Space and contain the
operation's exact authority. Production tokens use the shared CAS v1 audience
`https://api.unicas.work/v1/cas/`; the verified issuer, not the shared
audience, determines the owning App.

`appId` is a required non-empty opaque identifier. The service compares it to
the App authority resolved from the verified issuer; it never grants authority
by trusting the query value. `spaceId` is a case-sensitive canonical path of at
most 256 characters: it begins with `/`, has non-empty segments, and each
segment contains only ASCII letters, digits, `_`, or `-`. Send both values
through a URL query encoder; `/users/u_123` is normally serialized as
`spaceId=%2Fusers%2Fu_123`. A node `hash` is exactly 64 lowercase hexadecimal
characters. JSON requests use `application/json`. Canonical node bytes use
`application/vnd.unidocs.cas-node.v1`.

The generated OpenAPI declares the bearer JWT security scheme globally rather
than modeling `Authorization` as an ordinary operation header.

## Operation inventory

| Client operation | Method and path | Authority | Success |
| --- | --- | --- | --- |
| `readContent` | `GET /v1/cas/nodes/{hash}?appId={appId}&spaceId={spaceId}` | `cas:nodes:read` | Streamed canonical bytes |
| `readMetadata` | `GET /v1/cas/nodes/{hash}/metadata?appId={appId}&spaceId={spaceId}` | `cas:nodes:read` | Metadata and retention state |
| `leaseNode` | `POST /v1/cas/nodes/{hash}/lease?appId={appId}&spaceId={spaceId}` | `cas:nodes:lease` | Ready lease or direct-upload instructions |
| `usage` | `GET /v1/cas/usage?appId={appId}&spaceId={spaceId}` | `cas:usage:read` | Space accounting |
| `gc` | `POST /v1/cas/gc?appId={appId}&spaceId={spaceId}` | `cas:gc:execute` | Bounded collection result |
| `listRootRefs` | `GET /v1/cas/root-refs?appId={appId}&spaceId={spaceId}` | `cas:root-refs:read` + `refDomain` | Revision-stable page |
| `updateRootRefs` | `POST /v1/cas/root-refs?appId={appId}&spaceId={spaceId}` | `cas:root-refs:update` + `refDomain` | Atomic commit result |

There are no other public v1 Space operations in the current generated
OpenAPI.

## Read node content

```http
GET /v1/cas/nodes/HASH?appId=APP_ID&spaceId=%2Fusers%2Fu_123
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

Both successful forms return `Accept-Ranges: bytes`, `Content-Length`, the
node's `Content-Type`, and `X-CAS-Refs`. `X-CAS-Refs` is an ordered,
comma-separated list of zero to 256 lowercase child digests; an empty node
uses an empty header value. A `206` also returns
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

When immutable metadata and the complete content are both needed, use
`readNode(hash, { signal }?)`. It makes one authorized content request and
returns `{ metadata, content }`, deriving `size`, `contentType`, and ordered
`refs` from the response headers. Use `readMetadata` separately only when the
mutable lease or Root Ref state is required, or when a configured metadata
cache is intentionally preferred.

This read is repeatable. Use bounded retries only for transient failures and
honor cancellation.

## Read node metadata

```http
GET /v1/cas/nodes/HASH/metadata?appId=APP_ID&spaceId=%2Fusers%2Fu_123
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
POST /v1/cas/nodes/HASH/lease?appId=APP_ID&spaceId=%2Fusers%2Fu_123
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
GET /v1/cas/usage?appId=APP_ID&spaceId=%2Fusers%2Fu_123
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
POST /v1/cas/gc?appId=APP_ID&spaceId=%2Fusers%2Fu_123
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
GET /v1/cas/root-refs?appId=APP_ID&spaceId=%2Fusers%2Fu_123&limit=100&cursor=CURSOR
Authorization: Bearer CAPABILITY
```

Query:

| Name | Constraint |
| --- | --- |
| `appId` | Required App target; must match the verified issuer authority |
| `spaceId` | Required canonical Space ID |
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
POST /v1/cas/root-refs?appId=APP_ID&spaceId=%2Fusers%2Fu_123
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

Only `error` is required by OpenAPI. Stable public values are:

| Status | Stable `error` values |
| --- | --- |
| `400` | `INVALID_REQUEST`, `ROOT_REF_INVALID` |
| `401` | `missing_token`, `invalid_token`, `unknown_issuer`, `registry_unavailable` |
| `403` | `insufficient_permission`, `resource_scope_mismatch`, `unsupported_algorithm`, `registry_unavailable`, `APP_SUSPENDED`, `ROOT_REF_INVALID` |
| `404` | `NODE_NOT_FOUND` |
| `409` | `NODE_CONFLICT`, `NODE_NOT_READY`, `NEGATIVE_AGGREGATE`, `IDEMPOTENCY_CONFLICT` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `416` | `INVALID_REQUEST` for an invalid or unsatisfiable `readContent` range |
| `429` | `CAS_UPLOAD_LIMIT` |
| `503` | `STORAGE_ERROR`, `ROOT_REF_BUSY`, `SERVICE_UNAVAILABLE` |

Callers should branch on the stable `error` value and treat `message` as
optional safe diagnostic text. `CasClientError.code` preserves `error` when a
JSON envelope is present.

Lease results also have typed `rejection.code` values:
`NODE_TOO_LARGE`, `NODE_DIGEST_MISMATCH`, `INVALID_CANONICAL_NODE`, and
`NODE_CONFLICT`. These are successful lease-state responses, not error
envelopes.

## Contract alignment

The TypeScript contract and generated OpenAPI now describe the existing runtime
behavior without changing it:

1. `readContent` declares the canonical binary media type, optional `Range`,
   `200`, `206`, `416`, and all public response headers.
2. `components.schemas.SpaceCapabilityClaims` describes the signed JWT claims.
   `x-unicas-capability` links that schema and explicitly states that
   permissions are not OAuth scopes.
3. Every public operation has `x-unicas-authorization` with its exact
   permission and required signed claims; Root Ref operations also link the
   `SpaceRefDomainClaim` constraint.
4. Root Ref request limits and stable error values come from shared
   protocol-owned constants used by the runtime or checked by focused tests.

The normative upload contract is the lease request, its typed state/rejection
response, and the exact direct-upload method, URL, and headers returned by the
service. Temporary object keys, upload generations, presigner credentials,
repository retries, physical offsets, cache refresh telemetry, and storage log
details are implementation diagnostics. They are intentionally absent from the
public contract and must not be inferred as routes, fields, or recovery APIs.

The
[generated OpenAPI](../../../space-protocol/openapi/app-space-v1.openapi.json)
remains the complete public operation inventory.

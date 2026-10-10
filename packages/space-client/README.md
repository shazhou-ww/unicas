# @unicas/space-client

[![npm version](https://img.shields.io/npm/v/%40unicas%2Fspace-client?label=npm)](https://www.npmjs.com/package/%40unicas%2Fspace-client)
[![MIT license](https://img.shields.io/npm/l/%40unicas%2Fspace-client)](https://github.com/shazhou-ww/unicas/blob/main/LICENSE)

Thin HTTP transport for the UniCAS App/Space v1 data plane. One client binds an
App, accepts the target Space on every operation, and obtains least-privileged
capabilities through an App-owned provider.

## When to use this package

Use `@unicas/space-client` when code needs direct access to immutable CAS nodes,
Root Refs, usage, or garbage collection. It deliberately does not encode
canonical nodes, upload returned direct-upload instructions, split blobs, or
model files.

For ordinary application content, prefer the layer that owns the workflow:

- `@unicas/space-blob-client` for chunked blobs, random-access reads, and
  retain/release operations;
- `@unicas/space-file-client` for files, directories, and committed working
  trees; and
- `@unicas/space-browser-cache` to cache immutable node reads in a browser.

## Install

```sh
npm install @unicas/space-client
```

## Create an App-level client

<!-- sdk-snippet: space-client -->
```ts
import {
  createAppCasClient,
  type SpaceCapabilityProvider,
} from "@unicas/space-client";

declare const appId: string;
declare const spaceId: string;
declare const hash: string;
declare const previousHash: string;
declare const nextHash: string;
declare const capabilityProvider: SpaceCapabilityProvider;

const cas = createAppCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  capabilityProvider,
});
```

The provider receives the requested `appId`, `spaceId`, exact permission, and
acquisition reason. It returns an opaque bearer token plus trusted metadata
describing that token's version, expiry, grants, and optional Root Ref domain.
The SDK does not parse JWTs and the service remains the authorization
authority. Obtain capabilities through the App's authenticated flow; never put
an App signing key or administrator credential in browser code.

Keep one `AppCasClient` for the App and pass the target `spaceId` directly to
each operation. There is no Space-bound client or `forSpace()` wrapper.

## Read immutable node content

Use `readNode` when both immutable metadata and the complete content are needed.
It obtains both with one authorized content request.

<!-- sdk-snippet: space-client -->
```ts
const controller = new AbortController();
const node = await cas.readNode(spaceId, hash, {
  signal: controller.signal,
});

console.log(node.metadata.size, node.metadata.contentType, node.metadata.refs);
const bytes = new Uint8Array(await new Response(node.content).arrayBuffer());
```

Use `readMetadata` when only metadata is needed, or request a logical content
range with `readContent`:

<!-- sdk-snippet: space-client -->
```ts
const metadata = await cas.readMetadata(spaceId, hash);
const firstKilobyte = await cas.readContent(spaceId, hash, {
  offset: 0,
  length: Math.min(1024, metadata.size),
});
const preview = new Uint8Array(
  await new Response(firstKilobyte).arrayBuffer(),
);
```

## List and atomically update Root Refs

Root Ref capabilities also carry the App-selected `refDomain`. Page through the
current domain with `listRootRefs`:

<!-- sdk-snippet: space-client -->
```ts
let cursor: string | undefined;

do {
  const page = await cas.listRootRefs(spaceId, { limit: 100, cursor });
  for (const item of page.items) {
    console.log(item.hash, item.refCount);
  }
  cursor = page.nextCursor ?? undefined;
} while (cursor !== undefined);
```

Commit a business transition as one atomic change map. Reuse the same
`requestId` and exact payload after an uncertain response.

<!-- sdk-snippet: space-client -->
```ts
await cas.updateRootRefs(spaceId, {
  requestId: crypto.randomUUID(),
  changes: {
    [previousHash]: -1,
    [nextHash]: 1,
  },
});
```

## Lease raw nodes

`leaseNode(spaceId, hash)` makes one JSON lease request. A non-ready result may contain
direct `PUT` instructions, but this package does not create canonical bytes or
perform that upload. Use `storeNodeContent` from `@unicas/space-blob-client`
for a raw-node helper, or use the blob/file clients for complete workflows.

## Operations and capabilities

| Operations | Capability permission | Purpose |
| --- | --- | --- |
| `readNode(spaceId, ...)`, `readMetadata(spaceId, ...)`, `readContent(spaceId, ...)` | `cas:nodes:read` | Read immutable node data |
| `leaseNode(spaceId, ...)` | `cas:nodes:lease` | Acquire or renew a node lease and negotiate direct upload |
| `listRootRefs(spaceId, ...)` | `cas:root-refs:read` + `refDomain` | Inspect one Root Ref domain |
| `updateRootRefs(spaceId, ...)` | `cas:root-refs:update` + `refDomain` | Atomically retain or release roots |
| `usage(spaceId, ...)` | `cas:usage:read` | Read current Space accounting |
| `gc(spaceId, ...)` | `cas:gc:execute` | Run one bounded garbage-collection pass |

## Errors, retries, and cancellation

<!-- sdk-snippet: space-client -->
```ts
import {
  CasCapabilityError,
  CasClientError,
} from "@unicas/space-client";

try {
  await cas.readMetadata(spaceId, hash);
} catch (error) {
  if (error instanceof CasClientError) {
    console.error(error.status, error.code, error.message);
  }
  if (error instanceof CasCapabilityError) {
    console.error(error.code, error.message);
  }
  throw error;
}
```

`status` always preserves the non-success HTTP status. `code` preserves the
response envelope's stable `error` value when the server returned one; branch
on `code`, not the optional diagnostic text in `message`.

`CasCapabilityError` reports provider failures, invalid provider metadata, and
metadata that does not satisfy the exact operation requirement. The client
keeps at most one current credential in each fixed internal class and
coalesces concurrent acquisition for that class.

After `401 invalid_token`, the client may reacquire and replay exactly once for
`readNode`, `readMetadata`, `readContent`, `listRootRefs`, and `usage`.
Mutations (`leaseNode`, `updateRootRefs`, and `gc`), `403` responses, and
network failures are never automatically replayed. Keep the same idempotency
key and payload when the App decides to retry an uncertain Root Ref update.
Operations accept `AbortSignal` through their documented arguments.

The package is ESM-only. It supports Node.js 24+ and the browser engines and
Fetch/Web Streams APIs in the
[compatibility matrix](https://docs.unicas.work/app-user-api/compatibility/).
Only the package-root export is public.

## Documentation and support

- [SDK package guide](https://docs.unicas.work/app-user-api/sdk/)
- [Quickstarts](https://docs.unicas.work/app-user-api/quickstart/)
- [Compatibility](https://docs.unicas.work/app-user-api/compatibility/)
- [HTTP operation reference](https://docs.unicas.work/app-user-api/http-api/)
- [TypeScript API reference](https://docs.unicas.work/app-user-api/sdk-reference/)
- [Versioning](https://docs.unicas.work/app-user-api/versioning/)
- [Changelog](https://docs.unicas.work/app-user-api/changelog/)
- [Support](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md)
- [Security](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md)

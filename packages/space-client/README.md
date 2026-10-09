# @unicas/space-client

Thin HTTP transport for the UniCAS App/Space v1 data plane. A client binds one
App and Space and requests a current capability before every HTTP operation.

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

## Create a Space-bound client

```ts
import { createSpaceCasClient } from "@unicas/space-client";

const cas = createSpaceCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  spaceId,
  getToken,
});
```

`getToken` returns a currently valid Space capability for this App and Space.
The capability must contain the exact permission for each operation. Refresh it
through the App's authenticated flow; never put an App signing key or
administrator credential in browser code.

## Read immutable node content

Use `readNode` when both immutable metadata and the complete content are needed.
It obtains both with one authorized content request.

```ts
const controller = new AbortController();
const node = await cas.readNode(hash, { signal: controller.signal });

console.log(node.metadata.size, node.metadata.contentType, node.metadata.refs);
const bytes = new Uint8Array(await new Response(node.content).arrayBuffer());
```

Use `readMetadata` when only metadata is needed, or request a logical content
range with `readContent`:

```ts
const metadata = await cas.readMetadata(hash);
const firstKilobyte = await cas.readContent(hash, {
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

```ts
let cursor: string | undefined;

do {
  const page = await cas.listRootRefs({ limit: 100, cursor });
  for (const item of page.items) {
    console.log(item.hash, item.refCount);
  }
  cursor = page.nextCursor ?? undefined;
} while (cursor !== undefined);
```

Commit a business transition as one atomic change map. Reuse the same
`requestId` and exact payload after an uncertain response.

```ts
await cas.updateRootRefs({
  requestId: crypto.randomUUID(),
  changes: {
    [previousHash]: -1,
    [nextHash]: 1,
  },
});
```

## Lease raw nodes

`leaseNode(hash)` makes one JSON lease request. A non-ready result may contain
direct `PUT` instructions, but this package does not create canonical bytes or
perform that upload. Use `storeNodeContent` from `@unicas/space-blob-client`
for a raw-node helper, or use the blob/file clients for complete workflows.

## Operations and capabilities

| Operations | Capability permission | Purpose |
| --- | --- | --- |
| `readNode`, `readMetadata`, `readContent` | `cas:nodes:read` | Read immutable node data |
| `leaseNode` | `cas:nodes:lease` | Acquire or renew a node lease and negotiate direct upload |
| `listRootRefs` | `cas:root-refs:read` + `refDomain` | Inspect one Root Ref domain |
| `updateRootRefs` | `cas:root-refs:update` + `refDomain` | Atomically retain or release roots |
| `usage` | `cas:usage:read` | Read current Space accounting |
| `gc` | `cas:gc:execute` | Run one bounded garbage-collection pass |

## Errors, retries, and cancellation

```ts
import { CasClientError } from "@unicas/space-client";

try {
  await cas.readMetadata(hash);
} catch (error) {
  if (error instanceof CasClientError) {
    console.error(error.status, error.message);
  }
  throw error;
}
```

The client preserves non-success HTTP status in `CasClientError`. It does not
automatically retry or broaden permissions. Retry only transient failures with
a bounded App-owned policy, and keep the same idempotency key and payload for
an uncertain Root Ref update. Read, list, lease, usage, and GC operations
accept `AbortSignal` through their documented arguments.

The package is ESM-only and supports Node.js 24+ and modern browsers with Fetch
and Web Streams. Only the package-root export is public. See the
[App-user integration guide](https://docs.unicas.work/app-user-api/) and
[HTTP operation reference](https://docs.unicas.work/app-user-api/http-api/)
for capability and wire behavior.

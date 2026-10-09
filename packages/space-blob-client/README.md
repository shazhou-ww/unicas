# @unicas/space-blob-client

Blob storage and random-access reads above `@unicas/space-client`.

## When to use this package

Use the blob client when an application stores byte content rather than raw CAS
nodes. It canonicalizes and hashes content, chunks large blobs, builds opaque
client-owned index nodes, follows direct-upload instructions, and exposes
logical whole/range reads.

Uploading creates leases, not durable business references. Call `retain` after
the App commits the blob hash to its business state, and call `release` only
after that business reference is removed.

## Install

```sh
npm install @unicas/space-client @unicas/space-blob-client
```

## Create the clients

<!-- sdk-snippet: space-blob-client -->
```ts
import { createSpaceCasClient } from "@unicas/space-client";
import { createCasBlobClient } from "@unicas/space-blob-client";

declare const appId: string;
declare const spaceId: string;
declare const getToken: () => Promise<string>;
declare const requestId: string;
declare const releaseRequestId: string;

const cas = createSpaceCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  spaceId,
  getToken,
});
const blobs = createCasBlobClient(cas);
```

The capability returned by `getToken` normally needs `cas:nodes:lease` for
writes, `cas:nodes:read` for reads, and `cas:root-refs:update` plus a
`refDomain` for retain/release operations.

## Store and retain a blob

`storeBlob` accepts a `Blob` or `ReadableStream<Uint8Array>`. Supplying `size`
validates the number of consumed source bytes.

<!-- sdk-snippet: space-blob-client -->
```ts
const source = new Blob(["hello from UniCAS"], { type: "text/plain" });
const stored = await blobs.storeBlob(source, {
  contentType: source.type,
  size: source.size,
  onProgress: (uploadedBytes) => {
    console.log(`uploaded ${uploadedBytes}/${source.size}`);
  },
});

// First persist stored.hash in the App's business record. Then make the root
// durable with an idempotency key that can be reused after an uncertain reply.
await blobs.retain({ requestId, references: { [stored.hash]: 1 } });
```

Keep `requestId` stable for this exact retain transition. The capability's
`refDomain` selects the Root Ref domain in which the count is recorded.

## Read all or part of a blob

<!-- sdk-snippet: space-blob-client -->
```ts
const handle = await blobs.openBlob(stored.hash);
const firstKilobyte = await handle.readBytes({ offset: 0, length: 1024 });
const completeBlob = await new Response(handle.read()).blob();
```

`openBlob` resolves the logical media type and size even when the content spans
many CAS nodes. `read()` streams the whole blob or a range; `readBytes()` is for
an explicitly bounded range that should be materialized in memory.

## Release a business reference

After the App removes its durable reference, decrement the corresponding
UniCAS Root Ref with a new stable idempotency key:

<!-- sdk-snippet: space-blob-client -->
```ts
await blobs.release({
  requestId: releaseRequestId,
  references: { [stored.hash]: 1 },
});
```

`retain` and `release` accept positive counts and translate them into positive
or negative atomic Root Ref changes. Do not release a blob that business state
still references. Space accounting and bounded GC remain available through
`blobs.unicasClient.usage()` and `blobs.unicasClient.gc()`.

The package is ESM-only. It supports Node.js 24+ and the browser engines and
Blob/Fetch/Web Streams/Web Crypto APIs in the
[compatibility matrix](https://docs.unicas.work/app-user-api/compatibility/).
Only the package-root export is public.

## Documentation and support

- [SDK package guide](https://docs.unicas.work/app-user-api/sdk/)
- [Quickstarts and host responsibilities](https://docs.unicas.work/app-user-api/quickstart/)
- [Compatibility](https://docs.unicas.work/app-user-api/compatibility/)
- [TypeScript API reference](https://docs.unicas.work/app-user-api/sdk-reference/)
- [Versioning](https://docs.unicas.work/app-user-api/versioning/)
- [Changelog](https://docs.unicas.work/app-user-api/changelog/)
- [Support](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md)
- [Security](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md)

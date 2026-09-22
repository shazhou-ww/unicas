# @unicas/space-blob-client

Blob storage and random-access reads above `@unicas/space-client`.

```sh
npm install @unicas/space-blob-client@beta
```

```ts
import { createCasBlobClient } from "@unicas/space-blob-client";

const blobs = createCasBlobClient(cas);
const stored = await blobs.storeBlob(new Blob([bytes]), {
  contentType: "application/octet-stream",
  size: bytes.length,
});
await blobs.retain({ requestId, references: { [stored.hash]: 1 } });

const handle = await blobs.openBlob(stored.hash);
const firstKilobyte = await handle.readBytes({ offset: 0, length: 1024 });
```

The client chunks large blobs into canonical nodes, builds client-owned blob
indexes, and exposes explicit retain/release operations. UniCAS stores index
content opaquely.

The package is ESM-only and supports Node.js 24+ and modern browsers with Blob,
Fetch, Web Streams, and Web Crypto APIs. Only the package-root export is public.

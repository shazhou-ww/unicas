# @unicas/space-file-client

File manifests and mutable working trees above the UniCAS blob and Space
clients.

```sh
npm install @unicas/space-file-client@beta
```

```ts
import { createSpaceFileSystem } from "@unicas/space-file-client";

const files = createSpaceFileSystem({ cas, catalog });
const root = await files.createRoot("Documents");
await root.mkdir("/notes");
await root.write("/notes/today.txt", new Blob(["hello"]), {
  contentType: "text/plain",
});
await root.commit();
```

The application supplies a `SpaceFileRootCatalog` that persists root identity
and revisions in its own business database. UniCAS stores immutable file/blob
content and Root Refs but does not interpret directory semantics.

The package is ESM-only and supports Node.js 24+ and modern browsers with Blob,
Web Streams, Web Crypto, and encoding APIs. Only the package-root export is
public.

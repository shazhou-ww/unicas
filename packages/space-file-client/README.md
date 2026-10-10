# @unicas/space-file-client

[![npm version](https://img.shields.io/npm/v/%40unicas%2Fspace-file-client?label=npm)](https://www.npmjs.com/package/%40unicas%2Fspace-file-client)
[![MIT license](https://img.shields.io/npm/l/%40unicas%2Fspace-file-client)](https://github.com/shazhou-ww/unicas/blob/main/LICENSE)

File manifests and mutable working trees above the UniCAS blob and Space
clients.

## When to use this package

Use the file client when an App needs named roots containing directories and
files. It provides `stat`, `readdir`, `read`, `write`, `mkdir`, `move`, `copy`,
`remove`, explicit `commit`, and `discard`.

UniCAS stores immutable file/blob content and Root Refs, but it does not own
root names or decide which roots belong to a Principal. The App must implement
`SpaceFileRootCatalog` in its business database.

## Install

```sh
npm install @unicas/space-client @unicas/space-file-client
```

## Provide an App-owned root catalog

The catalog is a small persistence port. A typical adapter scopes every
operation to the authenticated Principal and enforces `revision` as an
optimistic concurrency check:

<!-- sdk-snippet: space-file-client -->
```ts
import type { SpaceFileRootCatalog } from "@unicas/space-file-client";

declare const principalId: string;
declare const rootRepository: {
  list(principal: string): ReturnType<SpaceFileRootCatalog["list"]>;
  create(
    principal: string,
    input: Parameters<SpaceFileRootCatalog["create"]>[0],
  ): ReturnType<SpaceFileRootCatalog["create"]>;
  compareAndSwap(
    principal: string,
    input: Parameters<SpaceFileRootCatalog["update"]>[0],
  ): ReturnType<SpaceFileRootCatalog["update"]>;
  deleteIfRevision(
    principal: string,
    input: Parameters<SpaceFileRootCatalog["delete"]>[0],
  ): ReturnType<SpaceFileRootCatalog["delete"]>;
};

const catalog: SpaceFileRootCatalog = {
  list: () => rootRepository.list(principalId),
  create: (input) => rootRepository.create(principalId, input),
  update: (input) => rootRepository.compareAndSwap(principalId, input),
  delete: (input) => rootRepository.deleteIfRevision(principalId, input),
};
```

`create` and `update` return the complete persisted `SpaceFileRootInfo`,
including timestamps and the resulting revision. `update` and `delete` must
fail rather than overwrite when the supplied revision is stale. Never use an
email address or display name as the stable Principal key.

## Create a file system and commit a working tree

<!-- sdk-snippet: space-file-client -->
```ts
import {
  createAppCasClient,
  type SpaceCapabilityProvider,
} from "@unicas/space-client";
import { createSpaceFileSystem } from "@unicas/space-file-client";

declare const appId: string;
declare const spaceId: string;
declare const capabilityProvider: SpaceCapabilityProvider;

const cas = createAppCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  capabilityProvider,
});
const files = createSpaceFileSystem({ client: cas, spaceId, catalog });
const root = await files.createRoot("Documents");

await root.mkdir("/notes");
await root.write("/notes/today.txt", new Blob(["hello"]), {
  contentType: "text/plain",
});
console.log(root.dirty); // true; the catalog still points at the old snapshot

const entries = await root.readdir("/notes");
const text = await new Response(
  await root.read("/notes/today.txt"),
).text();

const committed = await root.commit();
console.log(committed.revision, root.dirty); // false after commit
```

Writes upload and lease immutable content immediately, but catalog-visible
state changes only at `commit()`. Commit stores and retains the new manifest,
updates the catalog with optimistic concurrency, and then releases the previous
manifest. `discard()` restores the last committed in-memory snapshot.

## Reopen, edit, or delete a root

<!-- sdk-snippet: space-file-client -->
```ts
const [saved] = await files.listRoots();
if (saved === undefined) throw new Error("expected a saved root");
const reopened = await files.openRoot(saved);

await reopened.move("/notes/today.txt", "/today.txt");
await reopened.commit();

await files.deleteRoot(saved.rootId);
```

Pass a `SpaceFileRootInfo` returned by `listRoots` to `openRoot` to avoid a
second catalog lookup. `deleteRoot` removes the catalog record with its current
revision and releases the manifest Root Ref; it does not reinterpret file
content on the server.

File workflows need node read/lease permissions and Root Ref update permission
with the App-selected `refDomain`. The App remains responsible for user
authentication, Principal-to-Space mapping, catalog authorization, retries,
and conflict presentation.

The package is ESM-only. It supports Node.js 24+ and the browser engines and
Blob/Web Streams/Web Crypto/encoding APIs in the
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

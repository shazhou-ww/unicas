# @unicas/space-file-client

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

```ts
import type { SpaceFileRootCatalog } from "@unicas/space-file-client";

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

```ts
import { createSpaceCasClient } from "@unicas/space-client";
import { createSpaceFileSystem } from "@unicas/space-file-client";

const cas = createSpaceCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  spaceId,
  getToken,
});
const files = createSpaceFileSystem({ cas, catalog });
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

```ts
const [saved] = await files.listRoots();
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

The package is ESM-only and supports Node.js 24+ and modern browsers with Blob,
Web Streams, Web Crypto, and encoding APIs. Only the package-root export is
public. See the
[App-user integration guide](https://docs.unicas.work/app-user-api/) for the
surrounding trust and retention model.

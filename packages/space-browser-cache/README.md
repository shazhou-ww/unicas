# @unicas/space-browser-cache

[![npm version](https://img.shields.io/npm/v/%40unicas%2Fspace-browser-cache?label=npm)](https://www.npmjs.com/package/%40unicas%2Fspace-browser-cache)
[![MIT license](https://img.shields.io/npm/l/%40unicas%2Fspace-browser-cache)](https://github.com/shazhou-ww/unicas/blob/main/LICENSE)

Optional browser implementation of `CasNodeCache`. The HTTP client remains
platform-neutral and has no dependency on this package. No server or application
manifest types are imported; the `space-client` dependency is type-only in source.

## When to use this package

Use this package in an authenticated browser session to avoid repeatedly
downloading immutable node metadata and complete node content. Do not use it as
an authorization decision, mutable catalog, offline file system, or server
cache.

## Install

```sh
npm install @unicas/space-client @unicas/space-browser-cache
```

## Cache authenticated node reads

<!-- sdk-snippet: space-browser-cache -->
```ts
import { createSpaceCasClient } from "@unicas/space-client";
import {
  clearBrowserCasNodeCaches,
  createBrowserCasNodeCache,
} from "@unicas/space-browser-cache";

declare const identity: {
  readonly identityIssuer: string;
  readonly subject: string;
};
declare const casBaseUrl: string;
declare const appId: string;
declare const spaceId: string;
declare const hash: string;
declare const getToken: () => Promise<string>;

const principal = JSON.stringify([identity.identityIssuer, identity.subject]);
const cache = createBrowserCasNodeCache({
  namespace: { endpoint: casBaseUrl, principal },
  maxBytes: 64 * 1024 * 1024,
  maxMemoryBytes: 8 * 1024 * 1024,
  maxEntryBytes: 4 * 1024 * 1024,
});
const cas = createSpaceCasClient({
  baseUrl: casBaseUrl,
  appId,
  spaceId,
  getToken,
  cache,
});

const metadata = await cas.readMetadata(hash);
const content = await cas.readContent(hash);

// A full content read is cached only after the stream is completely consumed.
const bytes = new Uint8Array(await new Response(content).arrayBuffer());

// At logout, stop new reads before clearing every endpoint for this principal.
await clearBrowserCasNodeCaches({ principal });
cache.close();
```

`readMetadata` and complete `readContent` calls participate in this cache.
Range misses pass through without being stored. `readNode` remains a combined
one-request network operation and does not use the separate metadata/content
cache hooks.

## Contract

This package is browser-only and ESM-only. It requires IndexedDB and the modern
browser Blob, URL, Web Streams, and encoding APIs; BroadcastChannel is an
optional cross-tab invalidation enhancement.

- Keys include endpoint, authenticated Principal, App, Space, hash, read kind,
  and an explicit version. Use an immutable identity key, never an access token
  or display email. The endpoint must not contain credentials, a query or a
  fragment.
- Stores only immutable node metadata (`hash`, `size`, `contentType`, `refs`) and
  completely consumed node own-content. Neither mutable node state nor file-root
  working copies, catalog revisions, leases, GC results or usage are persisted.
- Complete content hits return independent streams; range hits slice the full Blob.
  Range misses pass through and are not stored. Reads above the per-entry limit
  discard the bounded buffer and continue streaming. No `tee()` or background drain
  is used. Cancelled/incomplete and failed streams do not populate the cache.
- Only metadata loads without a signal coalesce. Content misses are independent,
  so a slow or abandoned reader cannot block another caller. Pass the optional
  request signal to abort a cache-hit stream too.
- Memory uses per-instance LRU; IndexedDB uses per-endpoint/Principal LRU shared by
  that versioned partition's Apps and Spaces. Limits count payload bytes, not browser
  storage overhead, and buffering is bounded per concurrent read. Empty content
  counts as one byte. Metadata counts its UTF-8 JSON size.
- IndexedDB unavailable, open blocked for over one second, or a failed storage
  operation falls back to bounded memory/network. Storage failure does not fail a
  successful CAS read. Clearing is likewise best-effort if browser storage fails.
- `clear()` deletes one endpoint/principal partition and invalidates live caches
  and earlier in-flight writes. `clearBrowserCasNodeCaches({principal})` clears all
  endpoints for that principal, including prior page sessions. Other identities
  remain untouched. BroadcastChannel invalidation is best-effort across tabs.
- `close()` releases memory and browser resources, prevents further cache writes,
  and leaves persisted content intact. Call it on owner disposal. When clearing,
  await deletion before closing connections.

## Authorization Boundary

A cache hit does not request a token or check current server permissions. Gate
cache creation/use on successful session discovery, refresh mutable catalogs from
the server, and stop reads at logout. IndexedDB is not an authentication boundary
or encrypted secret store; any same-origin script can access it. Cached bytes do
not prove that a node is still leased, retained, present on the server, or accessible
under current permissions. Use explicit live server operations for those decisions.

The default database is `unicas-node-cache-v2`. `databaseName` can isolate
independent applications/tests; use the same entrypoint and name for
Principal-wide clearing.

## Verification

```sh
pnpm --filter @unicas/space-browser-cache test
pnpm --filter @unicas/space-browser-cache typecheck
```

The package is browser-only and ESM-only. Supported engines and required Web
APIs are listed in the
[compatibility matrix](https://docs.unicas.work/app-user-api/compatibility/).
Only the package-root export is public.

## Documentation and support

- [SDK package guide](https://docs.unicas.work/app-user-api/sdk/)
- [Browser quickstart](https://docs.unicas.work/app-user-api/quickstart/#browser-cache-quickstart)
- [Compatibility](https://docs.unicas.work/app-user-api/compatibility/)
- [TypeScript API reference](https://docs.unicas.work/app-user-api/sdk-reference/)
- [Versioning](https://docs.unicas.work/app-user-api/versioning/)
- [Changelog](https://docs.unicas.work/app-user-api/changelog/)
- [Support](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md)
- [Security](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md)
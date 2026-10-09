# App-user SDK

The UniCAS App-user SDK is one ESM-only, unified-version product published as
six focused npm packages. Install only the layers your App owns.

## Choose a package

| Need | Package | Responsibility |
| --- | --- | --- |
| Canonical node bytes and digests | `@unicas/codec` | Pure encoding and validation; no HTTP |
| App/Space v1 contracts and capability vocabulary | `@unicas/space-protocol` | Types, schemas, routes, and OpenAPI |
| Direct node, Root Ref, usage, or GC operations | `@unicas/space-client` | Thin Space-bound HTTP transport |
| Chunked blobs, random access, and retain/release | `@unicas/space-blob-client` | Blob workflow above the transport |
| Immutable node cache in an authenticated browser | `@unicas/space-browser-cache` | Bounded memory and IndexedDB cache |
| Named file roots and committed working trees | `@unicas/space-file-client` | File workflow plus an App-owned catalog port |

Start with the highest-level package that matches the App. Do not use the
transport as a shortcut around canonical encoding, direct-upload instructions,
Root Ref retention, or the App-owned file catalog.

```sh
npm install @unicas/space-client
```

The default npm dist-tag is the supported stable release. Do not install
`@beta` unless a specific migration document explicitly requires a historical
artifact.

## Codec

`@unicas/codec` creates, parses, hashes, and validates canonical node bytes.
Use it for wire-format work that does not perform I/O.

## Space protocol

`@unicas/space-protocol` owns the App/Space v1 HTTP contract, route helpers,
schemas, capability vocabulary, and the only public subpath export:
`@unicas/space-protocol/openapi.json`.

## Space client

`@unicas/space-client` binds one App and Space to a token provider and exposes
one thin operation for each public Space route. It does not upload direct PUT
bodies or model blobs and files.

## Space blob client

`@unicas/space-blob-client` stores and reads logical blobs. `storeBlob` creates
leases; an App persists the returned hash and then calls `retain` to establish
its durable business reference.

## Space browser cache

`@unicas/space-browser-cache` caches immutable metadata and completely consumed
content. It is not an authorization decision, mutable catalog, encrypted
secret store, or offline file system. Clear the Principal partition at logout.

## Space file client

`@unicas/space-file-client` manages file manifests and mutable in-memory working
trees. The App implements `SpaceFileRootCatalog`; only `commit()` changes the
catalog-visible snapshot.

## Continue

- [Quickstarts](quickstart.md)
- [Compatibility](compatibility.md)
- [Versioning and API changes](versioning.md)
- [TypeScript API reference](sdk-reference.md)
- [Troubleshooting](troubleshooting.md)
- [SDK changelog](changelog.md)
- [Support policy](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md)
- [Security policy](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md)

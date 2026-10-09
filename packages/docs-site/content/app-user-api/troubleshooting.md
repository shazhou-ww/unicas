# App-user SDK troubleshooting

## Import or module errors

The SDK is ESM-only. Use `import` from a package root and configure the consumer
for ESM. Do not use `require()` or import `src/` or `dist/` paths. The only
public subpath is `@unicas/space-protocol/openapi.json`.

Verify Node.js 24+ and TypeScript 5.9+ before diagnosing declaration errors.

## `401` or `403`

Obtain a fresh short-lived Space capability through the App's authenticated
flow. Check the exact App, Space, audience, permission, and `refDomain`.
Administrator sessions and credentials do not authorize App-user Space calls.
The client never broadens permissions or silently refreshes authority.

## A blob disappears after upload

`storeBlob` establishes temporary leases. Persist the returned hash in App
business state and then call `retain` with a stable request ID. Do not call
`release` until the durable business reference has been removed.

## File changes are not visible

Writes modify an in-memory working tree and upload immutable content.
Catalog-visible state changes only after `commit()` succeeds. The App-owned
`SpaceFileRootCatalog` must enforce Principal scope and optimistic revision
checks.

## Browser cache misses

Only `readMetadata` and completely consumed full `readContent` streams populate
the cache. Range misses, cancelled streams, oversized entries, and `readNode`
do not use the same cache path. IndexedDB failure falls back to bounded memory
and network.

At logout, stop new reads, await
`clearBrowserCasNodeCaches({ principal })`, and then close live cache instances.
A cache hit is not an authorization decision.

## Retry behavior

The SDK does not automatically retry. Use a bounded App-owned retry policy for
transient failures. Reuse the same request ID and exact payload after an
uncertain Root Ref update; do not reuse an idempotency key for another state
transition.

For a reproducible public question, follow
[SUPPORT.md](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md).
Report suspected vulnerabilities privately according to
[SECURITY.md](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md).

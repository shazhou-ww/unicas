# App-user SDK TypeScript API reference

Only the exports listed here and
`@unicas/space-protocol/openapi.json` are public. The release gate compares the
generated declarations with the committed
[API baseline](https://github.com/shazhou-ww/unicas/tree/main/sdk/api).

## `@unicas/codec`

- Canonical bytes: `encodeHeader`, `decodeHeader`, `concatenateNodeBytes`,
  `parseNodeBytes`, and format constants.
- Digest: `sha256`, `computeNodeDigest`, `hashToHex`, `hexToHash`.
- Streaming: `CanonicalNodeContentType`, `parseCanonicalNodeStream`,
  `ParsedCanonicalNodeStream`.
- Validation: canonical-size, hash, content-type, header, child-ref, and
  content-length validators plus `CanonicalNodeLimits`.

## `@unicas/space-protocol`

- Contract: `spaceApiContract`, `SpaceApiContract`, `SpaceApiBasePath`,
  `SpaceApiErrorMap`, `SpaceApiStableErrorMap`,
  `SpaceApiStableErrorCodesByStatus`,
  `SpaceReadContentHttpContract`, `SpaceReadContentHttpResponse`,
  `SpaceReadContentRangeNotSatisfiable`, `DefaultSpaceNodeLeaseDurationMs`.
- Data types and Zod schemas for App, Space, nodes, leases, Root Refs, usage,
  and GC, including the shared Root Ref request bounds.
- HTTP helpers: `CasNodeRefsHeader`, `formatCasNodeRefsHeader`,
  `parseCasNodeRefsHeader`, `appSpaceRoutes`, `matchAppSpaceRoute`.
- Capability permissions, constants, parsing, validation, claim schema,
  operation policies, verified values, and typed authentication/authorization
  errors.
- OpenAPI JSON through the explicit `./openapi.json` subpath.

## `@unicas/space-client`

- `createAppCasClient(config)` creates one `AppCasClient`; every operation
  accepts `spaceId` first.
- Operations: `readNode`, `readMetadata`, `readContent`, `leaseNode`,
  `listRootRefs`, `updateRootRefs`, `usage`, and `gc`.
- `SpaceCapabilityProvider.acquire(requirement)` returns an opaque bearer token
  and trusted `SpaceCapabilityMetadata`; requirement types expose App, Space,
  exact permission, and acquisition reason.
- Configuration and result types include provider, fetcher, cache, range, node
  source, lease, Root Ref, usage, and GC contracts.
- `CasClientError` preserves the non-success HTTP status and stable response
  error code when present.
- `CasCapabilityError` exposes stable provider/metadata/requirement error
  codes.

## `@unicas/space-blob-client`

- `createCasBlobClient`, `CasBlobClient`, blob source/write/reference/handle
  types.
- `storeNodeContent` and `leaseNodeContent` for canonical raw-node workflows.
- `CasClientError` from the transport.
- Blob-index constants, encode/decode/validation helpers, and
  `CasBlobIndexV1`.

## `@unicas/space-browser-cache`

- `createBrowserCasNodeCache(options)` and `BrowserCasNodeCache`.
- `clearBrowserCasNodeCaches({ principal, databaseName? })`.
- `BrowserCasNodeCacheOptions` and the shared `CasNodeMetadata` type.

## `@unicas/space-file-client`

- `createSpaceFileSystem(options)` plus file-system, root, catalog, stat, and
  write option types.
- File manifest constants, entry types, creation, encoding, decoding,
  validation, and reference extraction.

The exact callable signatures and type members are preserved in the reviewed
baseline. Deep imports and symbols absent from the baseline are implementation
details and may change without notice.

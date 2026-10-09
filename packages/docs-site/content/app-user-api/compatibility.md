# App-user SDK compatibility

The SDK makes only compatibility promises that have continuous consumer
evidence.

## Supported matrix

| Surface | Supported contract | Release evidence |
| --- | --- | --- |
| Module format | ESM package-root imports | Packed manifest and external bundle checks |
| Node.js | 24 and newer within the active Node 24 line | Packed Node quickstart and workflow smoke |
| TypeScript | 5.9 and newer 5.x versions that accept the shipped declarations | External consumer typecheck uses TypeScript 5.9 |
| Chromium | Engine installed by the pinned Playwright release | Packed browser quickstart |
| Firefox | Engine installed by the pinned Playwright release | Packed browser quickstart |
| WebKit | Engine installed by the pinned Playwright release | Packed browser quickstart |
| Bundling | Native ESM and the pinned esbuild consumer | Packed Node and browser bundles |

The browser rows are executable engine targets, not a promise that every older
Chrome, Firefox, Safari, embedded webview, or vendor fork is supported.

## Required Web APIs

| Package | Runtime APIs |
| --- | --- |
| `@unicas/codec` | Web Crypto, Web Streams, `TextEncoder`, `TextDecoder` |
| `@unicas/space-protocol` | Standard ESM and the package's JavaScript dependencies |
| `@unicas/space-client` | Fetch, Web Streams, `AbortSignal` |
| `@unicas/space-blob-client` | Blob, Fetch, Web Streams, Web Crypto |
| `@unicas/space-browser-cache` | IndexedDB, Blob, URL, Web Streams; BroadcastChannel is optional |
| `@unicas/space-file-client` | Blob, Web Streams, Web Crypto, encoding APIs |

Node.js 24 supplies the Web APIs used by supported Node workflows. A browser
application must provide them natively; the SDK does not install global
polyfills.

## Not supported

The project does not currently promise CommonJS, Node.js before 24, Deno, Bun,
React Native, arbitrary bundlers, or server-side use of the browser cache.
An unsupported environment may work, but it is not a release gate and defects
specific to it may require a feature request before maintenance.

Only package-root exports are public, except for
`@unicas/space-protocol/openapi.json`. Imports from `dist/`, `src/`, or another
unlisted subpath are unsupported.

See [Versioning and API changes](versioning.md) for how compatibility changes
are released.

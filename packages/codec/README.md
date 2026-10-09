# @unicas/codec

[![npm version](https://img.shields.io/npm/v/%40unicas%2Fcodec?label=npm)](https://www.npmjs.com/package/%40unicas%2Fcodec)
[![MIT license](https://img.shields.io/npm/l/%40unicas%2Fcodec)](https://github.com/shazhou-ww/unicas/blob/main/LICENSE)

Canonical node encoding and validation for the UniCAS App/Space data plane.

## When to use this package

Use the codec when code needs to create, hash, parse, stream, or validate
canonical node bytes without performing HTTP operations. Blob indexes belong
to `@unicas/space-blob-client`; Space routes and capability types belong to
`@unicas/space-protocol`.

## Install

```sh
npm install @unicas/codec
```

<!-- sdk-snippet: codec -->
```ts
import {
  computeNodeDigest,
  concatenateNodeBytes,
  encodeHeader,
  hashToHex,
  parseNodeBytes,
} from "@unicas/codec";

const content = new TextEncoder().encode("hello");
const contentType = "text/plain";
const header = encodeHeader(content.length, contentType, 0);
const digest = await computeNodeDigest(header, contentType, [], content);
const canonical = concatenateNodeBytes(
  header,
  new TextEncoder().encode(contentType),
  [],
  content,
);

console.log(hashToHex(digest), parseNodeBytes(canonical).contentType);
```

The package is ESM-only. It supports Node.js 24+ and the browser engines and
Web APIs in the
[compatibility matrix](https://docs.unicas.work/app-user-api/compatibility/).
It contains no HTTP client or platform adapter. Only the package-root export is
public.

Package semver is independent from the canonical node wire version.

## Documentation and support

- [SDK package guide](https://docs.unicas.work/app-user-api/sdk/)
- [TypeScript API reference](https://docs.unicas.work/app-user-api/sdk-reference/)
- [Versioning](https://docs.unicas.work/app-user-api/versioning/)
- [Changelog](https://docs.unicas.work/app-user-api/changelog/)
- [Support](https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md)
- [Security](https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md)

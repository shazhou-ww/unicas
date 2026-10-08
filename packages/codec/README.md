# @unicas/codec

Canonical node encoding and validation for the UniCAS App/Space data plane.

```sh
npm install @unicas/codec@beta
```

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

The package is ESM-only and supports Node.js 24+ and modern browsers with Web
Crypto, Web Streams, and encoding APIs. It contains no HTTP client or platform
adapter.

Package semver is independent from the canonical node wire version.

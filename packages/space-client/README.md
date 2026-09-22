# @unicas/space-client

Thin HTTP transport for the UniCAS App/Space v1 API.

```sh
npm install @unicas/space-client@beta
```

```ts
import { createSpaceCasClient } from "@unicas/space-client";

const cas = createSpaceCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  spaceId,
  getToken: async () => capability,
});

const usage = await cas.usage();
```

The client binds one App and Space and exposes node reads, JSON lease-driven
direct upload, Root Ref listing and update, usage, and garbage collection. It
does not encode canonical node bytes or implement blob/file workflows; use
`@unicas/codec`, `@unicas/space-blob-client`, or
`@unicas/space-file-client` for those layers.

The package is ESM-only and supports Node.js 24+ and modern browsers with Fetch
and Web Streams. Only the package-root export is public.

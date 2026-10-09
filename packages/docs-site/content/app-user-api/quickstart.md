# App-user SDK quickstarts

The repository quickstarts are tested from packed tarballs in a clean temporary
directory. They do not resolve workspace source.

## Offline Node quickstart

This example binds a synthetic App and Space, injects a no-network fetcher, and
reads immutable metadata:

<!-- sdk-snippet: node-quickstart -->
```ts
import assert from "node:assert/strict";
import { createSpaceCasClient } from "@unicas/space-client";

const hash = "a".repeat(64);
const cas = createSpaceCasClient({
  baseUrl: "https://api.example",
  appId: "app-example",
  spaceId: "space-example",
  getToken: async () => "synthetic-capability",
  fetcher: {
    fetch: async () => Response.json({
      metadata: { hash, size: 5, contentType: "text/plain", refs: [] },
    }),
  },
});

const metadata = await cas.readMetadata(hash);
assert.equal(metadata.contentType, "text/plain");
```

Run the complete executable source:

```powershell
pnpm exec tsx examples/app-user-sdk/node-quickstart.ts
```

## Browser cache quickstart

Attach a Principal-scoped cache to the transport, completely consume content
before expecting it to be cached, and clear the Principal partition at logout:

<!-- sdk-snippet: browser-quickstart -->
```ts
import {
  clearBrowserCasNodeCaches,
  createBrowserCasNodeCache,
} from "@unicas/space-browser-cache";
import { createSpaceCasClient } from "@unicas/space-client";

const principal = "issuer.example:subject-example";
const cache = createBrowserCasNodeCache({
  namespace: { endpoint: "https://api.example", principal },
});
const cas = createSpaceCasClient({
  baseUrl: "https://api.example",
  appId: "app-example",
  spaceId: "space-example",
  getToken: async () => "synthetic-capability",
  cache,
});

await cas.readMetadata("a".repeat(64));
await clearBrowserCasNodeCaches({ principal });
cache.close();
```

The release gate bundles the complete
[`browser-quickstart.ts`](https://github.com/shazhou-ww/unicas/blob/main/examples/app-user-sdk/browser-quickstart.ts)
and runs it in Chromium, Firefox, and WebKit.

## Production boundary

An App backend authenticates its user, authorizes the requested Principal and
Space, and returns a short-lived capability through an App-owned authenticated
route. Browser code must never contain the App signing key or administrator
credentials.

Blob upload creates leases rather than a durable business reference. Persist
the blob hash in App state first, then call `retain` with a stable request ID.
For files, implement a Principal-scoped `SpaceFileRootCatalog`; `commit()` is
the catalog-visible snapshot boundary.

The tested
[`host-responsibilities.ts`](https://github.com/shazhou-ww/unicas/blob/main/examples/app-user-sdk/host-responsibilities.ts)
shows these sequencing rules.

## Optional live metadata read

The
[`live-metadata.ts`](https://github.com/shazhou-ww/unicas/blob/main/examples/app-user-sdk/live-metadata.ts)
example reads caller-owned environment variables and performs one
least-privileged metadata request. No public credential is provided or hosted.
Use a non-production Space and follow the example README without committing
the environment values.

import assert from "node:assert/strict";
import { createSpaceCasClient } from "@unicas/space-client";

const hash = "a".repeat(64);
let request: Request | undefined;

const cas = createSpaceCasClient({
  baseUrl: "https://api.example",
  appId: "app-example",
  spaceId: "space-example",
  getToken: async () => "synthetic-capability",
  fetcher: {
    async fetch(input, init) {
      request = input instanceof Request ? input : new Request(input, init);
      return Response.json({
        metadata: {
          hash,
          size: 5,
          contentType: "text/plain",
          refs: [],
        },
      });
    },
  },
});

const metadata = await cas.readMetadata(hash);

assert.equal(metadata.contentType, "text/plain");
const [scheme, token] = request?.headers.get("Authorization")?.split(" ") ?? [];
assert.equal(scheme, "Bearer");
assert.equal(token, "synthetic-capability");
assert.equal(
  new URL(request!.url).pathname,
  `/v1/apps/app-example/spaces/space-example/cas/nodes/${hash}/metadata`,
);

console.log("SDK NODE QUICKSTART PASS");

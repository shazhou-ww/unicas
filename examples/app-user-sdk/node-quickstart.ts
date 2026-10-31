import assert from "node:assert/strict";
import { parseSpaceSelector } from "@unicas/space-protocol";
import { createAppCasClient } from "@unicas/space-client";

const hash = "a".repeat(64);
const spaceId = "/space-example";
const selector = parseSpaceSelector(spaceId);
if (!selector) throw new Error("Invalid example Space ID");
let request: Request | undefined;

const cas = createAppCasClient({
  baseUrl: "https://api.example",
  appId: "app-example",
  capabilityProvider: {
    async acquire(requirement) {
      return {
        bearerToken: "synthetic-capability",
        metadata: {
          version: 2,
          expiresAt: Math.floor(Date.now() / 1000) + 300,
          grants: [{ selector: selector.selector, permissions: [requirement.permission] }],
        },
      };
    },
  },
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

const metadata = await cas.readMetadata(spaceId, hash);

assert.equal(metadata.contentType, "text/plain");
const [scheme, token] = request?.headers.get("Authorization")?.split(" ") ?? [];
assert.equal(scheme, "Bearer");
assert.equal(token, "synthetic-capability");
assert.equal(
  new URL(request!.url).pathname,
  `/v1/cas/nodes/${hash}/metadata`,
);
assert.equal(new URL(request!.url).searchParams.get("appId"), "app-example");
assert.equal(new URL(request!.url).searchParams.get("spaceId"), "/space-example");

console.log("SDK NODE QUICKSTART PASS");

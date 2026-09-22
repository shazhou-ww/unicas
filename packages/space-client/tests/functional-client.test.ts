import { beforeEach, describe, expect, it } from "vitest";
import {
  CasClientError,
  createSpaceCasClient,
} from "../src/index.js";

describe("functional Space CAS client", () => {
  let tokenCounter: number;

  beforeEach(() => {
    tokenCounter = 0;
  });

  it("sends one JSON request for an App/Space node lease", async () => {
    const requests: Request[] = [];
    const hash = "a".repeat(64);
    const client = createSpaceCasClient({
      baseUrl: "https://cas.test/",
      appId: "app-1",
      spaceId: "space-1",
      getToken: async () => `token-${++tokenCounter}`,
      fetcher: {
        async fetch(input, init) {
          const request = input instanceof Request ? input : new Request(input, init);
          requests.push(request);
          return Response.json({
            state: "awaiting_upload",
            hash,
            upload: {
              method: "PUT",
              url: "https://r2.test/upload-1",
              expiresAt: 1234,
              headers: { "If-None-Match": "*" },
            },
          });
        },
      },
    });

    await expect(client.leaseNode(hash)).resolves.toMatchObject({
      state: "awaiting_upload",
      hash,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get("Content-Type")).toBe("application/json");
    expect(requests[0].headers.get("X-CAS-Lease-Duration")).toBeNull();
    await expect(requests[0].json()).resolves.toEqual({ leaseDurationMs: 900_000 });
  });

  it("preserves HTTP status on client errors", async () => {
    const client = createSpaceCasClient({
      baseUrl: "https://cas.test/",
      appId: "app-1",
      spaceId: "space-1",
      getToken: async () => "token",
      fetcher: { fetch: async () => Response.json({ error: "NOT_FOUND" }, { status: 404 }) },
    });
    const error = await client.readMetadata("0".repeat(64)).catch(value => value);
    expect(error).toBeInstanceOf(CasClientError);
    expect(error).toMatchObject({ status: 404 });
  });

  it("consumes error response bodies instead of retaining an unread clone", async () => {
    let errorResponse: Response | undefined;
    const client = createSpaceCasClient({
      baseUrl: "https://cas.test/",
      appId: "app-1",
      spaceId: "space-1",
      getToken: async () => "token",
      fetcher: {
        async fetch() {
          errorResponse = Response.json({ error: "missing" }, { status: 404 });
          return errorResponse;
        },
      },
    });

    await expect(client.leaseNode("0".repeat(64))).rejects.toMatchObject({ status: 404 });
    expect(errorResponse?.bodyUsed).toBe(true);
  });

  it("uses the v1 App and Space route family with a versioned cache key", async () => {
    const requests: Request[] = [];
    const metadataKeys: unknown[] = [];
    const hash = "a".repeat(64);
    const client = createSpaceCasClient({
      baseUrl: "https://cas.test/",
      appId: "app/1",
      spaceId: "space/1",
      getToken: async () => "space-token",
      cache: {
        async metadata(key, load) {
          metadataKeys.push(key);
          return load();
        },
        read(_key, _range, load) {
          return load();
        },
      },
      fetcher: {
        async fetch(input, init) {
          const request = input instanceof Request ? input : new Request(input, init);
          requests.push(request);
          const pathname = new URL(request.url).pathname;
          if (pathname.endsWith("/metadata")) {
            return Response.json({ metadata: { hash, size: 1, contentType: "text/plain", refs: [] } });
          }
          if (pathname.endsWith("/root-refs") && request.method === "GET") {
            return Response.json({ refDomain: "doc", revision: 1, items: [], nextCursor: null });
          }
          if (pathname.endsWith("/root-refs")) {
            return Response.json({ success: true, idempotent: false, revision: 2 });
          }
          if (pathname.endsWith("/usage")) {
            return Response.json({ nodeCount: 0, readyContentBytes: 0, readyStoredBytes: 0, reservedBytes: 0, notReadyNodeCount: 0, leasedNodeCount: 0 });
          }
          if (pathname.endsWith("/gc")) {
            return Response.json({ examined: 0, deleted: 0, reclaimedContentBytes: 0 });
          }
          return Response.json({ error: "NOT_FOUND" }, { status: 404 });
        },
      },
    });

    await client.readMetadata(hash);
    await client.listRootRefs({ limit: 10, cursor: "next" });
    await client.updateRootRefs({ requestId: "request-1", changes: {} });
    await client.usage();
    await client.gc({ maxNodes: 25 });

    expect(metadataKeys).toEqual([{ version: 1, appId: "app/1", spaceId: "space/1", hash }]);
    expect(requests.map((request) => new URL(request.url).pathname + new URL(request.url).search)).toEqual([
      `/v1/apps/app%2F1/spaces/space%2F1/cas/nodes/${hash}/metadata`,
      "/v1/apps/app%2F1/spaces/space%2F1/root-refs?limit=10&cursor=next",
      "/v1/apps/app%2F1/spaces/space%2F1/root-refs",
      "/v1/apps/app%2F1/spaces/space%2F1/cas/usage",
      "/v1/apps/app%2F1/spaces/space%2F1/cas/gc",
    ]);
    expect(requests.every((request) => request.headers.get("Authorization") === "Bearer space-token")).toBe(true);
    expect(requests.every((request) => !new URL(request.url).pathname.startsWith("/stacks/"))).toBe(true);
  });

});

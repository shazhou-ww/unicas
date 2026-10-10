import { describe, expect, it, vi } from "vitest";
import {
  parseSpaceSelector,
  SpaceCapabilityPermissionKinds,
  type SpaceCapabilityPermissionKind,
} from "@unicas/space-protocol";
import {
  CasCapabilityError,
  CasClientError,
  createAppCasClient,
  type ProvidedSpaceCapability,
  type SpaceCapabilityProvider,
} from "../src/index.js";

const HASH = "a".repeat(64);
const ALL_PERMISSIONS = [...SpaceCapabilityPermissionKinds];

describe("functional App CAS client", () => {
  it("uses one capability across private and shared Spaces with versioned cache keys", async () => {
    const requests: Request[] = [];
    const metadataKeys: unknown[] = [];
    const provider = vi.fn(async () => capability("session-token", [
      { selector: "/users/alice", permissions: ALL_PERMISSIONS },
      { selector: "/shared/**", permissions: ["cas:nodes:read"] },
    ], "documents"));
    const client = createAppCasClient({
      baseUrl: "https://cas.test/",
      appId: "app/1",
      capabilityProvider: { acquire: provider },
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
            return Response.json({
              metadata: { hash: HASH, size: 1, contentType: "text/plain", refs: [] },
            });
          }
          if (pathname.endsWith("/root-refs") && request.method === "GET") {
            return Response.json({
              refDomain: "documents",
              revision: 1,
              items: [],
              nextCursor: null,
            });
          }
          if (pathname.endsWith("/root-refs")) {
            return Response.json({ success: true, idempotent: false, revision: 2 });
          }
          if (pathname.endsWith("/usage")) {
            return Response.json({
              nodeCount: 0,
              readyContentBytes: 0,
              readyStoredBytes: 0,
              reservedBytes: 0,
              notReadyNodeCount: 0,
              leasedNodeCount: 0,
            });
          }
          if (pathname.endsWith("/gc")) {
            return Response.json({ examined: 0, deleted: 0, reclaimedContentBytes: 0 });
          }
          return Response.json({ error: "NOT_FOUND" }, { status: 404 });
        },
      },
    });

    await client.readMetadata("/users/alice", HASH);
    await client.readMetadata("/shared/templates", HASH);
    await client.listRootRefs("/users/alice", { limit: 10, cursor: "next" });
    await client.updateRootRefs("/users/alice", { requestId: "request-1", changes: {} });
    await client.usage("/users/alice");
    await client.gc("/users/alice", { maxNodes: 25 });

    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith({
      appId: "app/1",
      spaceId: "/users/alice",
      permission: "cas:nodes:read",
      reason: "missing",
    });
    expect(metadataKeys).toEqual([
      { version: 1, appId: "app/1", spaceId: "/users/alice", hash: HASH },
      { version: 1, appId: "app/1", spaceId: "/shared/templates", hash: HASH },
    ]);
    expect(requests.map((request) => new URL(request.url).pathname + new URL(request.url).search))
      .toEqual([
        `/v1/cas/nodes/${HASH}/metadata?appId=app%2F1&spaceId=%2Fusers%2Falice`,
        `/v1/cas/nodes/${HASH}/metadata?appId=app%2F1&spaceId=%2Fshared%2Ftemplates`,
        "/v1/cas/root-refs?appId=app%2F1&spaceId=%2Fusers%2Falice&limit=10&cursor=next",
        "/v1/cas/root-refs?appId=app%2F1&spaceId=%2Fusers%2Falice",
        "/v1/cas/usage?appId=app%2F1&spaceId=%2Fusers%2Falice",
        "/v1/cas/gc?appId=app%2F1&spaceId=%2Fusers%2Falice",
      ]);
    expect(requests.every((request) =>
      request.headers.get("Authorization") === ["Bearer", "session-token"].join(" ")
    )).toBe(true);
  });

  it("coalesces concurrent acquisition for one credential class", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = vi.fn(async () => {
      await gate;
      return capability("shared-token", [
        { selector: "/users/alice", permissions: ["cas:nodes:read"] },
        { selector: "/shared/**", permissions: ["cas:nodes:read"] },
      ]);
    });
    const client = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: { acquire: provider },
      fetcher: {
        fetch: async () => Response.json({
          metadata: { hash: HASH, size: 1, contentType: "text/plain", refs: [] },
        }),
      },
    });

    const privateRead = client.readMetadata("/users/alice", HASH);
    const sharedRead = client.readMetadata("/shared/templates", HASH);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    release?.();

    await expect(Promise.all([privateRead, sharedRead])).resolves.toHaveLength(2);
    expect(provider).toHaveBeenCalledOnce();
  });

  it("validates provider metadata and exact requirements before HTTP", async () => {
    const fetcher = { fetch: vi.fn() };
    const wrongScope = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: providerOf(capability("wrong", [
        { selector: "/other", permissions: ["cas:nodes:read"] },
      ])),
      fetcher,
    });
    await expect(wrongScope.readMetadata("/users/alice", HASH))
      .rejects.toMatchObject({
        name: "CasCapabilityError",
        code: "UNSATISFIED_CAPABILITY_REQUIREMENT",
      });

    const expired = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: providerOf({
        ...capability("expired", [
          { selector: "/users/alice", permissions: ["cas:nodes:read"] },
        ]),
        metadata: {
          ...capability("expired", [
            { selector: "/users/alice", permissions: ["cas:nodes:read"] },
          ]).metadata,
          expiresAt: Math.floor(Date.now() / 1000),
        },
      }),
      fetcher,
    });
    await expect(expired.readMetadata("/users/alice", HASH))
      .rejects.toMatchObject({
        name: "CasCapabilityError",
        code: "INVALID_CAPABILITY_METADATA",
      });
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(() => wrongScope.readMetadata("not-a-space", HASH)).toThrow(TypeError);
  });

  it("pins the hidden Root Ref domain for the App client session", async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(capability("root-1", [
        { selector: "/users/alice", permissions: ["cas:root-refs:read"] },
      ], "documents"))
      .mockResolvedValueOnce(capability("root-2", [
        { selector: "/users/alice", permissions: ["cas:root-refs:read"] },
      ], "other"));
    const responses = [
      Response.json({ error: "invalid_token" }, { status: 401 }),
    ];
    const client = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: { acquire: provider },
      fetcher: { fetch: async () => responses.shift()! },
    });

    await expect(client.listRootRefs("/users/alice"))
      .rejects.toMatchObject({
        name: "CasCapabilityError",
        code: "INVALID_CAPABILITY_METADATA",
      });
    expect(provider.mock.calls.map(([request]) => request.reason))
      .toEqual(["missing", "server-rejected"]);
  });

  it("retries one safe invalid-token response but never replays a write", async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(capability("read-1", [
        { selector: "/space-1", permissions: ["cas:nodes:read"] },
      ]))
      .mockResolvedValueOnce(capability("read-2", [
        { selector: "/space-1", permissions: ["cas:nodes:read"] },
      ]))
      .mockResolvedValueOnce(capability("write-1", [
        { selector: "/space-1", permissions: ["cas:nodes:lease"] },
      ]))
      .mockResolvedValueOnce(capability("write-2", [
        { selector: "/space-1", permissions: ["cas:nodes:lease"] },
      ]));
    const responses = [
      Response.json({ error: "invalid_token" }, { status: 401 }),
      Response.json({
        metadata: { hash: HASH, size: 1, contentType: "text/plain", refs: [] },
      }),
      Response.json({ error: "invalid_token" }, { status: 401 }),
      Response.json({
        hash: HASH,
        state: "ready",
        leaseStartedAt: 1,
        leaseExpiresAt: 2,
      }),
    ];
    const client = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: { acquire: provider },
      fetcher: { fetch: async () => responses.shift()! },
    });

    await expect(client.readMetadata("/space-1", HASH)).resolves.toMatchObject({ hash: HASH });
    expect(provider.mock.calls.slice(0, 2).map(([request]) => request.reason))
      .toEqual(["missing", "server-rejected"]);

    await expect(client.leaseNode("/space-1", HASH))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
    expect(provider).toHaveBeenCalledTimes(3);

    await expect(client.leaseNode("/space-1", HASH))
      .resolves.toMatchObject({ state: "ready" });
    expect(provider).toHaveBeenCalledTimes(4);
  });

  it("does not retry 403 and preserves stable HTTP errors", async () => {
    const provider = vi.fn(async () => capability("denied", [
      { selector: "/space-1", permissions: ["cas:nodes:read"] },
    ]));
    const client = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: { acquire: provider },
      fetcher: {
        fetch: async () => Response.json(
          { error: "insufficient_permission", message: "permission changed" },
          { status: 403 },
        ),
      },
    });

    const error = await client.readMetadata("/space-1", HASH).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CasClientError);
    expect(error).toMatchObject({ status: 403, code: "insufficient_permission" });
    expect(provider).toHaveBeenCalledOnce();
  });

  it("preserves ranges, single-request node reads, and lease JSON", async () => {
    const requests: Request[] = [];
    const child = "b".repeat(64);
    const client = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: providerOf(capability("content", [
        {
          selector: "/space-1",
          permissions: ["cas:nodes:read", "cas:nodes:lease"],
        },
      ])),
      fetcher: {
        async fetch(input, init) {
          const request = input instanceof Request ? input : new Request(input, init);
          requests.push(request);
          if (request.method === "POST") {
            return Response.json({
              hash: HASH,
              state: "awaiting_upload",
              upload: {
                method: "PUT",
                url: "https://upload.test",
                expiresAt: 1234,
                headers: {},
              },
            });
          }
          if (request.headers.has("Range")) return new Response("2345", { status: 206 });
          return new Response("node", {
            headers: {
              "Content-Length": "4",
              "Content-Type": "text/plain",
              "X-CAS-Refs": child,
            },
          });
        },
      },
    });

    const empty = await client.readContent("/space-1", HASH, { offset: 0, length: 0 });
    await expect(new Response(empty).arrayBuffer()).resolves.toHaveProperty("byteLength", 0);
    expect(requests).toHaveLength(0);

    const partial = await client.readContent("/space-1", HASH, { offset: 2, length: 4 });
    await expect(new Response(partial).text()).resolves.toBe("2345");
    expect(requests[0].headers.get("Range")).toBe("bytes=2-5");

    const node = await client.readNode("/space-1", HASH);
    expect(node.metadata).toEqual({
      hash: HASH,
      size: 4,
      contentType: "text/plain",
      refs: [child],
    });
    await expect(new Response(node.content).text()).resolves.toBe("node");

    await expect(client.leaseNode("/space-1", HASH)).resolves.toMatchObject({
      state: "awaiting_upload",
    });
    await expect(requests[2].json()).resolves.toEqual({ leaseDurationMs: 900_000 });
  });

  it("preserves provider causes without exposing them as success", async () => {
    const cause = new Error("issuer unavailable");
    const client = createAppCasClient({
      baseUrl: "https://cas.test",
      appId: "app-1",
      capabilityProvider: { acquire: async () => { throw cause; } },
    });

    const error = await client.readMetadata("/space-1", HASH).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CasCapabilityError);
    expect(error).toMatchObject({ code: "PROVIDER_FAILED", cause });
  });
});

function providerOf(capabilityValue: ProvidedSpaceCapability): SpaceCapabilityProvider {
  return { acquire: async () => capabilityValue };
}

function capability(
  bearerToken: string,
  grants: readonly {
    readonly selector: string;
    readonly permissions: readonly SpaceCapabilityPermissionKind[];
  }[],
  refDomain?: string,
): ProvidedSpaceCapability {
  return {
    bearerToken,
    metadata: {
      version: 2,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      grants: grants.map((grant) => {
        const selector = parseSpaceSelector(grant.selector);
        if (!selector) throw new TypeError(`Invalid fixture selector: ${grant.selector}`);
        return {
          selector: selector.selector,
          permissions: grant.permissions,
        };
      }),
      ...(refDomain === undefined ? {} : { refDomain }),
    },
  };
}

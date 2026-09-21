import { describe, expect, test, vi } from "vitest";
import { CapabilityAuthorizationError } from "@unicas/space-protocol";
import {
  createUniCasService,
  matchUniCasServiceRoute,
  type ServiceContext,
  type ServicePlatform,
} from "../src/index.js";

const spaceActorFetch = vi.fn(async () => new Response("space"));
const platform = {
  spaceActors: { fetch: spaceActorFetch },
} as unknown as ServicePlatform;

describe("createUniCasService", () => {
  test("dispatches frozen v1 Stack/Tenant requests and rejects legacy administrator routes", async () => {
    const authorizeV1StackTenantRequest = vi.fn(async () => ({
      stackId: "s1",
      tenantId: "t1",
      subject: "caller",
      jti: "request-1",
      kid: "key-1",
      permissions: ["cas:manage:t1"],
    }));
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest,
    });

    expect(await (await actor.fetch(new Request(
      "https://cas.example/stacks/s1/tenants/t1/cas/usage",
    ))).text()).toBe("space");
    expect(authorizeV1StackTenantRequest).toHaveBeenCalledWith(expect.objectContaining({
      platform,
      route: { operation: "usage", stackId: "s1", tenantId: "t1" },
    }));
    expect(spaceActorFetch).toHaveBeenCalledWith(
      "s1|t1",
      expect.objectContaining({ url: "https://space.internal/usage" }),
    );

    expect((await actor.fetch(new Request("https://cas.example/admin/stacks/s1"))).status).toBe(404);
  });

  test("does not claim BFF, MCP, static asset, or unknown routes", async () => {
    const context = {
      platform,
      authorizeV1StackTenantRequest: vi.fn(),
    } as unknown as ServiceContext;
    const actor = createUniCasService(context);

    for (const path of [
      "/admin/auth/login",
      "/admin/assets/app.js",
      "/mcp",
      "/oauth/token",
      "/health",
    ]) {
      const request = new Request(`https://cas.example${path}`);
      expect(matchUniCasServiceRoute(request), path).toBeNull();
      expect((await actor.fetch(request)).status, path).toBe(404);
    }
    expect(context.authorizeV1StackTenantRequest).not.toHaveBeenCalled();
  });

  test("builds trusted Root Ref actor requests from the authorized call", async () => {
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest: async () => ({
        stackId: "stack/a",
        tenantId: "tenant/b",
        subject: "caller",
        jti: "request-2",
        kid: "key-1",
        permissions: ["cas:write:tenant/b"],
        refDomain: "doc",
      }),
    });
    const response = await actor.fetch(new Request(
      "https://cas.example/stacks/stack%2Fa/tenants/tenant%2Fb/root-refs",
      {
        method: "POST",
        headers: {
          "X-CAS-Stack-Id": "attacker",
          "X-CAS-Tenant-Id": "attacker",
          "X-CAS-Ref-Domain": "attacker",
        },
        body: JSON.stringify({ requestId: "r1", changes: { abc: 1 } }),
      },
    ));
    expect(await response.text()).toBe("space");
    const [key, forwarded] = spaceActorFetch.mock.calls.at(-1)!;
    expect(key).toBe("stack%2Fa|tenant%2Fb");
    expect(forwarded.headers.get("X-CAS-Stack-Id")).toBe("stack/a");
    expect(forwarded.headers.get("X-CAS-Tenant-Id")).toBe("tenant/b");
    expect(forwarded.headers.get("X-CAS-Ref-Domain")).toBe("doc");

    await actor.fetch(new Request(
      "https://cas.example/stacks/stack%2Fa/tenants/tenant%2Fb/root-refs?limit=10&cursor=abc",
      { headers: { "X-CAS-Ref-Domain": "attacker" } },
    ));
    const [readKey, readForwarded] = spaceActorFetch.mock.calls.at(-1)!;
    expect(readKey).toBe("stack%2Fa|tenant%2Fb");
    expect(readForwarded.url).toBe("https://space.internal/rootRefs?limit=10&cursor=abc");
    expect(readForwarded.method).toBe("GET");
    expect(readForwarded.headers.get("X-CAS-Ref-Domain")).toBe("doc");
  });

  test("classifies App and Space routes separately from v1", () => {
    expect(matchUniCasServiceRoute(new Request(
      "https://api.unicas.work/v2/apps/app-1/spaces/space-1/cas/usage",
    ))).toEqual({
      plane: "space",
      route: { operation: "usage", appId: "app-1", spaceId: "space-1" },
    });
    expect(matchUniCasServiceRoute(new Request(
      "https://console.unicas.work/admin/apps/app-1",
    ))).toEqual({
      plane: "app-admin",
      route: { operation: "getApp", appId: "app-1" },
    });
    expect(matchUniCasServiceRoute(new Request(
      "https://console.unicas.work/admin/apps/app-1/usage",
    ))).toEqual({
      plane: "app-admin",
      route: { operation: "getUsage", appId: "app-1" },
    });
  });

  test("routes shared administrator paths through the App contract", () => {
    expect(matchUniCasServiceRoute(new Request(
      "https://console.unicas.work/admin/me",
    ))).toEqual({
      plane: "app-admin",
      route: { operation: "me" },
    });
    expect(matchUniCasServiceRoute(new Request(
      "https://console.unicas.work/admin/member-invitations/invite-1/accept",
      { method: "POST" },
    ))).toEqual({
      plane: "app-admin",
      route: { operation: "acceptMemberInvitation", token: "invite-1" },
    });
    expect(matchUniCasServiceRoute(new Request(
      "https://console.unicas.work/admin/stacks/cas-1",
    ))).toBeNull();
  });

  test("returns not implemented until v2 platform handlers are configured", async () => {
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest: vi.fn(),
    });
    expect((await actor.fetch(new Request(
      "https://api.unicas.work/v2/apps/app-1/spaces/space-1/cas/usage",
    ))).status).toBe(501);
    expect((await actor.fetch(new Request(
      "https://console.unicas.work/admin/apps/app-1",
    ))).status).toBe(501);
  });

  test("dispatches Space requests from the authorized App and Space scope", async () => {
    const authorizeSpaceRequest = vi.fn(async () => ({
      appId: "app/a",
      spaceId: "space/b",
      subject: "caller",
      jti: "request-v2",
      kid: "key-v2",
      permissions: ["cas:usage:read"],
    }));
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest: vi.fn(),
      authorizeSpaceRequest,
      handleAppAdminRequest: vi.fn(),
    });
    const response = await actor.fetch(new Request(
      "https://api.unicas.work/v2/apps/app%2Fa/spaces/space%2Fb/cas/usage",
      { headers: { "X-CAS-App-Id": "attacker", "X-CAS-Space-Id": "attacker" } },
    ));
    expect(await response.text()).toBe("space");
    expect(authorizeSpaceRequest).toHaveBeenCalledWith(expect.objectContaining({
      route: { operation: "usage", appId: "app/a", spaceId: "space/b" },
    }));
    const [key, forwarded] = spaceActorFetch.mock.calls.at(-1)!;
    expect(key).toBe("app%2Fa|space%2Fb");
    expect(forwarded.headers.get("X-CAS-App-Id")).toBe("app/a");
    expect(forwarded.headers.get("X-CAS-Space-Id")).toBe("space/b");
    expect(forwarded.headers.get("X-CAS-Stack-Id")).toBeNull();
    expect(forwarded.headers.get("X-CAS-Tenant-Id")).toBeNull();
  });

  test("forwards v2 lease JSON and rejects legacy upload headers", async () => {
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest: vi.fn(),
      authorizeSpaceRequest: async () => ({
        appId: "app-1",
        spaceId: "space-1",
        subject: "caller",
        jti: "request-v2-lease",
        kid: "key-v2",
        permissions: ["cas:nodes:lease"],
      }),
      handleAppAdminRequest: vi.fn(),
    });
    const url = `https://api.unicas.work/v2/apps/app-1/spaces/space-1/cas/nodes/${"a".repeat(64)}/lease`;
    await actor.fetch(new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseDurationMs: 60_000 }),
    }));
    const [, forwarded] = spaceActorFetch.mock.calls.at(-1)!;
    expect(forwarded.headers.get("X-CAS-Api-Version")).toBe("2");
    expect(forwarded.headers.get("Content-Type")).toBe("application/json");
    await expect(forwarded.json()).resolves.toEqual({ leaseDurationMs: 60_000 });

    const callsBeforeRejection = spaceActorFetch.mock.calls.length;
    const rejected = await actor.fetch(new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAS-Upload-Id": "legacy",
      },
      body: JSON.stringify({ leaseDurationMs: 60_000 }),
    }));
    expect(rejected.status).toBe(400);
    expect(spaceActorFetch).toHaveBeenCalledTimes(callsBeforeRejection);
  });

  test("returns stable Space authorization codes without changing the v1 envelope", async () => {
    const denial = new CapabilityAuthorizationError(
      "insufficient_permission",
      "CAS usage requires cas:usage:read",
    );
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest: async () => { throw denial; },
      authorizeSpaceRequest: async () => { throw denial; },
    });

    const spaceResponse = await actor.fetch(new Request(
      "https://api.unicas.work/v2/apps/app-1/spaces/space-1/cas/usage",
    ));
    expect(spaceResponse.status).toBe(403);
    await expect(spaceResponse.json()).resolves.toEqual({
      error: "insufficient_permission",
      message: "CAS usage requires cas:usage:read",
    });

    const v1Response = await actor.fetch(new Request(
      "https://cas.example/stacks/stack-1/tenants/tenant-1/cas/usage",
    ));
    expect(v1Response.status).toBe(403);
    await expect(v1Response.json()).resolves.toEqual({
      error: "CAS usage requires cas:usage:read",
    });
  });

  test("dispatches App administrator requests through the v2 handler", async () => {
    const handleAppAdminRequest = vi.fn(async () => new Response("app-admin"));
    const actor = createUniCasService({
      platform,
      authorizeV1StackTenantRequest: vi.fn(),
      authorizeSpaceRequest: vi.fn(),
      handleAppAdminRequest,
    });
    expect(await (await actor.fetch(new Request(
      "https://console.unicas.work/admin/apps/app-1",
    ))).text()).toBe("app-admin");
    expect(handleAppAdminRequest).toHaveBeenCalledWith(expect.objectContaining({
      route: { operation: "getApp", appId: "app-1" },
      platform,
    }));
  });
});
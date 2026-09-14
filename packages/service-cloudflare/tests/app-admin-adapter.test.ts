import { describe, expect, test, vi } from "vitest";
import type { AppAdminRoute } from "@unicas/admin-protocol";
import { handleAppAdminCompatibilityRequest } from "../src/app-admin-adapter.js";

function request(path: string): Request {
  return new Request(`https://console.unicas.work${path}`, {
    headers: { Cookie: "cas_admin_session=secret" },
  });
}

async function invoke(
  route: AppAdminRoute,
  path: string,
  legacyBody: unknown,
): Promise<{ response: Response; legacyHandler: ReturnType<typeof vi.fn> }> {
  const legacyHandler = vi.fn(async () => Response.json(legacyBody, {
    headers: { ETag: '"3"', "Cache-Control": "no-store" },
  }));
  const response = await handleAppAdminCompatibilityRequest(request(path), route, legacyHandler);
  return { response, legacyHandler };
}

describe("App admin physical compatibility adapter", () => {
  test("rewrites App list requests and responses explicitly", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "listApps" },
      "/admin/apps?limit=10",
      {
        items: [{ stackId: "app-1", displayName: "App 1", description: "", status: "active", createdAt: 1, revision: 3 }],
        nextCursor: null,
      },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/stacks?limit=10",
    }));
    await expect(response.json()).resolves.toEqual({
      items: [{ appId: "app-1", displayName: "App 1", description: "", status: "active", createdAt: 1, revision: 3 }],
      nextCursor: null,
    });
    expect(response.headers.get("ETag")).toBe('"3"');
  });

  test("separates Principal and Profile in App memberships", async () => {
    const { response } = await invoke(
      { operation: "listMembers", appId: "app-1" },
      "/admin/apps/app-1/members",
      {
        items: [{
          stackId: "app-1",
          identityIssuer: "https://accounts.example",
          subject: "subject-1",
          displayName: "Operator",
          emailForDisplay: "operator@example.com",
        }],
        nextCursor: null,
      },
    );
    await expect(response.json()).resolves.toEqual({
      items: [{
        appId: "app-1",
        principal: { issuer: "https://accounts.example", subject: "subject-1" },
        profile: { displayName: "Operator", emailForDisplay: "operator@example.com" },
      }],
      nextCursor: null,
    });
  });

  test("maps Space audit filters and response fields", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "listRootDomainRefs", appId: "app-1", refDomain: "doc" },
      "/admin/apps/app-1/root-ref-domains/doc/refs?spaceId=space-1",
      { revision: 2, refs: [{ tenantId: "space-1", hash: "a".repeat(64), count: 1 }], nextCursor: null },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/stacks/app-1/root-ref-domains/doc/refs?tenantId=space-1",
    }));
    await expect(response.json()).resolves.toMatchObject({
      refs: [{ spaceId: "space-1", count: 1 }],
    });
  });

  test("does not mint a v1 capability through the v2 endpoint", async () => {
    const legacyHandler = vi.fn();
    const response = await handleAppAdminCompatibilityRequest(
      request("/admin/apps/app-1/managed-capabilities"),
      { operation: "mintManagedCapability", appId: "app-1" },
      legacyHandler,
    );
    expect(response.status).toBe(501);
    expect(legacyHandler).not.toHaveBeenCalled();
  });
});

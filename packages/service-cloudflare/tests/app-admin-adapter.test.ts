import { describe, expect, test, vi } from "vitest";
import type { AppAdminRoute } from "@unicas/admin-protocol";
import { handleAppAdminCompatibilityRequest } from "../src/app-admin-adapter.js";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://console.unicas.work${path}`, {
    ...init,
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
  test("forwards Platform Admin responses without consuming or rewriting them", async () => {
    const upstream = Response.json({ items: [{ principalRef: "principal-1" }], nextCursor: null }, {
      headers: { ETag: '"7"', "Cache-Control": "no-store" },
    });
    const handler = vi.fn(async () => upstream);
    const response = await handleAppAdminCompatibilityRequest(
      request("/admin/platform/principals"),
      { operation: "listPlatformPrincipals" },
      handler,
    );

    expect(response).toBe(upstream);
    expect(response.headers.get("ETag")).toBe('"7"');
    await expect(response.json()).resolves.toEqual({
      items: [{ principalRef: "principal-1" }],
      nextCursor: null,
    });
  });

  test("forwards App mutations without legacy rewriting and preserves no-content responses", async () => {
    const handler = vi.fn(async () => new Response(null, {
      status: 204,
      headers: { ETag: '"4"', "Cache-Control": "no-store" },
    }));
    const response = await handleAppAdminCompatibilityRequest(
      request("/admin/apps/app-1", { method: "PATCH", body: JSON.stringify({ status: "suspended" }) }),
      { operation: "patchApp", appId: "app-1" },
      handler,
    );
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ url: "https://console.unicas.work/admin/apps/app-1" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("ETag")).toBe('"4"');
    expect(await response.text()).toBe("");
  });

  test.each([
    ["getManagedIssuer", "GET"],
    ["patchManagedIssuer", "PATCH"],
  ] as const)("forwards %s through the Account-native App path", async (operation, method) => {
    const handler = vi.fn(async () => Response.json({ appId: "app-1", mode: "managed" }));
    await handleAppAdminCompatibilityRequest(
      request("/admin/apps/app-1/managed-issuer", { method }),
      { operation, appId: "app-1" },
      handler,
    );
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/apps/app-1/managed-issuer",
    }));
  });

  test("forwards the Account-only current-administrator response unchanged", async () => {
    const account = {
      accountId: `acct_${"a".repeat(22)}`,
      displayName: "Alice",
      primaryVerifiedEmail: null,
      avatar: { kind: "fallback", initials: "AL", colorIndex: 1 },
      blockedAt: null,
      platformAuthorities: ["platform.admin"],
      identities: [{ externalIdentityId: "ext-alice", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 2, currentLogin: true }],
      linkableProviders: ["github"],
    };
    const accountMemberships = [{
      appId: "app-1", account: {
        accountId: account.accountId,
        displayName: account.displayName,
        primaryVerifiedEmail: account.primaryVerifiedEmail,
        avatar: account.avatar,
      }
    }];
    const { response, legacyHandler } = await invoke(
      { operation: "me" },
      "/admin/me",
      {
        account,
        authenticatedIdentity: account.identities[0],
        memberships: accountMemberships,
      },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/me",
    }));
    await expect(response.json()).resolves.toEqual({
      account,
      authenticatedIdentity: account.identities[0],
      memberships: accountMemberships,
    });
  });

  test("maps shared invitation acceptance to only the target App identifier", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "acceptMemberInvitation", token: "invite-1" },
      "/admin/member-invitations/invite-1/accept",
      {
        stackId: "app-1",
        identityIssuer: "https://accounts.example",
        subject: "alice",
        displayName: "Alice",
        emailForDisplay: "alice@example.com",
      },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/member-invitations/invite-1/accept",
    }));
    await expect(response.json()).resolves.toEqual({ appId: "app-1" });
  });

  test("forwards Account-keyed App creation without legacy rewriting", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "createApp" },
      "/admin/apps",
      {
        appId: "app-1",
      },
    );

    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/apps",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"3"');
    await expect(response.json()).resolves.toEqual({ appId: "app-1" });
  });

  test("forwards Account-keyed App detail without legacy rewriting", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "getApp", appId: "app-1" },
      "/admin/apps/app-1",
      { error: "APP_MEMBERSHIP_REQUIRED", message: "App membership required" },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/apps/app-1",
    }));
    await expect(response.json()).resolves.toEqual({
      error: "APP_MEMBERSHIP_REQUIRED",
      message: "App membership required",
    });
  });

  test("forwards Account-keyed App list requests without legacy rewriting", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "listApps" },
      "/admin/apps?limit=10",
      {
        items: [{ appId: "app-1", displayName: "App 1", description: "", status: "active", createdAt: 1, revision: 3 }],
        nextCursor: null,
      },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/apps?limit=10",
    }));
    await expect(response.json()).resolves.toEqual({
      items: [{ appId: "app-1", displayName: "App 1", description: "", status: "active", createdAt: 1, revision: 3 }],
      nextCursor: null,
    });
    expect(response.headers.get("ETag")).toBe('"3"');
  });

  test("forwards Account-keyed App memberships without legacy rewriting", async () => {
    const body = {
      items: [{
        appId: "app-1",
        account: {
          accountId: `acct_${"a".repeat(22)}`,
          displayName: "Operator",
          primaryVerifiedEmail: null,
          avatar: { kind: "fallback", initials: "OP", colorIndex: 1 },
        },
      }],
      nextCursor: null,
    };
    const { response, legacyHandler } = await invoke(
      { operation: "listMembers", appId: "app-1" },
      "/admin/apps/app-1/members",
      body,
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/apps/app-1/members",
    }));
    await expect(response.json()).resolves.toEqual(body);
  });

  test("forwards Account-authorized Space audit reads without legacy rewriting", async () => {
    const { response, legacyHandler } = await invoke(
      { operation: "listRootDomainRefs", appId: "app-1", refDomain: "doc" },
      "/admin/apps/app-1/root-ref-domains/doc/refs?spaceId=space-1",
      { revision: 2, refs: [{ spaceId: "space-1", hash: "a".repeat(64), count: 1 }], nextCursor: null },
    );
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://console.unicas.work/admin/apps/app-1/root-ref-domains/doc/refs?spaceId=space-1",
    }));
    await expect(response.json()).resolves.toMatchObject({
      refs: [{ spaceId: "space-1", count: 1 }],
    });
  });

  test("forwards managed Space issuance to the dedicated v2 BFF path", async () => {
    const legacyHandler = vi.fn(async () => Response.json({
      accessToken: "space-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      expiresAt: 3_600_000,
      issuer: "https://api.unicas.work/managed-issuers/app-1",
      audience: "https://api.unicas.work/stacks/app-1",
      spaceId: "member-1",
      permissions: ["spaces:member-1:cas:manage"],
    }, { status: 201, headers: { "Cache-Control": "no-store" } }));
    const response = await handleAppAdminCompatibilityRequest(
      request("/admin/apps/app-1/managed-capabilities", { method: "POST" }),
      { operation: "mintManagedCapability", appId: "app-1" },
      legacyHandler,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(legacyHandler).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      url: "https://console.unicas.work/admin/apps/app-1/managed-capabilities",
    }));
    await expect(response.json()).resolves.toMatchObject({
      spaceId: "member-1",
      permissions: ["spaces:member-1:cas:manage"],
    });
  });
});

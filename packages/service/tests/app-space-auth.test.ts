import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { CryptoKey } from "jose";
import { describe, expect, test } from "vitest";
import {
  SpaceCapabilityVersion,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
  type AppSpaceRoute,
} from "@unicas/space-protocol";
import {
  AppSpaceCapabilityVerifier,
  appSpacePermissionFor,
  type AppAuthorityResolver,
  type ResolvedAppAuthority,
} from "../src/index.js";

const ISSUER = "https://issuer.example";
const AUDIENCE = "unicas-cas";
const APP = "cas_app_a";
const SPACE = "space-1";
const APP_ROUTE = {
  operation: "readContent" as const,
  appId: APP,
  spaceId: SPACE,
  hash: "a".repeat(64),
};
class StubAppAuthorityResolver implements AppAuthorityResolver {
  constructor(readonly authority: ResolvedAppAuthority) { }

  async resolveIssuer(issuer: string): Promise<ResolvedAppAuthority | null> {
    return issuer === ISSUER ? this.authority : null;
  }
}

async function fixture(): Promise<{
  now: number;
  privateKey: CryptoKey;
  appResolver: StubAppAuthorityResolver;
}> {
  const now = 1_700_000_000_000;
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const jwksUri = `data:application/json,${encodeURIComponent(JSON.stringify({
    keys: [{ ...publicJwk, kid: "key-1", alg: "ES256", use: "sig" }],
  }))}`;
  return {
    now,
    privateKey,
    appResolver: new StubAppAuthorityResolver({
      appId: APP,
      appStatus: "active",
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri,
      capabilityMaxLifetimeSeconds: 28_800,
    }),
  };
}

async function issue(
  privateKey: CryptoKey,
  now: number,
  claims: Record<string, unknown>,
  options: { readonly issuedAt?: number; readonly lifetimeSeconds?: number } = {},
): Promise<string> {
  const nowSeconds = Math.floor((options.issuedAt ?? now) / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("service-principal")
    .setJti("request-1")
    .setIssuedAt(nowSeconds)
    .setNotBefore(nowSeconds)
    .setExpirationTime(nowSeconds + (options.lifetimeSeconds ?? 300))
    .sign(privateKey);
}

function request(token: string): Request {
  return new Request("https://api.unicas.work/v1", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("AppSpaceCapabilityVerifier", () => {
  test("denies every Space operation for a suspended App", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const events: Array<{ kind: string; reason?: string }> = [];
    const verifier = new AppSpaceCapabilityVerifier({
      repository: new StubAppAuthorityResolver({ ...appResolver.authority, appStatus: "suspended" }),
      now: () => now,
      onEvent: (event) => events.push(event),
    });
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [
        spaceNodeReadPermission(),
        spaceNodeLeasePermission(),
        spaceRootRefsReadPermission(),
        spaceRootRefsUpdatePermission(),
        spaceUsageReadPermission(),
        spaceGcExecutePermission(),
      ],
      refDomain: "doc",
    });
    const routes: AppSpaceRoute[] = [
      APP_ROUTE,
      { ...APP_ROUTE, operation: "readMetadata" },
      { ...APP_ROUTE, operation: "lease" },
      { operation: "listRootRefs", appId: APP, spaceId: SPACE },
      { operation: "updateRootRefs", appId: APP, spaceId: SPACE },
      { operation: "usage", appId: APP, spaceId: SPACE },
      { operation: "gc", appId: APP, spaceId: SPACE },
    ];
    for (const route of routes) {
      await expect(verifier.verify(request(token), route)).rejects.toMatchObject({ status: 403, code: "APP_SUSPENDED" });
    }
    expect(events).toHaveLength(routes.length);
    expect(events.every((event) => event.kind === "rejected" && event.reason === "App is suspended")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  test("suspends and restores previously issued capabilities after authority refresh", async () => {
    const { now, privateKey, appResolver } = await fixture();
    let currentTime = now;
    let authority = appResolver.authority;
    const verifier = new AppSpaceCapabilityVerifier({
      repository: { resolveIssuer: async () => authority },
      now: () => currentTime,
    });
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [spaceNodeReadPermission()],
    });
    await expect(verifier.verify(request(token), APP_ROUTE)).resolves.toBeDefined();
    authority = { ...authority, appStatus: "suspended" };
    currentTime = now + 30_000;
    await expect(verifier.verify(request(token), APP_ROUTE)).rejects.toMatchObject({ code: "APP_SUSPENDED" });
    authority = { ...authority, appStatus: "active" };
    currentTime = now + 60_000;
    await expect(verifier.verify(request(token), APP_ROUTE)).resolves.toBeDefined();
  });

  test("replaced issuer authority cannot survive cache refresh or the hard stale bound", async () => {
    const { now, privateKey, appResolver } = await fixture();
    let currentTime = now;
    let replaced = false;
    let unavailable = false;
    const repository = {
      resolveIssuer: async () => {
        if (unavailable) throw new Error("Registry unavailable");
        return replaced ? null : appResolver.authority;
      }
    };
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [spaceNodeReadPermission()],
    });
    const refreshed = new AppSpaceCapabilityVerifier({ repository, now: () => currentTime });
    const stale = new AppSpaceCapabilityVerifier({ repository, now: () => currentTime });
    await refreshed.verify(request(token), APP_ROUTE);
    await stale.verify(request(token), APP_ROUTE);
    replaced = true;
    currentTime = now + 30_000;
    await expect(refreshed.verify(request(token), APP_ROUTE)).rejects.toMatchObject({ code: "unknown_issuer" });
    unavailable = true;
    currentTime = now + 59_999;
    await expect(stale.verify(request(token), APP_ROUTE)).resolves.toBeDefined();
    currentTime = now + 60_000;
    await expect(stale.verify(request(token), APP_ROUTE)).rejects.toMatchObject({ code: "registry_unavailable" });
  });

  test("registry failure cannot preserve pre-suspension authority beyond 60 seconds", async () => {
    const { now, privateKey, appResolver } = await fixture();
    let currentTime = now;
    let unavailable = false;
    let authority = appResolver.authority;
    const verifier = new AppSpaceCapabilityVerifier({
      repository: {
        resolveIssuer: async () => {
          if (unavailable) throw new Error("Registry unavailable");
          return authority;
        }
      },
      now: () => currentTime,
    });
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [spaceNodeReadPermission()],
    });
    await expect(verifier.verify(request(token), APP_ROUTE)).resolves.toBeDefined();
    authority = { ...authority, appStatus: "suspended" };
    unavailable = true;
    currentTime = now + 59_999;
    await expect(verifier.verify(request(token), APP_ROUTE)).resolves.toBeDefined();
    currentTime = now + 60_000;
    await expect(verifier.verify(request(token), APP_ROUTE)).rejects.toMatchObject({ code: "registry_unavailable" });
    unavailable = false;
    await expect(verifier.verify(request(token), APP_ROUTE)).rejects.toMatchObject({ code: "APP_SUSPENDED" });
  });

  test("verifies issuer-derived App, Space scope, and exact operation permission", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({
      repository: appResolver,
      now: () => now,
    });
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [spaceNodeReadPermission()],
    });

    await expect(verifier.verify(request(token), APP_ROUTE)).resolves.toMatchObject({
      appId: APP,
      spaceId: SPACE,
      subject: "service-principal",
      kid: "key-1",
    });
    await expect(verifier.verify(request(token), { ...APP_ROUTE, appId: "other-app" }))
      .rejects.toMatchObject({ status: 403, code: "resource_scope_mismatch" });
    await expect(verifier.verify(request(token), { ...APP_ROUTE, spaceId: "other-space" }))
      .rejects.toMatchObject({ status: 403, code: "resource_scope_mismatch" });
    await expect(verifier.verify(request(token), {
      operation: "gc",
      appId: APP,
      spaceId: SPACE,
    })).rejects.toMatchObject({ status: 403, code: "insufficient_permission" });
  });

  test("enforces the exact Space permission for every operation", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const hash = "b".repeat(64);
    const cases: Array<{
      route: AppSpaceRoute;
      permission: string;
      refDomain?: string;
    }> = [
        { route: { operation: "readContent", appId: APP, spaceId: SPACE, hash }, permission: spaceNodeReadPermission() },
        { route: { operation: "readMetadata", appId: APP, spaceId: SPACE, hash }, permission: spaceNodeReadPermission() },
        { route: { operation: "lease", appId: APP, spaceId: SPACE, hash }, permission: spaceNodeLeasePermission() },
        { route: { operation: "listRootRefs", appId: APP, spaceId: SPACE }, permission: spaceRootRefsReadPermission(), refDomain: "doc" },
        { route: { operation: "updateRootRefs", appId: APP, spaceId: SPACE }, permission: spaceRootRefsUpdatePermission(), refDomain: "doc" },
        { route: { operation: "usage", appId: APP, spaceId: SPACE }, permission: spaceUsageReadPermission() },
        { route: { operation: "gc", appId: APP, spaceId: SPACE }, permission: spaceGcExecutePermission() },
      ];

    for (const entry of cases) {
      const token = await issue(privateKey, now, {
        ver: SpaceCapabilityVersion,
        spaceId: SPACE,
        permissions: [entry.permission],
        ...(entry.refDomain === undefined ? {} : { refDomain: entry.refDomain }),
      });
      await expect(verifier.verify(request(token), entry.route)).resolves.toBeDefined();
      expect(appSpacePermissionFor(entry.route)).toBe(entry.permission);
    }
  });

  test("does not infer permissions between independent Space operations", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const hash = "c".repeat(64);
    const cases: Array<{
      permission: string;
      allowed: AppSpaceRoute;
      denied: AppSpaceRoute;
      refDomain?: string;
    }> = [
        {
          permission: spaceNodeLeasePermission(),
          allowed: { operation: "lease", appId: APP, spaceId: SPACE, hash },
          denied: { operation: "updateRootRefs", appId: APP, spaceId: SPACE },
          refDomain: "doc",
        },
        {
          permission: spaceRootRefsUpdatePermission(),
          allowed: { operation: "updateRootRefs", appId: APP, spaceId: SPACE },
          denied: { operation: "lease", appId: APP, spaceId: SPACE, hash },
          refDomain: "doc",
        },
        {
          permission: spaceRootRefsReadPermission(),
          allowed: { operation: "listRootRefs", appId: APP, spaceId: SPACE },
          denied: { operation: "readContent", appId: APP, spaceId: SPACE, hash },
          refDomain: "doc",
        },
        {
          permission: spaceNodeReadPermission(),
          allowed: { operation: "readContent", appId: APP, spaceId: SPACE, hash },
          denied: { operation: "listRootRefs", appId: APP, spaceId: SPACE },
          refDomain: "doc",
        },
        {
          permission: spaceUsageReadPermission(),
          allowed: { operation: "usage", appId: APP, spaceId: SPACE },
          denied: { operation: "gc", appId: APP, spaceId: SPACE },
        },
        {
          permission: spaceGcExecutePermission(),
          allowed: { operation: "gc", appId: APP, spaceId: SPACE },
          denied: { operation: "usage", appId: APP, spaceId: SPACE },
        },
        {
          permission: spaceGcExecutePermission(),
          allowed: { operation: "gc", appId: APP, spaceId: SPACE },
          denied: { operation: "readContent", appId: APP, spaceId: SPACE, hash },
        },
      ];

    for (const entry of cases) {
      const token = await issue(privateKey, now, {
        ver: SpaceCapabilityVersion,
        spaceId: SPACE,
        permissions: [entry.permission],
        ...(entry.refDomain === undefined ? {} : { refDomain: entry.refDomain }),
      });
      await expect(verifier.verify(request(token), entry.allowed)).resolves.toBeDefined();
      await expect(verifier.verify(request(token), entry.denied))
        .rejects.toMatchObject({ status: 403, code: "insufficient_permission" });
    }
  });

  test("requires a valid non-reserved refDomain for both Root Ref permissions", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const cases = [
      {
        permission: spaceRootRefsReadPermission(),
        route: { operation: "listRootRefs", appId: APP, spaceId: SPACE } as const,
      },
      {
        permission: spaceRootRefsUpdatePermission(),
        route: { operation: "updateRootRefs", appId: APP, spaceId: SPACE } as const,
      },
    ];

    for (const entry of cases) {
      for (const refDomain of [undefined, "Bad Domain", "_reserved"]) {
        const token = await issue(privateKey, now, {
          ver: SpaceCapabilityVersion,
          spaceId: SPACE,
          permissions: [entry.permission],
          ...(refDomain === undefined ? {} : { refDomain }),
        });
        await expect(verifier.verify(request(token), entry.route))
          .rejects.toMatchObject({ status: 403, code: "resource_scope_mismatch" });
      }
    }
  });

  test.each([2, 3])("rejects prototype Space capability version %s", async (version) => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const token = await issue(privateKey, now, {
      ver: version,
      spaceId: SPACE,
      permissions: [spaceNodeReadPermission()],
    });
    await expect(verifier.verify(request(token), APP_ROUTE))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  test("rejects broad prototype permissions on released Space capabilities", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [`spaces:${SPACE}:cas:read`],
    });
    await expect(verifier.verify(request(token), APP_ROUTE))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  test("rejects the retired Tenant claim shape", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const appVerifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const tenantToken = await issue(privateKey, now, {
      ver: 1,
      tenantId: "tenant-1",
      permissions: ["tenants:tenant-1:cas:read"],
    });

    await expect(appVerifier.verify(request(tenantToken), APP_ROUTE))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  test("rejects the frozen Stack/Tenant permission grammar on a Space capability", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const token = await issue(privateKey, now, {
      ver: SpaceCapabilityVersion,
      spaceId: SPACE,
      permissions: [`tenants:${SPACE}:cas:read`],
    });
    await expect(verifier.verify(request(token), APP_ROUTE))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });
});
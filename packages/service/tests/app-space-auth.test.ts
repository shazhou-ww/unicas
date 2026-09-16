import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { CryptoKey } from "jose";
import { describe, expect, test } from "vitest";
import {
  casReadPermission,
  spaceCasManagePermission,
  spaceCasReadPermission,
  spaceCasWritePermission,
  type AppSpaceRoute,
} from "@unicas/tenant-protocol";
import {
  AppSpaceCapabilityVerifier,
  StackCapabilityVerifier,
  appSpacePermissionFor,
  type AppAuthorityResolver,
  type ResolvedAppAuthority,
  type ResolvedStackAuthority,
  type StackAuthorityResolver,
} from "../src/index.js";

const ISSUER = "https://issuer.example";
const AUDIENCE = "unicas-cas";
const APP = "cas_app_a";
const SPACE = "space-1";
const STACK = "cas_stack_a";
const TENANT = "tenant-1";
const APP_ROUTE = {
  operation: "readContent" as const,
  appId: APP,
  spaceId: SPACE,
  hash: "a".repeat(64),
};
const STACK_ROUTE = {
  operation: "readContent" as const,
  stackId: STACK,
  tenantId: TENANT,
  hash: "a".repeat(64),
};

class StubAppAuthorityResolver implements AppAuthorityResolver {
  constructor(readonly authority: ResolvedAppAuthority) {}

  async resolveIssuer(issuer: string): Promise<ResolvedAppAuthority | null> {
    return issuer === ISSUER ? this.authority : null;
  }
}

class StubStackAuthorityResolver implements StackAuthorityResolver {
  constructor(readonly authority: ResolvedStackAuthority) {}

  async resolveIssuer(issuer: string): Promise<ResolvedStackAuthority | null> {
    return issuer === ISSUER ? this.authority : null;
  }
}

async function fixture(): Promise<{
  now: number;
  privateKey: CryptoKey;
  appResolver: StubAppAuthorityResolver;
  stackResolver: StubStackAuthorityResolver;
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
    stackResolver: new StubStackAuthorityResolver({
      stackId: STACK,
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
): Promise<string> {
  const nowSeconds = Math.floor(now / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("service-principal")
    .setJti("request-1")
    .setIssuedAt(nowSeconds)
    .setNotBefore(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .sign(privateKey);
}

function request(token: string): Request {
  return new Request("https://api.unicas.work/v2", {
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
      ver: 2,
      spaceId: SPACE,
      permissions: [spaceCasReadPermission(SPACE), spaceCasWritePermission(SPACE), spaceCasManagePermission(SPACE)],
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
    const token = await issue(privateKey, now, { ver: 2, spaceId: SPACE, permissions: [spaceCasReadPermission(SPACE)] });
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
    const repository = { resolveIssuer: async () => {
      if (unavailable) throw new Error("Registry unavailable");
      return replaced ? null : appResolver.authority;
    } };
    const token = await issue(privateKey, now, { ver: 2, spaceId: SPACE, permissions: [spaceCasReadPermission(SPACE)] });
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
      repository: { resolveIssuer: async () => {
        if (unavailable) throw new Error("Registry unavailable");
        return authority;
      } },
      now: () => currentTime,
    });
    const token = await issue(privateKey, now, { ver: 2, spaceId: SPACE, permissions: [spaceCasReadPermission(SPACE)] });
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
      ver: 2,
      spaceId: SPACE,
      permissions: [spaceCasReadPermission(SPACE)],
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
      { route: { operation: "readContent", appId: APP, spaceId: SPACE, hash }, permission: spaceCasReadPermission(SPACE) },
      { route: { operation: "readMetadata", appId: APP, spaceId: SPACE, hash }, permission: spaceCasReadPermission(SPACE) },
      { route: { operation: "lease", appId: APP, spaceId: SPACE, hash }, permission: spaceCasWritePermission(SPACE) },
      { route: { operation: "listRootRefs", appId: APP, spaceId: SPACE }, permission: spaceCasReadPermission(SPACE), refDomain: "doc" },
      { route: { operation: "updateRootRefs", appId: APP, spaceId: SPACE }, permission: spaceCasWritePermission(SPACE), refDomain: "doc" },
      { route: { operation: "usage", appId: APP, spaceId: SPACE }, permission: spaceCasManagePermission(SPACE) },
      { route: { operation: "gc", appId: APP, spaceId: SPACE }, permission: spaceCasManagePermission(SPACE) },
    ];

    for (const entry of cases) {
      const token = await issue(privateKey, now, {
        ver: 2,
        spaceId: SPACE,
        permissions: [entry.permission],
        ...(entry.refDomain === undefined ? {} : { refDomain: entry.refDomain }),
      });
      await expect(verifier.verify(request(token), entry.route)).resolves.toBeDefined();
      expect(appSpacePermissionFor(entry.route)).toBe(entry.permission);
    }
  });

  test("rejects v1 and v2 tokens across route families even when both scopes are present", async () => {
    const { now, privateKey, appResolver, stackResolver } = await fixture();
    const appVerifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const stackVerifier = new StackCapabilityVerifier({ repository: stackResolver, now: () => now });
    const v1Token = await issue(privateKey, now, {
      ver: 1,
      tenantId: TENANT,
      spaceId: SPACE,
      permissions: [casReadPermission(TENANT), spaceCasReadPermission(SPACE)],
    });
    const v2Token = await issue(privateKey, now, {
      ver: 2,
      tenantId: TENANT,
      spaceId: SPACE,
      permissions: [casReadPermission(TENANT), spaceCasReadPermission(SPACE)],
    });

    await expect(appVerifier.verify(request(v1Token), APP_ROUTE))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
    await expect(stackVerifier.verify(request(v2Token), STACK_ROUTE))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  test("rejects the v1 permission grammar on a v2 route", async () => {
    const { now, privateKey, appResolver } = await fixture();
    const verifier = new AppSpaceCapabilityVerifier({ repository: appResolver, now: () => now });
    const token = await issue(privateKey, now, {
      ver: 2,
      spaceId: SPACE,
      permissions: [casReadPermission(SPACE)],
    });
    await expect(verifier.verify(request(token), APP_ROUTE))
      .rejects.toMatchObject({ status: 403, code: "insufficient_permission" });
  });
});
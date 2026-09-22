import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CapabilityAuthenticationError,
  CapabilityAuthorizationError,
} from "@unicas/space-protocol";
import { createTraceUlid } from "@unicas/observability";

const handlers = vi.hoisted(() => ({
  spaceActor: vi.fn(async () => new Response("tenant")),
  admin: vi.fn(async () => new Response("admin")),
  mcp: vi.fn(async () => new Response("mcp")),
  migrate: vi.fn(async () => undefined),
  migrateControl: vi.fn(async () => undefined),
  pruneEmailChallenges: vi.fn(async () => 0),
  pruneSessions: vi.fn(async () => 0),
  reconcileUsage: vi.fn(async () => ({ examined: 0, observed: 0, missing: 0, failed: 0, backfill: false })),
  repairUsage: vi.fn(async () => false),
  readAppUsage: vi.fn(async () => ({
    nodeCount: 0,
    readyContentBytes: 0,
    readyStoredBytes: 0,
    reservedBytes: 0,
    notReadyNodeCount: 0,
    leasedNodeCount: 0,
    unobservedNodeCount: 0,
  })),
  spaceIdFromName: vi.fn((name: string) => `do:${name}`),
  spaceGet: vi.fn((_id: string) => ({ fetch: undefined as unknown })),
  verifySpace: vi.fn(async (_request: Request, route: { appId: string; spaceId: string }) => ({
    appId: route.appId,
    spaceId: route.spaceId,
    subject: "caller",
    jti: "request-v2",
    kid: "key-v2",
    permissions: [],
  })),
}));

vi.mock("../src/schema.js", () => ({
  migrateAppSpaceSchema: handlers.migrate,
}));
vi.mock("../src/control-schema.js", () => ({
  migrateControlSchema: handlers.migrateControl,
}));
vi.mock("../src/control-sessions.js", () => ({
  ControlSessionStore: class { pruneExpired = handlers.pruneSessions; },
}));
vi.mock("../src/email-challenge-repository.js", () => ({
  D1EmailChallengeRepository: class { pruneExpired = handlers.pruneEmailChallenges; },
}));
vi.mock("../src/usage-reconciliation.js", () => ({
  DEFAULT_USAGE_RECONCILE_MAX_NODES: 100,
  reconcileAppUsageObservations: handlers.reconcileUsage,
  repairOldestSpaceUsageProjection: handlers.repairUsage,
}));
vi.mock("../src/app-usage.js", () => ({
  CloudflareAppUsageRepository: class { readAppUsage = handlers.readAppUsage; },
}));
vi.mock("@unicas/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@unicas/service")>();
  return {
    ...actual,
    AppSpaceCapabilityVerifier: class {
      verify = handlers.verifySpace;
    },
  };
});
vi.mock("../src/control-authority.js", () => ({
  AppAuthorityRepository: class { },
}));
vi.mock("../src/admin-bff/index.js", () => ({
  configFromEnv: vi.fn(() => ({})),
  createAdminBff: vi.fn(() => handlers.admin),
  uiAssets: vi.fn(),
}));
vi.mock("../src/mcp/worker.js", () => ({
  mcpConfigFromEnv: vi.fn(() => ({
    resource: "https://cas.example/mcp",
    publicOrigin: "https://cas.example",
    allowedOriginHostnames: ["cas.example"],
  })),
  createControlPlaneMcpWorker: vi.fn(() => ({ fetch: handlers.mcp })),
}));

import worker, { type Env } from "../src/worker.js";
import { createAdminBff } from "../src/admin-bff/index.js";

const env = {
  CAS_CONTROL_DB: {},
  CAS_DB: {},
  CAS_R2: {},
  CAS_DO: {
    idFromName: handlers.spaceIdFromName,
    get: handlers.spaceGet,
  },
  CAS_DOMAIN_DO: {
    idFromName: (name: string) => name,
    get: () => ({ fetch: vi.fn() }),
  },
  CAS_PUBLIC_ORIGIN: "https://cas.example",
  MCP_PUBLIC_ORIGIN: "https://cas.example",
  ADMIN_PUBLIC_ORIGIN: "https://cas.example",
  PUBLIC_ORIGIN: "https://cas.example",
} as unknown as Env;

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.spaceGet.mockImplementation(() => ({ fetch: handlers.spaceActor }));
});

describe("service-cloudflare public routing", () => {
  test("accepts client ULID correlation only for Space routes", async () => {
    const requestedTraceId = createTraceUlid();
    const space = await worker.fetch(new Request(
      "https://cas.example/v1/apps/app-1/spaces/space-1/cas/usage",
      {
        headers: {
          Authorization: "Bearer v1-capability",
          "X-Trace-Id": requestedTraceId.toLowerCase(),
        },
      },
    ), env, ctx);
    const admin = await worker.fetch(new Request(
      "https://cas.example/admin/apps/app-1",
      { headers: { "X-Trace-Id": requestedTraceId } },
    ), env, ctx);

    expect(space.headers.get("X-Trace-Id")).toBe(requestedTraceId);
    expect(admin.headers.get("X-Trace-Id")).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(admin.headers.get("X-Trace-Id")).not.toBe(requestedTraceId);
  });

  test("runs bounded usage reconciliation during scheduled maintenance", async () => {
    const scheduledEnv = { ...env, CAS_CONTROL_DB: {}, CAS_DB: {}, CAS_R2: {} } as Env;
    const pending: Promise<unknown>[] = [];
    await worker.scheduled(
      {} as ScheduledController,
      scheduledEnv,
      { waitUntil: promise => pending.push(promise) } as ExecutionContext,
    );
    await Promise.all(pending);

    expect(handlers.migrateControl).toHaveBeenCalledOnce();
    expect(handlers.migrate).toHaveBeenCalledOnce();
    expect(handlers.pruneEmailChallenges).toHaveBeenCalledOnce();
    expect(handlers.pruneSessions).toHaveBeenCalledOnce();
    expect(handlers.reconcileUsage).toHaveBeenCalledWith({
      db: scheduledEnv.CAS_DB,
      bucket: scheduledEnv.CAS_R2,
      limit: 100,
    });
    expect(handlers.repairUsage).toHaveBeenCalledWith({ db: scheduledEnv.CAS_DB });
  });

  test("enforces the configured host/path matrix", async () => {
    const splitEnv = {
      ...env,
      CAS_PUBLIC_ORIGIN: "https://api.example",
      MCP_PUBLIC_ORIGIN: "https://api.example",
      ADMIN_PUBLIC_ORIGIN: "https://console.example",
      PUBLIC_ORIGIN: "https://legacy.example",
    } as Env;

    expect((await worker.fetch(new Request("https://api.example/health"), splitEnv, ctx)).status).toBe(200);
    expect((await worker.fetch(new Request("https://console.example/admin/me"), splitEnv, ctx)).status).toBe(200);
    const consoleRoot = await worker.fetch(new Request("https://console.example/"), splitEnv, ctx);
    expect(consoleRoot.status).toBe(302);
    expect(consoleRoot.headers.get("Location")).toBe("https://console.example/admin/");

    for (const url of [
      "https://console.example/health",
      "https://console.example/mcp",
      "https://api.example/admin/me",
      "https://api.example/",
      "https://legacy.example/health",
      "https://legacy.example/admin/me",
    ]) {
      expect((await worker.fetch(new Request(url), splitEnv, ctx)).status).toBe(404);
    }
  });

  test.each([undefined, "", "   "])("enables discovery without a domain restriction (%s)", async (restriction) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"keys":[]}'));
    try {
      await worker.fetch(new Request("https://cas.example/admin/apps"), { ...env, CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS: restriction }, ctx);
      const options = vi.mocked(createAdminBff).mock.calls.at(-1)![0]!;
      expect(options.oauthDiscovery).toBeDefined();
      const discovery = options.oauthDiscovery!;
      await expect(discovery.inspectIssuer({ issuer: "https://independent.example/oauth" })).rejects.toThrow();
      expect(fetcher).toHaveBeenCalled();
      expect(String(fetcher.mock.calls[0]![0])).toContain("https://independent.example/");
    } finally { fetcher.mockRestore(); }
  });

  test("applies an operator's optional origin restriction before fetching", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await worker.fetch(new Request("https://cas.example/admin/apps"), { ...env, CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS: "https://approved.example" }, ctx);
      const options = vi.mocked(createAdminBff).mock.calls.at(-1)![0]!;
      await expect(options.oauthDiscovery!.inspectIssuer({ issuer: "https://independent.example/oauth" })).rejects.toThrow("not allowlisted");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });

  test("serves health and rejects unknown or private internal routes", async () => {
    const health = await worker.fetch(new Request("https://cas.example/health"), env, ctx);
    await expect(health.json()).resolves.toEqual({ ok: true, service: "unicas" });

    for (const path of ["/other", "/_internal/audit/refs", "/mcp/other"]) {
      expect((await worker.fetch(new Request(`https://cas.example${path}`), env, ctx)).status)
        .toBe(404);
    }
  });

  test("keeps business responses available when sampled tracing is misconfigured", async () => {
    const response = await worker.fetch(
      new Request("https://cas.example/health"),
      { ...env, UNICAS_MANUAL_TRACE_SAMPLE_RATE: "1" },
      ctx,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "unicas" });
  });

  test("rejects retired administrator Stack routes before service composition", async () => {
    for (const path of ["/admin/stacks", "/admin/stacks/cas_legacy", "/admin/stacks/cas_legacy/members"]) {
      expect((await worker.fetch(new Request(`https://cas.example${path}`), env, ctx)).status).toBe(404);
    }
  });

  test("returns 404 for every retired Stack/Tenant route without initializing or dispatching", async () => {
    const prepare = vi.fn();
    const metadataEnv = {
      ...env,
      CAS_CONTROL_DB: { prepare },
      CAS_DB: {},
    } as unknown as Env;

    for (const [method, path] of [
      ["GET", "/.well-known/oauth-protected-resource/stacks/s1"],
      ["GET", "/stacks/s1/tenants/t1/cas/nodes/hash/content"],
      ["GET", "/stacks/s1/tenants/t1/cas/nodes/hash/metadata"],
      ["POST", "/stacks/s1/tenants/t1/cas/nodes/hash/lease"],
      ["GET", "/stacks/s1/tenants/t1/cas/usage"],
      ["POST", "/stacks/s1/tenants/t1/cas/gc"],
      ["GET", "/stacks/s1/tenants/t1/root-refs"],
      ["POST", "/stacks/s1/tenants/t1/root-refs"],
    ]) {
      const response = await worker.fetch(new Request(`https://cas.example${path}`, { method }), metadataEnv, ctx);
      expect(response.status, path).toBe(404);
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(handlers.migrateControl).not.toHaveBeenCalled();
    expect(handlers.migrate).not.toHaveBeenCalled();
    expect(handlers.verifySpace).not.toHaveBeenCalled();
    expect(handlers.spaceActor).not.toHaveBeenCalled();
    expect(handlers.spaceIdFromName).not.toHaveBeenCalled();
  });

  test("authorizes Space routes through the released verifier and trusted scope", async () => {
    const spaceEnv = { ...env, CAS_DB: {} } as Env;
    const space = await worker.fetch(new Request(
      "https://cas.example/v1/apps/app-1/spaces/space-1/cas/usage",
      {
        headers: {
          Authorization: "Bearer v1-capability",
          "X-CAS-Route-Family": "attacker",
        },
      },
    ), spaceEnv, ctx);
    const app = await worker.fetch(new Request(
      "https://cas.example/admin/apps/app-1",
      { headers: { Cookie: "cas_admin_session=secret" } },
    ), spaceEnv, ctx);

    expect(space.status).toBe(200);
    expect(app.status).toBe(200);
    expect(handlers.verifySpace).toHaveBeenCalledWith(
      expect.any(Request),
      { operation: "usage", appId: "app-1", spaceId: "space-1" },
    );
    expect(handlers.spaceIdFromName).toHaveBeenCalledWith("app-1|space-1");
    const spaceRequest = handlers.spaceActor.mock.calls[0]![0] as Request;
    expect(spaceRequest.headers.get("X-CAS-App-Id")).toBe("app-1");
    expect(spaceRequest.headers.get("X-CAS-Space-Id")).toBe("space-1");
    expect(spaceRequest.headers.get("X-CAS-Route-Family")).toBe("app-space");
    const adminRequest = handlers.admin.mock.calls[0]![0] as Request;
    expect(adminRequest.url).toBe("https://cas.example/admin/apps/app-1");
    expect(handlers.migrate).toHaveBeenCalledTimes(1);
    expect(handlers.migrateControl).toHaveBeenCalledTimes(1);
  });

  test("returns Space verifier failures without Durable Object dispatch", async () => {
    const untrustedTraceId = createTraceUlid();
    handlers.verifySpace.mockRejectedValueOnce(new CapabilityAuthenticationError(
      "missing_token",
      "CAS capability token is required",
    ));
    const unauthenticated = await worker.fetch(new Request(
      "https://cas.example/v1/apps/app-1/spaces/space-1/cas/usage",
      { headers: { "X-Trace-Id": untrustedTraceId } },
    ), env, ctx);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("X-Trace-Id")).not.toBe(untrustedTraceId);

    handlers.verifySpace.mockRejectedValueOnce(new CapabilityAuthorizationError(
      "resource_scope_mismatch",
      "CAS capability Space does not match the requested path",
    ));
    const forbidden = await worker.fetch(new Request(
      "https://cas.example/v1/apps/app-1/spaces/space-1/cas/usage",
      { headers: { Authorization: "Bearer wrong-space-capability" } },
    ), env, ctx);
    expect(forbidden.status).toBe(403);
    expect(handlers.spaceActor).not.toHaveBeenCalled();
    expect(handlers.spaceIdFromName).not.toHaveBeenCalled();
    expect(handlers.spaceGet).not.toHaveBeenCalled();
  });

  test("routes admin protocol and BFF requests without tenant bearer credentials", async () => {
    const adminEnv = { ...env, CAS_CONTROL_DB: {}, CAS_DB: {} } as Env;
    for (const path of ["/admin/me", "/admin/auth/login"]) {
      await worker.fetch(new Request(`https://cas.example${path}`, {
        headers: {
          Authorization: "Bearer tenant-capability",
          Cookie: "cas_admin_session=secret",
          "X-Cas-Audit-Reader-Key": "reader",
          "X-UniCAS-Trace-Context": "forged",
        },
      }), adminEnv, ctx);
    }

    for (const call of handlers.admin.mock.calls) {
      const request = call[0] as Request;
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.headers.get("Cookie")).toBe("cas_admin_session=secret");
      expect(request.headers.get("X-Cas-Audit-Reader-Key")).toBeNull();
      expect(request.headers.get("X-UniCAS-Trace-Context")).toBeNull();
    }
    expect(handlers.migrateControl).toHaveBeenCalledTimes(1);
    expect(handlers.migrateControl.mock.invocationCallOrder[0])
      .toBeLessThan(handlers.admin.mock.invocationCallOrder[0]!);
    expect(handlers.migrate).not.toHaveBeenCalled();

    const options = vi.mocked(createAdminBff).mock.calls.at(-1)![0] as {
      appUsageRepository: { readAppUsage(appId: string): Promise<unknown> };
    };
    await options.appUsageRepository.readAppUsage("app-1");
    expect(handlers.migrate).toHaveBeenCalledOnce();
    expect(handlers.readAppUsage).toHaveBeenCalledWith("app-1");
  });

  test("retries control schema initialization after a failed admin dispatch", async () => {
    const retryEnv = { ...env } as Env;
    handlers.migrateControl.mockRejectedValueOnce(new Error("migration unavailable"));

    await expect(worker.fetch(
      new Request("https://cas.example/admin/me"),
      retryEnv,
      ctx,
    )).rejects.toThrow("migration unavailable");
    await expect(worker.fetch(
      new Request("https://cas.example/admin/me"),
      retryEnv,
      ctx,
    )).resolves.toBeInstanceOf(Response);

    expect(handlers.migrateControl).toHaveBeenCalledTimes(2);
    expect(handlers.admin).toHaveBeenCalledTimes(1);
  });

  test("enforces MCP browser origin and strips cookies", async () => {
    const rejected = await worker.fetch(new Request("https://cas.example/mcp", {
      headers: { Origin: "https://attacker.example" },
    }), env, ctx);
    expect(rejected.status).toBe(403);
    expect(handlers.mcp).not.toHaveBeenCalled();

    const mcpEnv = { ...env } as Env;
    await worker.fetch(new Request("https://cas.example/mcp", {
      headers: {
        Origin: "https://cas.example",
        Authorization: "Bearer mcp-token",
        Cookie: "cas_admin_session=secret",
        "X-UniCAS-Trace-Context": "forged",
      },
    }), mcpEnv, ctx);
    await worker.fetch(
      new Request("https://cas.example/.well-known/oauth-protected-resource"),
      mcpEnv,
      ctx,
    );
    const request = handlers.mcp.mock.calls[0]![0] as Request;
    expect(request.headers.get("Authorization")).toBe("Bearer mcp-token");
    expect(request.headers.get("Cookie")).toBeNull();
    expect(request.headers.get("X-UniCAS-Trace-Context")).toBeNull();
    expect(handlers.migrateControl).toHaveBeenCalledTimes(1);
    expect(handlers.migrateControl.mock.invocationCallOrder[0])
      .toBeLessThan(handlers.mcp.mock.invocationCallOrder[0]!);
    expect(handlers.mcp).toHaveBeenCalledTimes(2);
  });
});
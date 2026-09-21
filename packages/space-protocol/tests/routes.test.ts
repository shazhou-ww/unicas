import { describe, expect, test } from "vitest";
import {
  CasLeaseDurationHeader,
  CasUploadIdHeader,
  CasUploadLengthHeader,
  appSpaceRoutes,
  matchAppSpaceRoute,
} from "../src/index.js";
import type { AppSpaceRoute } from "../src/index.js";
import {
  casRoutes,
  matchCasRoute,
} from "../src/v1.js";
import type {
  CasLeaseResponse,
  CasRoute,
  CasUpdateRootRefsRequest,
  CasUpdateRootRefsResponse,
} from "../src/v1.js";

const STACK = "stack-a";
const TENANT = "tenant/a";
const APP = "app-a";
const SPACE = "space/a";

describe("CAS routes (canonical stack-scoped)", () => {
  test.each([
    ["GET", casRoutes.readContent({ stackId: STACK, tenantId: TENANT, hash: "abc" }), "readContent"],
    ["GET", casRoutes.readMetadata({ stackId: STACK, tenantId: TENANT, hash: "abc" }), "readMetadata"],
    ["POST", casRoutes.lease({ stackId: STACK, tenantId: TENANT, hash: "abc" }), "lease"],
    ["GET", casRoutes.usage({ stackId: STACK, tenantId: TENANT }), "usage"],
    ["POST", casRoutes.gc({ stackId: STACK, tenantId: TENANT }), "gc"],
    ["GET", casRoutes.listRootRefs({ stackId: STACK, tenantId: TENANT }), "listRootRefs"],
    ["POST", casRoutes.updateRootRefs({ stackId: STACK, tenantId: TENANT }), "updateRootRefs"],
  ])("matches %s %s", (method, pathname, operation) => {
    expect(matchCasRoute(method, pathname)).toMatchObject({
      operation,
      stackId: STACK,
      tenantId: TENANT,
    });
  });

  test("every tenant service route carries stackId + tenantId", () => {
    const routes: readonly CasRoute[] = [
      { operation: "readContent", stackId: STACK, tenantId: TENANT, hash: "a".repeat(64) },
      { operation: "readMetadata", stackId: STACK, tenantId: TENANT, hash: "a".repeat(64) },
      { operation: "lease", stackId: STACK, tenantId: TENANT, hash: "a".repeat(64) },
      { operation: "usage", stackId: STACK, tenantId: TENANT },
      { operation: "gc", stackId: STACK, tenantId: TENANT },
      { operation: "listRootRefs", stackId: STACK, tenantId: TENANT },
      { operation: "updateRootRefs", stackId: STACK, tenantId: TENANT },
    ];
    for (const route of routes) {
      expect(route.stackId).toBe(STACK);
      expect(route.tenantId).toBe(TENANT);
    }
  });

  test("freezes encoded stack paths and wire constants", () => {
    expect(casRoutes.readContent({ stackId: "stack/a", tenantId: "tenant/a", hash: "hash value" }))
      .toBe("/stacks/stack%2Fa/tenants/tenant%2Fa/cas/nodes/hash%20value/content");
    expect(casRoutes.updateRootRefs({ stackId: "stack/a", tenantId: "tenant/a" }))
      .toBe("/stacks/stack%2Fa/tenants/tenant%2Fa/root-refs");
    expect(casRoutes.listRootRefs({ stackId: STACK, tenantId: TENANT }, { limit: 10, cursor: "abc" }))
      .toBe(`/stacks/${STACK}/tenants/tenant%2Fa/root-refs?limit=10&cursor=abc`);
    expect(CasLeaseDurationHeader).toBe("X-CAS-Lease-Duration");
    expect(CasUploadLengthHeader).toBe("X-CAS-Upload-Length");
    expect(CasUploadIdHeader).toBe("X-CAS-Upload-Id");
    expect(casRoutes.lease({ stackId: STACK, tenantId: TENANT, hash: "abc" }))
      .toBe(`/stacks/${STACK}/tenants/tenant%2Fa/cas/nodes/abc/lease`);
  });

  test("rejects unknown methods and malformed escapes", () => {
    expect(matchCasRoute("PUT", casRoutes.lease({ stackId: STACK, tenantId: "t", hash: "h" }))).toBeNull();
    expect(matchCasRoute("GET", "/stacks/%ZZ/tenants/t/cas/usage")).toBeNull();
  });

  test("never recognizes /admin control-plane paths", () => {
    expect(matchCasRoute("GET", "/admin/me")).toBeNull();
    expect(matchCasRoute("GET", "/admin/stacks")).toBeNull();
    expect(matchCasRoute("POST", "/admin/stacks/s/root-ref-domains/doc/refs")).toBeNull();
    expect(matchCasRoute("GET", "/admin/stacks/s/root-ref-domains/doc/events")).toBeNull();
  });

  test("never recognizes legacy tenant-scoped or internal paths", () => {
    expect(matchCasRoute("GET", "/tenants/t/cas/nodes/h/content")).toBeNull();
    expect(matchCasRoute("POST", "/tenants/t/_internal/root-refs")).toBeNull();
    expect(matchCasRoute("POST", "/tenants/t/_internal/root-assignments")).toBeNull();
    expect(matchCasRoute("GET", "/tenants/t/_internal/nodes/h")).toBeNull();
    expect(matchCasRoute("POST", "/_internal/root-refs")).toBeNull();
    expect(matchCasRoute("GET", "/users/u/cas/gc")).toBeNull();
  });

  test("requires the stacks/tenants path shape", () => {
    expect(matchCasRoute("GET", "/stacks/s/cas/usage")).toBeNull();
    expect(matchCasRoute("GET", "/stacks/s/tenants/")).toBeNull();
    expect(matchCasRoute("GET", "/stacks//tenants/t/cas/usage")).toBeNull();
  });
});

describe("CAS v1 routes (App/Space)", () => {
  test.each([
    ["GET", appSpaceRoutes.readContent({ appId: APP, spaceId: SPACE, hash: "abc" }), "readContent"],
    ["GET", appSpaceRoutes.readMetadata({ appId: APP, spaceId: SPACE, hash: "abc" }), "readMetadata"],
    ["POST", appSpaceRoutes.lease({ appId: APP, spaceId: SPACE, hash: "abc" }), "lease"],
    ["GET", appSpaceRoutes.usage({ appId: APP, spaceId: SPACE }), "usage"],
    ["POST", appSpaceRoutes.gc({ appId: APP, spaceId: SPACE }), "gc"],
    ["GET", appSpaceRoutes.listRootRefs({ appId: APP, spaceId: SPACE }), "listRootRefs"],
    ["POST", appSpaceRoutes.updateRootRefs({ appId: APP, spaceId: SPACE }), "updateRootRefs"],
  ])("matches %s %s", (method, pathname, operation) => {
    expect(matchAppSpaceRoute(method, pathname)).toMatchObject({
      operation,
      appId: APP,
      spaceId: SPACE,
    });
  });

  test("every App/Space data route carries appId + spaceId", () => {
    const routes: readonly AppSpaceRoute[] = [
      { operation: "readContent", appId: APP, spaceId: SPACE, hash: "a".repeat(64) },
      { operation: "readMetadata", appId: APP, spaceId: SPACE, hash: "a".repeat(64) },
      { operation: "lease", appId: APP, spaceId: SPACE, hash: "a".repeat(64) },
      { operation: "usage", appId: APP, spaceId: SPACE },
      { operation: "gc", appId: APP, spaceId: SPACE },
      { operation: "listRootRefs", appId: APP, spaceId: SPACE },
      { operation: "updateRootRefs", appId: APP, spaceId: SPACE },
    ];
    for (const route of routes) {
      expect(route.appId).toBe(APP);
      expect(route.spaceId).toBe(SPACE);
    }
  });

  test("freezes encoded v1 paths", () => {
    expect(appSpaceRoutes.readContent({ appId: "app/a", spaceId: "space/a", hash: "hash value" }))
      .toBe("/v1/apps/app%2Fa/spaces/space%2Fa/cas/nodes/hash%20value/content");
    expect(appSpaceRoutes.listRootRefs(
      { appId: APP, spaceId: SPACE },
      { limit: 10, cursor: "abc" },
    )).toBe(`/v1/apps/${APP}/spaces/space%2Fa/root-refs?limit=10&cursor=abc`);
  });

  test("keeps App/Space and frozen Stack/Tenant route matchers disjoint", () => {
    const stackTenant = casRoutes.usage({ stackId: STACK, tenantId: TENANT });
    const appSpace = appSpaceRoutes.usage({ appId: APP, spaceId: SPACE });
    expect(matchAppSpaceRoute("GET", stackTenant)).toBeNull();
    expect(matchCasRoute("GET", appSpace)).toBeNull();
  });

  test("rejects prototype v2 routes", () => {
    expect(matchAppSpaceRoute("GET", "/v2/apps/a/spaces/s/cas/usage")).toBeNull();
  });

  test("rejects unknown methods, malformed escapes, and incomplete scopes", () => {
    expect(matchAppSpaceRoute("PUT", appSpaceRoutes.lease({ appId: APP, spaceId: SPACE, hash: "h" }))).toBeNull();
    expect(matchAppSpaceRoute("GET", "/v1/apps/%ZZ/spaces/s/cas/usage")).toBeNull();
    expect(matchAppSpaceRoute("GET", "/v1/apps/a/cas/usage")).toBeNull();
  });
});

describe("CAS write contract compile fixtures", () => {
  test("lease response preserves ready results and admits direct uploads", () => {
    const ready: CasLeaseResponse = {
      hash: "a".repeat(64),
      ready: true,
      leaseStartedAt: 1,
      leaseExpiresAt: 2,
    };
    const upload: CasLeaseResponse = {
      hash: "b".repeat(64),
      ready: false,
      status: "upload_required",
      uploadId: "upload-1",
      expiresAt: 3,
      upload: {
        method: "PUT",
        url: "https://example.r2.cloudflarestorage.com/bucket/key?signed",
        headers: { "If-None-Match": "*" },
      },
    };
    expect(ready.ready).toBe(true);
    expect(upload.ready).toBe(false);
  });

  test("updateRootRefs request carries a stack tenant path and the signed update", () => {
    const request: CasUpdateRootRefsRequest = {
      path: { stackId: STACK, tenantId: TENANT },
      body: {
        requestId: "session:s1:commit:8:roots",
        changes: { ["a".repeat(64)]: -1, ["b".repeat(64)]: 2 },
      },
    };
    expect(request.path.stackId).toBe(STACK);
    expect(request.body.changes["a".repeat(64)]).toBe(-1);
  });

  test("updateRootRefs response shape carries revision and idempotency", () => {
    const fresh: CasUpdateRootRefsResponse = { success: true, idempotent: false, revision: 1843 };
    const retry: CasUpdateRootRefsResponse = { success: true, idempotent: true, revision: 1843 };
    const failed: CasUpdateRootRefsResponse = { error: "ROOT_REF_SNAPSHOT_CHANGED" };
    expect(fresh.revision).toBe(1843);
    expect(retry.idempotent).toBe(true);
    expect("error" in failed).toBe(true);
  });
});

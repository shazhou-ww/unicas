import { describe, expect, test } from "vitest";
import {
  appSpaceRoutes,
  matchAppSpaceRoute,
} from "../src/index.js";
import type { AppSpaceRoute } from "../src/index.js";

const APP = "app-a";
const SPACE = "space/a";

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

  test("rejects retired Stack/Tenant routes", () => {
    expect(matchAppSpaceRoute("GET", "/stacks/s/tenants/t/cas/usage")).toBeNull();
    expect(matchAppSpaceRoute("POST", "/stacks/s/tenants/t/root-refs")).toBeNull();
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

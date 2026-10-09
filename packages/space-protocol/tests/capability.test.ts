import { describe, expect, test } from "vitest";
import {
  SpaceCapabilityClaimsSchema,
  SpaceCapabilityPermissionKinds,
  SpaceCapabilityVersion,
  SpaceOperationPolicies,
  SpaceRefDomainClaimSchema,
  parseSpaceCapabilityPermission,
  spaceOperationPolicyFor,
  parseSpaceSelector,
  spaceSelectorMatches,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
} from "../src/index.js";

describe("Space capability vocabulary", () => {
  test("uses an explicit version and operation permission grammar", () => {
    expect(SpaceCapabilityVersion).toBe(2);
    expect(SpaceCapabilityPermissionKinds).toEqual([
      "cas:nodes:read",
      "cas:nodes:lease",
      "cas:root-refs:read",
      "cas:root-refs:update",
      "cas:usage:read",
      "cas:gc:execute",
    ]);
    expect(spaceNodeReadPermission()).toBe("cas:nodes:read");
    expect(spaceNodeLeasePermission()).toBe("cas:nodes:lease");
    expect(spaceRootRefsReadPermission()).toBe("cas:root-refs:read");
    expect(spaceRootRefsUpdatePermission()).toBe("cas:root-refs:update");
    expect(spaceUsageReadPermission()).toBe("cas:usage:read");
    expect(spaceGcExecutePermission()).toBe("cas:gc:execute");
  });

  test.each([
    "cas:nodes:read",
    "cas:nodes:lease",
    "cas:root-refs:read",
    "cas:root-refs:update",
    "cas:usage:read",
    "cas:gc:execute",
  ] as const)("parses the exact %s permission", (permission) => {
    expect(parseSpaceCapabilityPermission(permission)).toEqual({ kind: permission });
  });

  test("rejects scoped, broad, and unknown Space permissions", () => {
    expect(parseSpaceCapabilityPermission("spaces:space%2Fa:cas:read")).toBeNull();
    expect(parseSpaceCapabilityPermission("tenants:scope-a:cas:read")).toBeNull();
    expect(parseSpaceCapabilityPermission("cas:read")).toBeNull();
    expect(parseSpaceCapabilityPermission("cas:nodes:write")).toBeNull();
    expect(parseSpaceCapabilityPermission("cas:root-refs:lease")).toBeNull();
  });

  test("publishes the verified capability claim shape", () => {
    const claims = {
      ver: 2,
      iss: "https://issuer.example",
      sub: "principal-1",
      aud: "unicas-cas",
      iat: 1,
      nbf: 1,
      exp: 2,
      jti: "token-1",
      grants: [{
        selector: "/space-1",
        permissions: ["cas:nodes:read"],
      }],
    };
    expect(SpaceCapabilityClaimsSchema.safeParse(claims).success).toBe(true);
    expect(SpaceCapabilityClaimsSchema.safeParse({
      ...claims,
      grants: [{ selector: "/space-1", permissions: ["cas:read"] }],
    }).success).toBe(false);
    expect(SpaceCapabilityClaimsSchema.safeParse({
      ...claims,
      grants: [{ selector: "space-1", permissions: ["cas:nodes:read"] }],
    }).success).toBe(false);
    expect(SpaceCapabilityClaimsSchema.safeParse({ ...claims, grants: [] }).success).toBe(false);
    expect(SpaceRefDomainClaimSchema.safeParse("files:primary").success).toBe(true);
    expect(SpaceRefDomainClaimSchema.safeParse("_reserved").success).toBe(false);
    expect(SpaceRefDomainClaimSchema.safeParse(`a${"b".repeat(64)}`).success).toBe(false);
  });

  test("maps every route operation to one exact policy", () => {
    expect(SpaceOperationPolicies).toEqual({
      readContent: {
        operationId: "readContent",
        permission: "cas:nodes:read",
        requiredClaims: ["grants"],
      },
      readMetadata: {
        operationId: "readMetadata",
        permission: "cas:nodes:read",
        requiredClaims: ["grants"],
      },
      lease: {
        operationId: "leaseNode",
        permission: "cas:nodes:lease",
        requiredClaims: ["grants"],
      },
      usage: {
        operationId: "getUsage",
        permission: "cas:usage:read",
        requiredClaims: ["grants"],
      },
      gc: {
        operationId: "runGc",
        permission: "cas:gc:execute",
        requiredClaims: ["grants"],
      },
      listRootRefs: {
        operationId: "listRootRefs",
        permission: "cas:root-refs:read",
        requiredClaims: ["grants", "refDomain"],
      },
      updateRootRefs: {
        operationId: "updateRootRefs",
        permission: "cas:root-refs:update",
        requiredClaims: ["grants", "refDomain"],
      },
    });
    expect(spaceOperationPolicyFor("lease")).toBe(SpaceOperationPolicies.lease);
  });

  test.each([
    ["/users/u_123", "exact", "/users/u_123"],
    ["/shared/public/report-*", "segment-prefix", "/shared/public/report-"],
    ["/shared/public/**", "recursive-prefix", "/shared/public/"],
  ] as const)("parses the supported %s selector", (selector, kind, literalPrefix) => {
    expect(parseSpaceSelector(selector)).toMatchObject({ selector, kind, literalPrefix });
  });

  test.each([
    "",
    "users/u_123",
    "/users/",
    "/users//u_123",
    "/users/u.123",
    "*",
    "/users/*",
    "/users/u_*/*",
    "/users/**/private",
    "/users/u_**",
    "/users/***",
  ])("rejects unsupported selector %s", (selector) => {
    expect(parseSpaceSelector(selector)).toBeNull();
  });

  test("matches exact, non-recursive suffix, and recursive suffix selectors", () => {
    expect(spaceSelectorMatches("/users/u_123", "/users/u_123")).toBe(true);
    expect(spaceSelectorMatches("/users/u_123", "/users/u_124")).toBe(false);

    expect(spaceSelectorMatches("/shared/public/report-*", "/shared/public/report-2026")).toBe(true);
    expect(spaceSelectorMatches("/shared/public/report-*", "/shared/public/report-2026/draft")).toBe(false);
    expect(spaceSelectorMatches("/shared/public/report-*", "/shared/public/other-report-2026")).toBe(false);

    expect(spaceSelectorMatches("/shared/public/**", "/shared/public/report-2026")).toBe(true);
    expect(spaceSelectorMatches("/shared/public/**", "/shared/public/reports/2026")).toBe(true);
    expect(spaceSelectorMatches("/shared/public/**", "/shared/public")).toBe(false);
    expect(spaceSelectorMatches("/shared/public/**", "/shared/private/report-2026")).toBe(false);
  });
});
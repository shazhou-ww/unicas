import { describe, expect, test } from "vitest";
import {
  SpaceCapabilityClaimsSchema,
  SpaceCapabilityPermissionKinds,
  SpaceCapabilityVersion,
  SpaceOperationPolicies,
  SpaceRefDomainClaimSchema,
  parseSpaceCapabilityPermission,
  spaceOperationPolicyFor,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
} from "../src/index.js";

describe("Space capability v1 vocabulary", () => {
  test("uses an explicit version and operation permission grammar", () => {
    expect(SpaceCapabilityVersion).toBe(1);
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
      ver: 1,
      iss: "https://issuer.example",
      sub: "principal-1",
      aud: "unicas-cas",
      iat: 1,
      nbf: 1,
      exp: 2,
      jti: "token-1",
      spaceId: "space-1",
      permissions: ["cas:nodes:read"],
    };
    expect(SpaceCapabilityClaimsSchema.safeParse(claims).success).toBe(true);
    expect(SpaceCapabilityClaimsSchema.safeParse({
      ...claims,
      permissions: ["cas:read"],
    }).success).toBe(false);
    expect(SpaceCapabilityClaimsSchema.safeParse({
      ...claims,
      spaceId: "",
    }).success).toBe(false);
    expect(SpaceRefDomainClaimSchema.safeParse("files:primary").success).toBe(true);
    expect(SpaceRefDomainClaimSchema.safeParse("_reserved").success).toBe(false);
    expect(SpaceRefDomainClaimSchema.safeParse(`a${"b".repeat(64)}`).success).toBe(false);
  });

  test("maps every route operation to one exact policy", () => {
    expect(SpaceOperationPolicies).toEqual({
      readContent: {
        operationId: "readContent",
        permission: "cas:nodes:read",
        requiredClaims: ["spaceId"],
      },
      readMetadata: {
        operationId: "readMetadata",
        permission: "cas:nodes:read",
        requiredClaims: ["spaceId"],
      },
      lease: {
        operationId: "leaseNode",
        permission: "cas:nodes:lease",
        requiredClaims: ["spaceId"],
      },
      usage: {
        operationId: "getUsage",
        permission: "cas:usage:read",
        requiredClaims: ["spaceId"],
      },
      gc: {
        operationId: "runGc",
        permission: "cas:gc:execute",
        requiredClaims: ["spaceId"],
      },
      listRootRefs: {
        operationId: "listRootRefs",
        permission: "cas:root-refs:read",
        requiredClaims: ["spaceId", "refDomain"],
      },
      updateRootRefs: {
        operationId: "updateRootRefs",
        permission: "cas:root-refs:update",
        requiredClaims: ["spaceId", "refDomain"],
      },
    });
    expect(spaceOperationPolicyFor("lease")).toBe(SpaceOperationPolicies.lease);
  });
});
import { describe, expect, test } from "vitest";
import {
  SpaceCapabilityVersion,
  parseSpaceCapabilityPermission,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
} from "../src/index.js";
import { casReadPermission, parseCapabilityPermission } from "../src/v1.js";

describe("Space capability v1 vocabulary", () => {
  test("uses an explicit version and operation permission grammar", () => {
    expect(SpaceCapabilityVersion).toBe(1);
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
    expect(parseSpaceCapabilityPermission("cas:read")).toBeNull();
    expect(parseSpaceCapabilityPermission("cas:nodes:write")).toBeNull();
    expect(parseSpaceCapabilityPermission("cas:root-refs:lease")).toBeNull();
  });

  test("keeps Space and frozen Stack/Tenant permission parsers disjoint", () => {
    const tenantPermission = casReadPermission("scope-a");
    const spacePermission = spaceNodeReadPermission();
    expect(parseSpaceCapabilityPermission(tenantPermission)).toBeNull();
    expect(parseCapabilityPermission(spacePermission)).toBeNull();
  });
});
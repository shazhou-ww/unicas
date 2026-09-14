import { describe, expect, test } from "vitest";
import {
  SpaceCapabilityVersion,
  casReadPermission,
  parseCapabilityPermission,
  parseSpaceCapabilityPermission,
  spaceCasManagePermission,
  spaceCasReadPermission,
  spaceCasWritePermission,
} from "../src/index.js";

describe("Space capability v2 vocabulary", () => {
  test("uses an explicit version and spaces permission grammar", () => {
    expect(SpaceCapabilityVersion).toBe(2);
    expect(spaceCasReadPermission("space/a")).toBe("spaces:space%2Fa:cas:read");
    expect(spaceCasWritePermission("space/a")).toBe("spaces:space%2Fa:cas:write");
    expect(spaceCasManagePermission("space/a")).toBe("spaces:space%2Fa:cas:manage");
  });

  test("parses only canonical Space CAS permissions", () => {
    expect(parseSpaceCapabilityPermission("spaces:space%2Fa:cas:read"))
      .toEqual({ kind: "cas:read", spaceId: "space/a" });
    expect(parseSpaceCapabilityPermission("spaces:space/a:cas:read")).toBeNull();
    expect(parseSpaceCapabilityPermission("spaces:s:cas:delete")).toBeNull();
    expect(parseSpaceCapabilityPermission("spaces::cas:read")).toBeNull();
  });

  test("keeps v1 and v2 permission parsers disjoint", () => {
    const tenantPermission = casReadPermission("scope-a");
    const spacePermission = spaceCasReadPermission("scope-a");
    expect(parseSpaceCapabilityPermission(tenantPermission)).toBeNull();
    expect(parseCapabilityPermission(spacePermission)).toBeNull();
  });
});
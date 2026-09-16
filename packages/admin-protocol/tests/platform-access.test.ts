import { describe, expect, test } from "vitest";
import { CreatePlatformInvitationSchema, effectivePlatformAccess, hasPlatformAuthority, PatchPlatformAccessSchema, PlatformInvitationQuerySchema } from "../src/platform-access.js";

describe("platform authorization model", () => {
  test("authentication alone never grants admission or authority", () => {
    expect(effectivePlatformAccess(null, false)).toBe("no_access");
    expect(hasPlatformAuthority(null, "apps.create")).toBe(false);
    expect(hasPlatformAuthority(null, "platform.admin")).toBe(false);
  });

  test("App membership grants admission but never App creation", () => {
    expect(effectivePlatformAccess(null, true)).toBe("active");
    expect(hasPlatformAuthority({ status: "active", authorities: [] }, "apps.create")).toBe(false);
  });

  test("platform administration and App creation are independent", () => {
    const state = { status: "active" as const, authorities: ["platform.admin" as const] };
    expect(effectivePlatformAccess(state, false)).toBe("active");
    expect(hasPlatformAuthority(state, "platform.admin")).toBe(true);
    expect(hasPlatformAuthority(state, "apps.create")).toBe(false);
  });

  test("blocking overrides grants and membership", () => {
    const state = { status: "blocked" as const, authorities: ["platform.admin" as const, "apps.create" as const] };
    expect(effectivePlatformAccess(state, true)).toBe("blocked");
    expect(hasPlatformAuthority(state, "platform.admin")).toBe(false);
    expect(hasPlatformAuthority(state, "apps.create")).toBe(false);
  });

  test("patches reject implicit, duplicate, unknown, and nullable grants", () => {
    for (const input of [{}, { status: null }, { authorities: ["owner"] }, { authorities: ["apps.create", "apps.create"] }, { scope: "control:security" }]) {
      expect(PatchPlatformAccessSchema.safeParse(input).success).toBe(false);
    }
    expect(PatchPlatformAccessSchema.safeParse({ authorities: [] }).success).toBe(true);
  });

  test("platform invitations require normalized email input and a non-empty authority set", () => {
    expect(CreatePlatformInvitationSchema.safeParse({
      emailConstraint: "developer@example.com",
      authorities: ["platform.admin", "apps.create"],
    }).success).toBe(true);
    for (const input of [
      { emailConstraint: "not-email", authorities: ["apps.create"] },
      { emailConstraint: "developer@example.com", authorities: [] },
      { emailConstraint: "developer@example.com", authorities: ["apps.create", "apps.create"] },
      { emailConstraint: "developer@example.com", authorities: ["owner"] },
      { emailConstraint: "developer@example.com", authorities: ["apps.create"], token: "secret" },
    ]) {
      expect(CreatePlatformInvitationSchema.safeParse(input).success).toBe(false);
    }
    expect(PlatformInvitationQuerySchema.safeParse({ status: "expired", limit: 50 }).success).toBe(true);
    expect(PlatformInvitationQuerySchema.safeParse({ status: "open" }).success).toBe(false);
  });
});
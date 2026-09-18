import { describe, expect, test } from "vitest";
import { CreatePlatformInvitationSchema, PlatformInvitationQuerySchema } from "../src/platform-access.js";

describe("platform invitation model", () => {
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
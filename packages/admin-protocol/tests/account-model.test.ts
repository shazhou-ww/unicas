import { describe, expect, test } from "vitest";
import {
  AccountIdSchema,
  AccountPlatformAuthoritySchema,
  AccountSelfSchema,
  ExternalIdentityDetailSchema,
  PrimaryVerifiedEmailSchema,
} from "../src/index.js";

const accountId = `acct_${"a".repeat(22)}`;

describe("Account protocol model", () => {
  test("requires opaque 128-bit account identifiers", () => {
    expect(AccountIdSchema.safeParse(accountId).success).toBe(true);
    expect(AccountIdSchema.safeParse("acct_short").success).toBe(false);
    expect(AccountIdSchema.safeParse(`user_${"a".repeat(22)}`).success).toBe(false);
  });

  test("accepts one normalized primary verified contact", () => {
    expect(PrimaryVerifiedEmailSchema.safeParse({
      normalizedEmail: "alex@example.com",
      source: "google-oidc",
      verifiedAt: 1,
    }).success).toBe(true);
    expect(PrimaryVerifiedEmailSchema.safeParse({
      normalizedEmail: " Alex@Example.com ",
      source: "google-oidc",
      verifiedAt: 1,
    }).success).toBe(false);
  });

  test("keeps exact external identity details separate from Account contact data", () => {
    expect(ExternalIdentityDetailSchema.safeParse({
      externalIdentityId: "ext_google_alex",
      provider: "google",
      accountHint: "a***@example.com",
      linkedAt: 1,
      lastAuthenticatedAt: 2,
      currentLogin: true,
      issuer: "https://accounts.google.com",
      subject: "104891",
    }).success).toBe(true);
  });

  test("rejects duplicate or unknown platform authorities", () => {
    const base = {
      accountId,
      displayName: "Alex Morgan",
      primaryVerifiedEmail: null,
      avatar: { kind: "fallback" as const, initials: "AM", colorIndex: 2 },
      blockedAt: null,
      identities: [],
    };
    expect(AccountSelfSchema.safeParse({
      ...base,
      platformAuthorities: ["platform.admin", "apps.create"],
    }).success).toBe(true);
    expect(AccountSelfSchema.safeParse({
      ...base,
      platformAuthorities: ["apps.create", "apps.create"],
    }).success).toBe(false);
    expect(AccountSelfSchema.safeParse({
      ...base,
      platformAuthorities: ["owner"],
    }).success).toBe(false);
  });

  test("models each authority as one Account-keyed child row", () => {
    expect(AccountPlatformAuthoritySchema.safeParse({
      accountId,
      authority: "platform.admin",
      grantedAt: 1,
    }).success).toBe(true);
  });
});
import { describe, expect, test } from "vitest";
import {
  AccountIdSchema,
  AccountPlatformAuthoritySchema,
  AccountSelfSchema,
  AppAdminMeResponseSchema,
  ExternalIdentityDetailSchema,
  PrimaryVerifiedEmailSchema,
  PlatformAccountDetailSchema,
  PlatformAccountAuditEventSchema,
} from "../src/index.js";

const accountId = `acct_${"a".repeat(22)}`;

describe("Account protocol model", () => {
  test("accepts only Account-based current administrator responses", () => {
    const authenticatedIdentity = {
      externalIdentityId: "ext-google", provider: "google", accountHint: null,
      linkedAt: 1, lastAuthenticatedAt: 2, currentLogin: true,
    };
    const response = {
      account: {
        accountId, displayName: "Alex", primaryVerifiedEmail: null,
        avatar: { kind: "fallback", initials: "AL", colorIndex: 1 },
        blockedAt: null, platformAuthorities: ["apps.create"],
        identities: [authenticatedIdentity], linkableProviders: [],
      },
      authenticatedIdentity,
      memberships: [],
    };
    expect(AppAdminMeResponseSchema.safeParse(response).success).toBe(true);
    for (const alias of ["identity", "principal", "profile", "platformAccess", "accountMemberships"]) {
      expect(AppAdminMeResponseSchema.safeParse({ ...response, [alias]: {} }).success).toBe(false);
    }
    expect(AppAdminMeResponseSchema.safeParse({
      ...response, authenticatedIdentity: { ...authenticatedIdentity, issuer: "https://issuer.example", subject: "private" },
    }).success).toBe(false);
  });

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

  test("carries a stable server-selected fallback with image avatars", () => {
    expect(AccountSelfSchema.safeParse({
      accountId,
      displayName: "Alex Morgan",
      primaryVerifiedEmail: null,
      avatar: { kind: "image", url: "https://images.example/avatar", initials: "AM", colorIndex: 2 },
      blockedAt: null,
      platformAuthorities: [],
      identities: [],
      linkableProviders: [],
    }).success).toBe(true);
    expect(AccountSelfSchema.safeParse({
      accountId,
      displayName: "Alex Morgan",
      primaryVerifiedEmail: null,
      avatar: { kind: "image", url: "https://images.example/avatar" },
      blockedAt: null,
      platformAuthorities: [],
      identities: [],
      linkableProviders: [],
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
      linkableProviders: ["google", "microsoft", "github"] as const,
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

  test("projects platform Accounts without Principal identity fields", () => {
    const detail = {
      accountId,
      displayName: "Alex Morgan",
      primaryVerifiedEmail: null,
      avatar: { kind: "fallback", initials: "AM", colorIndex: 2 },
      blockedAt: null,
      platformAuthorities: ["platform.admin"],
      createdAt: 1,
      updatedAt: 2,
      effectiveAccess: "active",
      appMembershipCount: 0,
      lastActiveAt: 2,
      memberships: [],
    };
    expect(PlatformAccountDetailSchema.safeParse(detail).success).toBe(true);
    expect(PlatformAccountDetailSchema.safeParse({
      ...detail,
      principalRef: "principal-1",
      principal: { issuer: "https://issuer.example", subject: "subject-1" },
    }).success).toBe(false);
  });

  test("keeps privileged audit identity detail subordinate to the actor Account", () => {
    const event = {
      eventId: "event-1",
      action: "platform_access.blocked",
      actorAccount: {
        accountId,
        displayName: "Alex Morgan",
        primaryVerifiedEmail: null,
        avatar: { kind: "fallback", initials: "AM", colorIndex: 2 },
      },
      authenticatedIdentity: {
        externalIdentityId: "ext-google-alex",
        provider: "google",
        accountHint: null,
        linkedAt: 1,
        lastAuthenticatedAt: 2,
        currentLogin: false,
        issuer: "https://accounts.google.com",
        subject: "104891",
      },
      targetAccount: null,
      targetInvitationId: null,
      result: "succeeded",
      requestId: null,
      createdAt: 2,
      details: {},
    };
    expect(PlatformAccountAuditEventSchema.safeParse(event).success).toBe(true);
    expect(PlatformAccountAuditEventSchema.safeParse({
      ...event,
      actorPrincipalRef: "principal-1",
    }).success).toBe(false);
  });
});
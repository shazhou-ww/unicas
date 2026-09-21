import type { ContractRouterClient } from "@orpc/contract";
import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  App,
  AppControlAuditEvent,
  AppMemberInvitation,
  AppMembership,
  AppOAuthIssuer,
  AppUsage,
  Principal,
  Profile,
  SpaceRootRefBalance,
} from "../src/index.js";
import {
  AppControlAuditEventSchema,
  AppMemberInvitationSchema,
  AppMembershipSchema,
  AppOAuthIssuerSchema,
  AppSchema,
  AppUsageSchema,
  PrincipalSchema,
  ProfileSchema,
  PatchAppRequestSchema,
  AppIssuerPreconditionSchema,
  AppOAuthIssuerInspectionSchema,
  SpaceRootRefBalanceSchema,
  appAdminApiContract,
} from "../src/index.js";
import { generateAppAdminOpenApiDocument } from "../scripts/openapi.js";

const methods = ["get", "post", "put", "patch", "delete"] as const;

function operations(document: Awaited<ReturnType<typeof generateAppAdminOpenApiDocument>>) {
  return Object.values(document.paths ?? {}).flatMap((item) =>
    methods.flatMap((method) => {
      const operation = item?.[method];
      return operation === undefined ? [] : [operation];
    }),
  );
}

describe("CAS admin schemas", () => {
  test("distinguishes issuer activation preconditions and rejects full inspection echoes", () => {
    expect(AppIssuerPreconditionSchema.safeParse({ "if-none-match": "*" }).success).toBe(true);
    expect(AppIssuerPreconditionSchema.safeParse({ "if-match": '"4"' }).success).toBe(true);
    for (const headers of [{}, { "if-match": '"4"', "if-none-match": "*" }, { "if-match": "4" }]) {
      expect(AppIssuerPreconditionSchema.safeParse(headers).success).toBe(false);
    }
    const receipt = { inspectionId: "candidate", metadataUrl: "https://issuer.example/metadata", jwksUri: "https://issuer.example/jwks", challenge: "synthetic", expiresAt: 1000, keys: [{ kid: "key", algorithm: "ES256" }] };
    expect(AppOAuthIssuerInspectionSchema.safeParse(receipt).success).toBe(true);
    expect(AppOAuthIssuerInspectionSchema.safeParse({ ...receipt, revision: 1, appId: "app" }).success).toBe(false);
  });
  test("validates strict nonempty App status patches", () => {
    for (const status of ["active", "suspended"]) {
      expect(PatchAppRequestSchema.safeParse({ status }).success).toBe(true);
    }
    for (const body of [{}, { status: "inactive" }, { status: null }, { unknown: true }, { status: "active", unknown: true }]) {
      expect(PatchAppRequestSchema.safeParse(body).success).toBe(false);
    }
  });
  test("keeps v2 Principal identity separate from Profile metadata", () => {
    const principal: Principal = { issuer: "https://issuer.example", subject: "subject-1" };
    const profile: Profile = { displayName: "Operator", emailForDisplay: "operator@example.com" };
    const app: App = {
      appId: "app-1",
      displayName: "App 1",
      description: "",
      status: "active",
      createdAt: 1,
      revision: 1,
    };
    const membership: AppMembership = {
      appId: app.appId,
      account: {
        accountId: `acct_${"a".repeat(22)}`,
        displayName: profile.displayName,
        primaryVerifiedEmail: null,
        avatar: { kind: "fallback", initials: "AU", colorIndex: 1 },
      },
    };

    expect(PrincipalSchema.safeParse(principal).success).toBe(true);
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(AppSchema.safeParse(app).success).toBe(true);
    expect(AppMembershipSchema.safeParse(membership).success).toBe(true);
    expect(AppMembershipSchema.safeParse({ ...membership, principal, profile }).success).toBe(false);
    expect(PrincipalSchema.safeParse({
      identityIssuer: principal.issuer,
      subject: principal.subject,
    }).success).toBe(false);
    expect(AppSchema.safeParse({ ...app, appId: undefined, stackId: "stack-1" }).success).toBe(false);
  });

  test("defines App-scoped invitations and core administrator operations", () => {
    const invitation: AppMemberInvitation = {
      invitationId: "invitation-1",
      appId: "app-1",
      status: "pending",
      emailConstraint: null,
      expiresAt: 2,
      createdAt: 1,
      revision: 1,
    };
    expect(AppMemberInvitationSchema.safeParse(invitation).success).toBe(true);
    expect(AppMemberInvitationSchema.safeParse({
      ...invitation,
      appId: undefined,
      stackId: "stack-1",
    }).success).toBe(false);

    type Client = ContractRouterClient<typeof appAdminApiContract>;
    type AppResult = Awaited<ReturnType<Client["apps"]["get"]>>;
    type UsageResult = Awaited<ReturnType<Client["apps"]["getUsage"]>>;
    type MeResult = Awaited<ReturnType<Client["identity"]["me"]>>;
    expectTypeOf<AppResult>().toEqualTypeOf<App>();
    expectTypeOf<UsageResult>().toEqualTypeOf<AppUsage>();
    expectTypeOf<MeResult["account"]>().toEqualTypeOf<import("../src/index.js").AccountSelf>();
    expectTypeOf<MeResult["authenticatedIdentity"]>().toEqualTypeOf<import("../src/index.js").ExternalIdentitySummary>();
    expectTypeOf<keyof MeResult>().toEqualTypeOf<"account" | "authenticatedIdentity" | "memberships">();

    expect(Object.keys(appAdminApiContract.apps)).toHaveLength(5);
    expect(Object.keys(appAdminApiContract.members)).toHaveLength(7);
  });

  test("validates nonnegative aggregate App usage", () => {
    const usage: AppUsage = {
      nodeCount: 3,
      readyContentBytes: 30,
      readyStoredBytes: 24,
      reservedBytes: 5,
      notReadyNodeCount: 1,
      leasedNodeCount: 2,
    };
    expect(AppUsageSchema.safeParse(usage).success).toBe(true);
    expect(AppUsageSchema.safeParse({ ...usage, readyStoredBytes: -1 }).success).toBe(false);
    expect(AppUsageSchema.safeParse({ ...usage, spaceId: "space-1" }).success).toBe(false);
  });

  test("defines issuer and audit resources for the complete App contract", () => {
    const issuer: AppOAuthIssuer = {
      appId: "app-1",
      issuer: "https://issuer.example",
      audience: "https://api.unicas.work/v1/apps/app-1",
      metadataUrl: "https://issuer.example/.well-known/oauth-authorization-server",
      metadataType: "oauth",
      authorizationEndpoint: "https://issuer.example/authorize",
      tokenEndpoint: "https://issuer.example/token",
      jwksUri: "https://issuer.example/jwks",
      registrationEndpoint: null,
      scopesSupported: [],
      codeChallengeMethodsSupported: ["S256"],
      status: "active",
      verifiedAt: 1,
      lastRefreshAt: 1,
      lastRefreshError: null,
      jwksDigest: "digest",
      capabilityMaxLifetimeSeconds: 300,
      revision: 1,
    };
    const auditEvent: AppControlAuditEvent = {
      eventId: "event-1",
      appId: "app-1",
      actorAccount: {
        accountId: `acct_${"a".repeat(22)}`,
        displayName: "Operator",
        primaryVerifiedEmail: null,
        avatar: { kind: "fallback", initials: "OP", colorIndex: 1 },
      },
      authenticatedIdentity: {
        externalIdentityId: "ext-1",
        provider: "google",
        accountHint: null,
        linkedAt: 1,
        lastAuthenticatedAt: 1,
        currentLogin: false,
        issuer: "https://accounts.example",
        subject: "subject-1",
      },
      targetAccount: null,
      action: "app.updated",
      target: "apps/app-1",
      requestId: null,
      traceId: null,
      caller: null,
      createdAt: 1,
    };
    const balance: SpaceRootRefBalance = {
      spaceId: "space-1",
      hash: "a".repeat(64),
      count: 1,
    };

    expect(AppOAuthIssuerSchema.safeParse(issuer).success).toBe(true);
    expect(AppControlAuditEventSchema.safeParse(auditEvent).success).toBe(true);
    expect(AppControlAuditEventSchema.safeParse({
      ...auditEvent,
      actor: { issuer: "https://accounts.example", subject: "subject-1" },
    }).success).toBe(false);
    expect(SpaceRootRefBalanceSchema.safeParse(balance).success).toBe(true);
    const operationCount = Object.values(appAdminApiContract)
      .reduce((count, group) => count + Object.keys(group).length, 0);
    expect(operationCount).toBe(35);
  });
});

describe("App admin OpenAPI", () => {
  test("generates a separate complete App administrator document", async () => {
    const document = await generateAppAdminOpenApiDocument();
    const allOperations = operations(document);
    const serialized = JSON.stringify(document);
    expect(Object.keys(document.paths ?? {})).toHaveLength(27);
    expect(allOperations).toHaveLength(35);
    expect(document.paths?.["/admin/account"]?.get?.operationId).toBe("getCurrentAccount");
    expect(document.paths?.["/admin/account/profile"]?.patch?.operationId).toBe("patchCurrentAccountProfile");
    expect(document.paths?.["/admin/account/identities"]?.get?.operationId).toBe("listCurrentAccountIdentities");
    expect(document.paths?.["/admin/apps/{appId}/people"]?.get).toBeDefined();
    expect(document.paths?.["/admin/platform/people"]?.get).toBeDefined();
    expect(document.paths?.["/admin/platform/access-summary"]).toBeUndefined();
    expect(document.paths?.["/admin/platform/accounts"]?.get).toBeDefined();
    expect(document.paths?.["/admin/platform/accounts/{accountId}"]?.get).toBeDefined();
    expect(document.paths?.["/admin/platform/accounts/{accountId}/authorities/{authority}"]?.put).toBeDefined();
    expect(document.paths?.["/admin/platform/accounts/{accountId}/authorities/{authority}"]?.delete).toBeDefined();
    expect(document.paths?.["/admin/platform/accounts/{accountId}/block"]?.put).toBeDefined();
    expect(document.paths?.["/admin/platform/accounts/{accountId}/block"]?.delete).toBeDefined();
    expect(document.paths?.["/admin/platform/principals"]).toBeUndefined();
    expect(document.paths?.["/admin/platform/invitations"]?.get).toBeDefined();
    expect(document.paths?.["/admin/platform/invitations"]?.post).toBeDefined();
    expect(document.paths?.["/admin/platform/invitations/{invitationId}"]?.delete).toBeDefined();
    expect(document.paths?.["/admin/platform-invitations/{token}/accept"]?.post).toBeDefined();
    expect(document.paths?.["/admin/platform/audit-events"]?.get).toBeDefined();
    const appAuditParameters = document.paths?.["/admin/apps/{appId}/audit-events"]?.get?.parameters ?? [];
    expect(JSON.stringify(appAuditParameters)).toContain("actorAccountId");
    expect(JSON.stringify(appAuditParameters)).toContain("targetAccountId");
    const platformAuditParameters = document.paths?.["/admin/platform/audit-events"]?.get?.parameters ?? [];
    expect(JSON.stringify(platformAuditParameters)).toContain("actorAccountId");
    expect(JSON.stringify(platformAuditParameters)).not.toContain("actorPrincipalRef");
    expect(document.paths?.["/admin/apps/{appId}/member-invitations"]?.get?.operationId).toBe("listAppMemberInvitations");
    const revoke = document.paths?.["/admin/apps/{appId}/member-invitations/{invitationId}"]?.delete;
    expect(revoke?.responses?.["204"]).toHaveProperty("headers.ETag.required", true);
    expect(revoke?.responses?.["204"]).not.toHaveProperty("content");
    expect(revoke?.responses).toHaveProperty("412");
    expect(document.paths?.["/admin/apps/{appId}"]?.get).toHaveProperty("operationId", "getApp");
    expect(document.paths?.["/admin/apps/{appId}/usage"]?.get).toHaveProperty("operationId", "getAppUsage");
    const patch = document.paths?.["/admin/apps/{appId}"]?.patch;
    expect(patch?.responses?.["204"]).toHaveProperty("headers.ETag.required", true);
    expect(patch?.responses?.["204"]).not.toHaveProperty("content");
    expect(patch?.responses).not.toHaveProperty("200");
    const activate = document.paths?.["/admin/apps/{appId}/oauth-issuer"]?.put;
    expect(activate?.responses?.["204"]).toHaveProperty("headers.ETag.required", true);
    expect(activate?.responses?.["204"]).not.toHaveProperty("content");
    expect(document.paths?.["/admin/apps/{appId}/managed-capabilities"]).toBeUndefined();
    expect(serialized).not.toMatch(/stackId|tenantId|Stack|Tenant/);
  });

});
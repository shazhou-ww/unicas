import type { ContractRouterClient } from "@orpc/contract";
import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  App,
  AppControlAuditEvent,
  AppMemberInvitation,
  AppMembership,
  AppOAuthIssuer,
  CasStack,
  ManagedSpaceCapability,
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
  CasStackSchema,
  PrincipalSchema,
  ProfileSchema,
  PatchAppRequestSchema,
  ManagedSpaceCapabilitySchema,
  SpaceRootRefBalanceSchema,
  appAdminApiContract,
  casAdminApiContract,
} from "../src/index.js";
import { generateAdminOpenApiDocument, generateAppAdminOpenApiDocument } from "../scripts/openapi.js";

const methods = ["get", "post", "put", "patch", "delete"] as const;

function operations(document: Awaited<ReturnType<typeof generateAdminOpenApiDocument>>) {
  return Object.values(document.paths ?? {}).flatMap((item) =>
    methods.flatMap((method) => {
      const operation = item?.[method];
      return operation === undefined ? [] : [operation];
    }),
  );
}

describe("CAS admin schemas", () => {
  test("validates strict nonempty App status patches", () => {
    for (const status of ["active", "suspended"]) {
      expect(PatchAppRequestSchema.safeParse({ status }).success).toBe(true);
    }
    for (const body of [{}, { status: "inactive" }, { status: null }, { unknown: true }, { status: "active", unknown: true }]) {
      expect(PatchAppRequestSchema.safeParse(body).success).toBe(false);
    }
  });
  test("validates stack wire records", () => {
    expect(CasStackSchema.safeParse({
      stackId: "stack-1",
      displayName: "Stack 1",
      description: "",
      status: "active",
      createdAt: 1,
      revision: 1,
    }).success).toBe(true);
  });

  test("exposes a client type derived from the contract", () => {
    type Client = ContractRouterClient<typeof casAdminApiContract>;
    type Stack = Awaited<ReturnType<Client["stacks"]["get"]>>;
    expectTypeOf<Stack>().toEqualTypeOf<CasStack>();
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
    const membership: AppMembership = { appId: app.appId, principal, profile };

    expect(PrincipalSchema.safeParse(principal).success).toBe(true);
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(AppSchema.safeParse(app).success).toBe(true);
    expect(AppMembershipSchema.safeParse(membership).success).toBe(true);
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
    type MeResult = Awaited<ReturnType<Client["identity"]["me"]>>;
    expectTypeOf<AppResult>().toEqualTypeOf<App>();
    expectTypeOf<MeResult["principal"]>().toEqualTypeOf<Principal>();
    expectTypeOf<MeResult["profile"]>().toEqualTypeOf<Profile>();

    expect(Object.keys(appAdminApiContract.apps)).toHaveLength(4);
    expect(Object.keys(appAdminApiContract.members)).toHaveLength(4);
  });

  test("defines issuer, capability, and audit resources for the complete App contract", () => {
    const issuer: AppOAuthIssuer = {
      appId: "app-1",
      mode: "managed",
      issuer: "https://issuer.example",
      audience: "https://api.unicas.work/v2/apps/app-1",
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
    const capability: ManagedSpaceCapability = {
      accessToken: "secret",
      tokenType: "Bearer",
      expiresIn: 300,
      expiresAt: 301,
      issuer: issuer.issuer,
      audience: issuer.audience,
      spaceId: "space-1",
      permissions: ["spaces:space-1:cas:read"],
    };
    const auditEvent: AppControlAuditEvent = {
      eventId: "event-1",
      appId: "app-1",
      actor: { issuer: "https://accounts.example", subject: "subject-1" },
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
    expect(ManagedSpaceCapabilitySchema.safeParse(capability).success).toBe(true);
    expect(AppControlAuditEventSchema.safeParse(auditEvent).success).toBe(true);
    expect(SpaceRootRefBalanceSchema.safeParse(balance).success).toBe(true);
    const operationCount = Object.values(appAdminApiContract)
      .reduce((count, group) => count + Object.keys(group).length, 0);
    expect(operationCount).toBe(23);
  });
});

describe("CAS admin OpenAPI", () => {
  test("describes every control-plane operation", async () => {
    const document = await generateAdminOpenApiDocument();
    const allOperations = operations(document);

    expect(document.openapi).toBe("3.1.1");
    expect(Object.keys(document.paths ?? {})).toHaveLength(16);
    expect(allOperations).toHaveLength(23);
    expect(new Set(allOperations.map((operation) => operation.operationId)).size).toBe(23);
    expect(document.security).toEqual([{ adminSession: [] }]);
    expect(document.info.description).toContain("## Concurrency and idempotency");
    expect(document.info.description).toContain("## OAuth issuer activation");
    expect(document.paths?.["/admin/stacks/{stackId}/oauth-issuer/inspections"]?.post?.description)
      .toContain("activation challenge");
    expect(document.paths?.["/admin/stacks/{stackId}"]?.get)
      .toHaveProperty("responses.200.content.application/json.schema.properties.revision.description");
  });

  test("generates a separate complete App administrator document", async () => {
    const document = await generateAppAdminOpenApiDocument();
    const allOperations = operations(document);
    const serialized = JSON.stringify(document);
    expect(Object.keys(document.paths ?? {})).toHaveLength(16);
    expect(allOperations).toHaveLength(23);
    expect(document.paths?.["/admin/apps/{appId}"]?.get).toHaveProperty("operationId", "getApp");
    const patch = document.paths?.["/admin/apps/{appId}"]?.patch;
    expect(patch?.responses?.["204"]).toHaveProperty("headers.ETag.required", true);
    expect(patch?.responses?.["204"]).not.toHaveProperty("content");
    expect(patch?.responses).not.toHaveProperty("200");
    expect(serialized).not.toMatch(/stackId|tenantId|Stack|Tenant/);
  });

  test("documents optimistic concurrency", async () => {
    const document = await generateAdminOpenApiDocument();
    const patch = document.paths?.["/admin/stacks/{stackId}"]?.patch;
    const parameterNames = (patch?.parameters ?? []).map((parameter) =>
      "$ref" in parameter ? parameter.$ref : parameter.name,
    );
    expect(parameterNames).toContain("if-match");
    expect(patch?.responses).toHaveProperty("412");
    expect(patch?.responses).toHaveProperty("428");
  });
});
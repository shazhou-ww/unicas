import { oc } from "@orpc/contract";
import { z } from "zod";
import { AppIdSchema } from "@unicas/tenant-protocol";
import { AppPeopleQuerySchema, PlatformPeopleQuerySchema } from "./people.js";
import {
  AppControlAuditEventSchema,
  AppMemberInvitationSchema,
  AppMembershipSchema,
  AppOAuthIssuerInspectionSchema,
  AppOAuthIssuerSchema,
  AppRefDomainSchema,
  AppSchema,
  CasHashSchema,
  CasPlaygroundFileRootSchema,
  ManagedSpaceCapabilitySchema,
  PrincipalSchema,
  ProfileSchema,
  SpaceRootRefBalanceSchema,
  SpaceRootRefEventSchema,
} from "./schemas.js";
import {
  CreatePlatformInvitationSchema,
  PlatformAuditActionSchema,
  PlatformAuditQuerySchema,
  PlatformAuthoritySchema,
  PlatformInvitationQuerySchema,
  PlatformPrincipalQuerySchema,
  PatchPlatformAccessSchema,
} from "./platform-access.js";

export const AppAdminApiBasePath = "/admin/apps";

const ErrorDataSchema = z.object({ message: z.string().optional() }).readonly();
const error = (status: number, message: string) => ({ status, message, data: ErrorDataSchema });

export const AppAdminApiErrorMap = {
  ADMIN_AUTH_REQUIRED: error(401, "Administrator authentication is required"),
  PLATFORM_ACCESS_REQUIRED: error(403, "Current platform access is required"),
  PLATFORM_ADMIN_REQUIRED: error(403, "Platform administrator authority is required"),
  APP_CREATION_AUTHORITY_REQUIRED: error(403, "App creation authority is required"),
  LAST_PLATFORM_ADMIN: error(409, "The final active Platform Admin cannot be removed"),
  SELF_BLOCK_FORBIDDEN: error(409, "A Platform Admin cannot block their own Principal"),
  INVITATION_SESSION_REQUIRED: error(403, "A matching invitation session is required"),
  APP_MEMBERSHIP_REQUIRED: error(403, "App membership is required"),
  APP_SUSPENDED: error(403, "App is suspended"),
  INVITATION_NOT_PENDING: error(409, "Invitation is accepted, expired, or revoked"),
  NOT_FOUND: error(404, "The requested control-plane resource was not found"),
  LAST_MEMBER: error(409, "The final App member cannot be removed"),
  RATE_LIMITED: error(429, "The control-plane request was rate limited"),
  SERVICE_UNAVAILABLE: error(503, "The control-plane service is unavailable"),
  PRECONDITION_REQUIRED: error(428, "An If-Match precondition is required"),
  REVISION_MISMATCH: error(412, "The If-Match revision does not match"),
  IDEMPOTENCY_CONFLICT: error(409, "The idempotency key was reused with another request"),
  INVALID_CURSOR: error(400, "The pagination cursor is invalid"),
  ISSUER_CONFLICT: error(409, "The OAuth issuer conflicts with current state"),
  ROOT_REF_SNAPSHOT_CHANGED: error(409, "The Root Ref snapshot changed during pagination"),
  INVALID_REQUEST: error(400, "The control-plane request is invalid"),
} as const;

const appProcedure = oc.errors(AppAdminApiErrorMap);
const RevisionSchema = z.number().int().nonnegative()
  .describe("Exact current resource revision used as the If-Match precondition.");
const appParams = z.object({ appId: AppIdSchema }).readonly();
const pageQuery = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().min(1).optional(),
}).readonly();
const createHeaders = z.object({
  "idempotency-key": z.string().min(1).optional(),
}).readonly();
const mutationHeaders = z.object({ "if-match": RevisionSchema }).readonly();
const rootDomainParams = appParams.unwrap().extend({
  refDomain: z.string().min(1),
}).readonly();

export const PatchAppRequestSchema = z.object({
  displayName: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "suspended"]).optional(),
}).strict().refine(body => Object.values(body).some(value => value !== undefined), {
  message: "At least one change is required",
}).readonly().meta({ id: "PatchAppRequest" });

function pageSchema(item: z.ZodType) {
  return z.object({
    items: z.array(item).readonly(),
    nextCursor: z.string().min(1).nullable(),
  }).readonly();
}

export const appMeContract = appProcedure
  .route({
    method: "GET",
    path: "/admin/me",
    operationId: "getCurrentPrincipal",
    summary: "Read the current administrator",
    description: "Returns immutable Principal identity, non-authoritative Profile metadata, and visible App memberships.",
    inputStructure: "detailed",
    tags: ["Identity"],
  })
  .input(z.object({}).readonly())
  .output(z.object({
    principal: PrincipalSchema,
    profile: ProfileSchema,
    platformAccess: z.object({
      principalRef: z.string().min(1),
      status: z.literal("active"),
      authorities: z.array(PlatformAuthoritySchema).readonly(),
      revision: z.number().int().positive(),
    }).readonly(),
    memberships: z.array(AppMembershipSchema).readonly(),
  }).readonly().meta({ id: "AppAdminMeResponse" }));

export const listAppsContract = appProcedure
  .route({
    method: "GET",
    path: AppAdminApiBasePath,
    operationId: "listApps",
    summary: "List Apps",
    description: "Lists Apps visible to the authenticated Principal using snapshot-bound pagination.",
    inputStructure: "detailed",
    tags: ["Apps"],
  })
  .input(z.object({ query: pageQuery.optional() }).readonly())
  .output(pageSchema(AppSchema).meta({ id: "AppAdminListAppsResponse" }));

export const createAppContract = appProcedure
  .route({
    method: "POST",
    path: AppAdminApiBasePath,
    operationId: "createApp",
    summary: "Create an App",
    description: "Creates an App and grants the current Principal equal administrator membership.",
    inputStructure: "detailed",
    outputStructure: "detailed",
    successStatus: 201,
    tags: ["Apps"],
  })
  .input(z.object({
    headers: createHeaders.optional(),
    body: z.object({ displayName: z.string().min(1) }).readonly(),
  }).readonly())
  .output(z.object({
    headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly(),
    body: z.object({ appId: AppIdSchema }).readonly(),
  }).readonly().meta({ id: "AppAdminCreateAppResponse" }));

export const getAppContract = appProcedure
  .route({
    method: "GET",
    path: `${AppAdminApiBasePath}/{appId}`,
    operationId: "getApp",
    summary: "Read an App",
    description: "Returns the selected App when the current Principal is a member.",
    inputStructure: "detailed",
    tags: ["Apps"],
  })
  .input(z.object({ params: appParams }).readonly())
  .output(AppSchema);

export const patchAppContract = appProcedure
  .route({
    method: "PATCH",
    path: `${AppAdminApiBasePath}/{appId}`,
    operationId: "patchApp",
    summary: "Update, suspend, or restore an App",
    description: "Conditionally updates App metadata or status. Returns no body and the resulting App revision in ETag. Same-value updates with a current precondition are successful no-ops.",
    inputStructure: "detailed",
    outputStructure: "detailed",
    successStatus: 204,
    tags: ["Apps"],
  })
  .input(z.object({
    params: appParams,
    headers: mutationHeaders,
    body: PatchAppRequestSchema,
  }).readonly())
  .output(z.object({
    headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly(),
  }).readonly());

export const listAppMembersContract = appProcedure
  .route({
    method: "GET",
    path: `${AppAdminApiBasePath}/{appId}/members`,
    operationId: "listAppMembers",
    summary: "List App members",
    description: "Lists equal-authority App administrators with Principal and Profile kept separate.",
    inputStructure: "detailed",
    tags: ["Members"],
  })
  .input(z.object({ params: appParams, query: pageQuery.optional() }).readonly())
  .output(pageSchema(AppMembershipSchema).meta({ id: "AppAdminListMembersResponse" }));

export const deleteAppMemberContract = appProcedure
  .route({
    method: "DELETE",
    path: `${AppAdminApiBasePath}/{appId}/members`,
    operationId: "deleteAppMember",
    summary: "Remove an App member",
    description: "Removes the member selected by exact Principal issuer and subject.",
    inputStructure: "detailed",
    tags: ["Members"],
  })
  .input(z.object({ params: appParams, headers: mutationHeaders, query: PrincipalSchema }).readonly())
  .output(z.object({ ok: z.literal(true) }).readonly());

export const createAppMemberInvitationContract = appProcedure
  .route({
    method: "POST",
    path: `${AppAdminApiBasePath}/{appId}/member-invitations`,
    operationId: "createAppMemberInvitation",
    summary: "Create an App member invitation",
    description: "Creates a short-lived single-use invitation for equal App administrator membership.",
    inputStructure: "detailed",
    outputStructure: "detailed",
    successStatus: 201,
    tags: ["Members"],
  })
  .input(z.object({
    params: appParams,
    headers: createHeaders.optional(),
    body: z.object({ emailConstraint: z.string().optional() }).readonly().optional(),
  }).readonly())
  .output(z.object({
    headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly(),
    body: z.object({ invitationId: z.string().min(1), acceptUrl: z.url(), expiresAt: z.number().int().nonnegative() }).readonly(),
  }).readonly().meta({ id: "AppAdminCreateMemberInvitationResponse" }));

export const AppInvitationQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "expired", "revoked"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().min(1).optional(),
}).strict().readonly();

export const listAppMemberInvitationsContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/member-invitations`, operationId: "listAppMemberInvitations", summary: "List App member invitations", description: "Snapshot-bound invitation history with lifecycle filtering and no bearer data. Requires current App membership.", inputStructure: "detailed", tags: ["Members"] })
  .input(z.object({ params: appParams, query: AppInvitationQuerySchema.optional() }).readonly())
  .output(pageSchema(AppMemberInvitationSchema).meta({ id: "AppMemberInvitationPage" }));

export const revokeAppMemberInvitationContract = appProcedure
  .route({ method: "DELETE", path: `${AppAdminApiBasePath}/{appId}/member-invitations/{invitationId}`, operationId: "revokeAppMemberInvitation", summary: "Revoke an App member invitation", description: "Conditionally revokes pending unexpired invitations while retaining audit history. A current revoked ETag is a no-op; a stale ETag fails.", inputStructure: "detailed", outputStructure: "detailed", successStatus: 204, tags: ["Members"] })
  .input(z.object({ params: appParams.unwrap().extend({ invitationId: z.string().min(1) }).readonly(), headers: mutationHeaders }).readonly())
  .output(z.object({ headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly() }).readonly());

export const acceptAppMemberInvitationContract = appProcedure
  .route({
    method: "POST",
    path: "/admin/member-invitations/{token}/accept",
    operationId: "acceptAppMemberInvitation",
    summary: "Accept an App member invitation",
    description: "Consumes a valid invitation for the authenticated Principal.",
    inputStructure: "detailed",
    tags: ["Members"],
  })
  .input(z.object({
    params: z.object({ token: z.string().min(1) }).readonly(),
  }).readonly())
  .output(z.object({ appId: AppIdSchema }).readonly());

export const listAppPlaygroundFileRootsContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/playground/file-roots`, operationId: "listAppPlaygroundFileRoots", summary: "List Playground file roots", inputStructure: "detailed", tags: ["Playground"] })
  .input(z.object({ params: appParams }).readonly())
  .output(z.object({ items: z.array(CasPlaygroundFileRootSchema).readonly() }).readonly());

export const createAppPlaygroundFileRootContract = appProcedure
  .route({ method: "POST", path: `${AppAdminApiBasePath}/{appId}/playground/file-roots`, operationId: "createAppPlaygroundFileRoot", summary: "Create a Playground file root", inputStructure: "detailed", successStatus: 201, tags: ["Playground"] })
  .input(z.object({ params: appParams, body: z.object({ rootId: z.string().min(1), name: z.string().min(1), manifestHash: CasHashSchema }).readonly() }).readonly())
  .output(CasPlaygroundFileRootSchema);

export const patchAppPlaygroundFileRootContract = appProcedure
  .route({ method: "PATCH", path: `${AppAdminApiBasePath}/{appId}/playground/file-roots/{rootId}`, operationId: "patchAppPlaygroundFileRoot", summary: "Update a Playground file root", inputStructure: "detailed", tags: ["Playground"] })
  .input(z.object({ params: appParams.unwrap().extend({ rootId: z.string().min(1) }).readonly(), headers: mutationHeaders, body: z.object({ name: z.string().min(1), manifestHash: CasHashSchema }).readonly() }).readonly())
  .output(CasPlaygroundFileRootSchema);

export const deleteAppPlaygroundFileRootContract = appProcedure
  .route({ method: "DELETE", path: `${AppAdminApiBasePath}/{appId}/playground/file-roots/{rootId}`, operationId: "deleteAppPlaygroundFileRoot", summary: "Delete a Playground file root", inputStructure: "detailed", tags: ["Playground"] })
  .input(z.object({ params: appParams.unwrap().extend({ rootId: z.string().min(1) }).readonly(), headers: mutationHeaders }).readonly())
  .output(z.object({ ok: z.literal(true) }).readonly());

export const getAppOAuthIssuerContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/oauth-issuer`, operationId: "getAppOAuthIssuer", summary: "Read the App OAuth issuer", inputStructure: "detailed", tags: ["OAuth Issuer"] })
  .input(z.object({ params: appParams, query: z.object({ optional: z.boolean().optional() }).readonly().optional() }).readonly())
  .output(AppOAuthIssuerSchema.nullable());

export const InspectAppIssuerRequestSchema = z.object({ issuer: z.url() }).strict().readonly();
export const ActivateAppIssuerRequestSchema = z.object({ inspectionId: z.string().min(1), activationProof: z.string().min(1) }).strict().readonly();
export const AppIssuerPreconditionSchema = z.object({
  "if-match": z.string().regex(/^"(0|[1-9][0-9]*)"$/).optional(),
  "if-none-match": z.literal("*").optional(),
}).refine(headers => (headers["if-match"] !== undefined) !== (headers["if-none-match"] !== undefined)).readonly();

export const inspectAppOAuthIssuerContract = appProcedure
  .route({ method: "POST", path: `${AppAdminApiBasePath}/{appId}/oauth-issuer/inspections`, operationId: "inspectAppOAuthIssuer", summary: "Inspect an App OAuth issuer", inputStructure: "detailed", successStatus: 201, tags: ["OAuth Issuer"] })
  .input(z.object({ params: appParams, body: InspectAppIssuerRequestSchema }).readonly())
  .output(AppOAuthIssuerInspectionSchema);

export const activateAppOAuthIssuerContract = appProcedure
  .route({ method: "PUT", path: `${AppAdminApiBasePath}/{appId}/oauth-issuer`, operationId: "activateAppOAuthIssuer", summary: "Activate or replace an App OAuth issuer", description: "Use exactly one precondition: If-None-Match: * for initial activation or the current external issuer If-Match ETag for replacement. A verified candidate is selected atomically; current authority is unchanged until success.", inputStructure: "detailed", outputStructure: "detailed", successStatus: 204, tags: ["OAuth Issuer"] })
  .input(z.object({ params: appParams, headers: AppIssuerPreconditionSchema, body: ActivateAppIssuerRequestSchema }).readonly())
  .output(z.object({ headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly() }).readonly());

export const getAppManagedIssuerContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/managed-issuer`, operationId: "getAppManagedIssuer", summary: "Read the managed App issuer", inputStructure: "detailed", tags: ["Managed Issuer"] })
  .input(z.object({ params: appParams }).readonly())
  .output(AppOAuthIssuerSchema);

export const patchAppManagedIssuerContract = appProcedure
  .route({ method: "PATCH", path: `${AppAdminApiBasePath}/{appId}/managed-issuer`, operationId: "patchAppManagedIssuer", summary: "Update the managed App issuer", inputStructure: "detailed", tags: ["Managed Issuer"] })
  .input(z.object({ params: appParams, headers: mutationHeaders, body: z.object({ enabled: z.boolean() }).readonly() }).readonly())
  .output(AppOAuthIssuerSchema);

export const mintManagedSpaceCapabilityContract = appProcedure
  .route({ method: "POST", path: `${AppAdminApiBasePath}/{appId}/managed-capabilities`, operationId: "mintManagedSpaceCapability", summary: "Mint a managed Space capability", inputStructure: "detailed", successStatus: 201, tags: ["Managed Issuer"] })
  .input(z.object({ params: appParams }).readonly())
  .output(ManagedSpaceCapabilitySchema);

export const listAppRefDomainsContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/ref-domains`, operationId: "listAppRefDomains", summary: "List observed refDomains", inputStructure: "detailed", tags: ["Root Ref Audit"] })
  .input(z.object({ params: appParams }).readonly())
  .output(z.object({ domains: z.array(AppRefDomainSchema).readonly() }).readonly());

export const listAppControlAuditEventsContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/audit-events`, operationId: "listAppControlAuditEvents", summary: "List App control audit events", inputStructure: "detailed", tags: ["Audit"] })
  .input(z.object({ params: appParams, query: pageQuery.unwrap().extend({ after: z.string().optional() }).readonly().optional() }).readonly())
  .output(pageSchema(AppControlAuditEventSchema));

export const listSpaceRootDomainRefsContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/root-ref-domains/{refDomain}/refs`, operationId: "listSpaceRootDomainRefs", summary: "List Space Root Ref balances", inputStructure: "detailed", tags: ["Root Ref Audit"] })
  .input(z.object({ params: rootDomainParams, query: z.object({ spaceId: z.string().optional(), limit: z.number().int().positive().optional(), cursor: z.string().optional() }).readonly().optional() }).readonly())
  .output(z.object({ revision: RevisionSchema, refs: z.array(SpaceRootRefBalanceSchema).readonly(), nextCursor: z.string().nullable() }).readonly());

export const listSpaceRootDomainEventsContract = appProcedure
  .route({ method: "GET", path: `${AppAdminApiBasePath}/{appId}/root-ref-domains/{refDomain}/events`, operationId: "listSpaceRootDomainEvents", summary: "List Space Root Ref events", inputStructure: "detailed", tags: ["Root Ref Audit"] })
  .input(z.object({ params: rootDomainParams, query: z.object({ spaceId: z.string().optional(), after: RevisionSchema.optional(), limit: z.number().int().positive().optional() }).readonly().optional() }).readonly())
  .output(z.object({ events: z.array(SpaceRootRefEventSchema).readonly(), latestRevision: RevisionSchema, nextAfter: RevisionSchema }).readonly());

const PlatformInvitationSchema = z.object({
  invitationId: z.string().min(1),
  emailConstraint: z.email().max(254),
  authorities: z.array(PlatformAuthoritySchema).min(1).readonly(),
  status: z.enum(["pending", "accepted", "expired", "revoked"]),
  expiresAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  createdBy: PrincipalSchema,
  revision: RevisionSchema,
}).readonly();

const platformAccessStateShape = {
  principalRef: z.string().min(1),
  principal: PrincipalSchema,
  status: z.enum(["active", "blocked"]),
  authorities: z.array(PlatformAuthoritySchema).readonly(),
  revision: RevisionSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};
const PlatformAccessStateSchema = z.object(platformAccessStateShape).readonly();

const platformPrincipalListItemShape = {
  ...platformAccessStateShape,
  profile: ProfileSchema,
  effectiveAccess: z.enum(["active", "blocked", "no_access"]),
  appMembershipCount: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative().nullable(),
};
const PlatformPrincipalListItemSchema = z.object(platformPrincipalListItemShape).readonly();

export const listAppPeopleContract = appProcedure
  .route({ method: "GET", path: "/admin/apps/{appId}/people", operationId: "listAppPeople", summary: "Search App members and invitations", inputStructure: "detailed", tags: ["Members"] })
  .input(z.object({ params: appParams, query: AppPeopleQuerySchema.optional() }).readonly())
  .output(pageSchema(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("member"), membership: AppMembershipSchema, joinedAt: z.number().int().nonnegative() }).strict(),
    z.object({ kind: z.literal("invitation"), invitation: AppMemberInvitationSchema }).strict(),
  ])).meta({ id: "AppPeoplePage" }));

export const listPlatformPeopleContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/people", operationId: "listPlatformPeople", summary: "Search platform Principals and invitations", inputStructure: "detailed", tags: ["Platform Access"] })
  .input(z.object({ query: PlatformPeopleQuerySchema.optional() }).readonly())
  .output(pageSchema(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("principal"), principal: PlatformPrincipalListItemSchema }).strict(),
    z.object({ kind: z.literal("invitation"), invitation: PlatformInvitationSchema }).strict(),
  ])).meta({ id: "PlatformPeoplePage" }));

const PlatformPrincipalDetailSchema = z.object({
  ...platformPrincipalListItemShape,
  memberships: z.array(AppMembershipSchema).readonly(),
}).readonly();

export const getPlatformAccessSummaryContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/access-summary", operationId: "getPlatformAccessSummary", summary: "Read platform access counts", inputStructure: "detailed", tags: ["Platform Access"] })
  .input(z.object({}).readonly())
  .output(z.object({
    activePrincipalCount: z.number().int().nonnegative(),
    platformAdminCount: z.number().int().nonnegative(),
    appCreatorCount: z.number().int().nonnegative(),
    blockedPrincipalCount: z.number().int().nonnegative(),
    generatedAt: z.number().int().nonnegative(),
  }).readonly());

export const listPlatformPrincipalsContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/principals", operationId: "listPlatformPrincipals", summary: "List platform Principals", inputStructure: "detailed", tags: ["Platform Access"] })
  .input(z.object({ query: PlatformPrincipalQuerySchema.optional() }).readonly())
  .output(pageSchema(PlatformPrincipalListItemSchema).meta({ id: "PlatformPrincipalPage" }));

export const getPlatformPrincipalContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/principals/{principalRef}", operationId: "getPlatformPrincipal", summary: "Read one platform Principal", inputStructure: "detailed", tags: ["Platform Access"] })
  .input(z.object({ params: z.object({ principalRef: z.string().min(1) }).readonly() }).readonly())
  .output(PlatformPrincipalDetailSchema);

export const getPlatformPrincipalAccessContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/principals/{principalRef}/access", operationId: "getPlatformPrincipalAccess", summary: "Read versioned platform access", inputStructure: "detailed", outputStructure: "detailed", tags: ["Platform Access"] })
  .input(z.object({ params: z.object({ principalRef: z.string().min(1) }).readonly() }).readonly())
  .output(z.object({
    headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly(),
    body: PlatformAccessStateSchema,
  }).readonly());

export const patchPlatformPrincipalAccessContract = appProcedure
  .route({ method: "PATCH", path: "/admin/platform/principals/{principalRef}/access", operationId: "patchPlatformPrincipalAccess", summary: "Change platform access", inputStructure: "detailed", outputStructure: "detailed", successStatus: 204, tags: ["Platform Access"] })
  .input(z.object({
    params: z.object({ principalRef: z.string().min(1) }).readonly(),
    headers: mutationHeaders,
    body: PatchPlatformAccessSchema,
  }).readonly())
  .output(z.object({ headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly() }).readonly());

export const listPlatformInvitationsContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/invitations", operationId: "listPlatformInvitations", summary: "List platform invitations", inputStructure: "detailed", tags: ["Platform Invitations"] })
  .input(z.object({ query: PlatformInvitationQuerySchema.optional() }).readonly())
  .output(pageSchema(PlatformInvitationSchema).meta({ id: "PlatformInvitationPage" }));

export const createPlatformInvitationContract = appProcedure
  .route({ method: "POST", path: "/admin/platform/invitations", operationId: "createPlatformInvitation", summary: "Create a platform invitation", inputStructure: "detailed", outputStructure: "detailed", successStatus: 201, tags: ["Platform Invitations"] })
  .input(z.object({
    headers: z.object({ "idempotency-key": z.string().min(1).max(200) }).readonly(),
    body: CreatePlatformInvitationSchema,
  }).readonly())
  .output(z.object({
    headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly(),
    body: z.object({
      invitationId: z.string().min(1),
      acceptUrl: z.url(),
      expiresAt: z.number().int().nonnegative(),
    }).readonly(),
  }).readonly().meta({ id: "CreatePlatformInvitationResponse" }));

export const revokePlatformInvitationContract = appProcedure
  .route({ method: "DELETE", path: "/admin/platform/invitations/{invitationId}", operationId: "revokePlatformInvitation", summary: "Revoke a platform invitation", inputStructure: "detailed", outputStructure: "detailed", successStatus: 204, tags: ["Platform Invitations"] })
  .input(z.object({
    params: z.object({ invitationId: z.string().min(1) }).readonly(),
    headers: mutationHeaders,
  }).readonly())
  .output(z.object({ headers: z.object({ ETag: z.string().regex(/^"(0|[1-9][0-9]*)"$/) }).readonly() }).readonly());

export const acceptPlatformInvitationContract = appProcedure
  .route({ method: "POST", path: "/admin/platform-invitations/{token}/accept", operationId: "acceptPlatformInvitation", summary: "Accept a platform invitation", inputStructure: "detailed", successStatus: 204, tags: ["Platform Invitations"] })
  .input(z.object({ params: z.object({ token: z.string().min(1) }).readonly() }).readonly())
  .output(z.void());

const PlatformAuditEventSchema = z.object({
  eventId: z.string().min(1),
  action: PlatformAuditActionSchema,
  actorPrincipalRef: z.string().min(1).nullable(),
  actorPrincipal: PrincipalSchema,
  targetPrincipalRef: z.string().min(1).nullable(),
  targetPrincipal: PrincipalSchema.nullable(),
  targetInvitationId: z.string().min(1).nullable(),
  result: z.enum(["succeeded", "denied"]),
  requestId: z.string().min(1).nullable(),
  createdAt: z.number().int().nonnegative(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).readonly();

export const listPlatformAuditEventsContract = appProcedure
  .route({ method: "GET", path: "/admin/platform/audit-events", operationId: "listPlatformAuditEvents", summary: "List platform authorization audit events", inputStructure: "detailed", tags: ["Platform Audit"] })
  .input(z.object({ query: PlatformAuditQuerySchema.optional() }).readonly())
  .output(pageSchema(PlatformAuditEventSchema).meta({ id: "PlatformAuditPage" }));

export const appAdminApiContract = {
  identity: { me: appMeContract },
  apps: {
    list: listAppsContract,
    create: createAppContract,
    get: getAppContract,
    patch: patchAppContract,
  },
  members: {
    list: listAppMembersContract,
    remove: deleteAppMemberContract,
    invite: createAppMemberInvitationContract,
    accept: acceptAppMemberInvitationContract,
    listInvitations: listAppMemberInvitationsContract,
    listPeople: listAppPeopleContract,
    revokeInvitation: revokeAppMemberInvitationContract,
  },
  playground: {
    list: listAppPlaygroundFileRootsContract,
    create: createAppPlaygroundFileRootContract,
    patch: patchAppPlaygroundFileRootContract,
    remove: deleteAppPlaygroundFileRootContract,
  },
  issuers: {
    get: getAppOAuthIssuerContract,
    inspect: inspectAppOAuthIssuerContract,
    activate: activateAppOAuthIssuerContract,
    getManaged: getAppManagedIssuerContract,
    patchManaged: patchAppManagedIssuerContract,
    mintCapability: mintManagedSpaceCapabilityContract,
  },
  audit: {
    listRefDomains: listAppRefDomainsContract,
    listControlEvents: listAppControlAuditEventsContract,
    listRootRefs: listSpaceRootDomainRefsContract,
    listRootEvents: listSpaceRootDomainEventsContract,
  },
  platform: {
    accessSummary: getPlatformAccessSummaryContract,
    listPeople: listPlatformPeopleContract,
    listPrincipals: listPlatformPrincipalsContract,
    getPrincipal: getPlatformPrincipalContract,
    getPrincipalAccess: getPlatformPrincipalAccessContract,
    patchPrincipalAccess: patchPlatformPrincipalAccessContract,
    listInvitations: listPlatformInvitationsContract,
    createInvitation: createPlatformInvitationContract,
    revokeInvitation: revokePlatformInvitationContract,
    acceptInvitation: acceptPlatformInvitationContract,
    listAuditEvents: listPlatformAuditEventsContract,
  },
};

export type AppAdminApiContract = typeof appAdminApiContract;
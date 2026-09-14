import { oc } from "@orpc/contract";
import { z } from "zod";
import { AppIdSchema } from "@unicas/tenant-protocol";
import {
  AppMemberInvitationSchema,
  AppMembershipSchema,
  AppSchema,
  PrincipalSchema,
  ProfileSchema,
} from "./schemas.js";

export const AppAdminApiBasePath = "/admin/apps";

const ErrorDataSchema = z.object({ message: z.string().optional() }).readonly();
const error = (status: number, message: string) => ({ status, message, data: ErrorDataSchema });

export const AppAdminApiErrorMap = {
  ADMIN_AUTH_REQUIRED: error(401, "Administrator authentication is required"),
  APP_MEMBERSHIP_REQUIRED: error(403, "App membership is required"),
  NOT_FOUND: error(404, "The requested control-plane resource was not found"),
  LAST_MEMBER: error(409, "The final App member cannot be removed"),
  RATE_LIMITED: error(429, "The control-plane request was rate limited"),
  SERVICE_UNAVAILABLE: error(503, "The control-plane service is unavailable"),
  PRECONDITION_REQUIRED: error(428, "An If-Match precondition is required"),
  REVISION_MISMATCH: error(412, "The If-Match revision does not match"),
  IDEMPOTENCY_CONFLICT: error(409, "The idempotency key was reused with another request"),
  INVALID_CURSOR: error(400, "The pagination cursor is invalid"),
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
    successStatus: 201,
    tags: ["Apps"],
  })
  .input(z.object({
    headers: createHeaders.optional(),
    body: z.object({ displayName: z.string().min(1) }).readonly(),
  }).readonly())
  .output(AppSchema);

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
    summary: "Update an App",
    description: "Updates display metadata under an exact If-Match revision without changing App identity.",
    inputStructure: "detailed",
    tags: ["Apps"],
  })
  .input(z.object({
    params: appParams,
    headers: mutationHeaders,
    body: z.object({
      displayName: z.string().min(1).optional(),
      description: z.string().optional(),
    }).readonly(),
  }).readonly())
  .output(AppSchema);

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
    successStatus: 201,
    tags: ["Members"],
  })
  .input(z.object({
    params: appParams,
    headers: createHeaders.optional(),
    body: z.object({ emailConstraint: z.string().optional() }).readonly().optional(),
  }).readonly())
  .output(z.object({
    invitation: AppMemberInvitationSchema,
    acceptUrl: z.url(),
  }).readonly().meta({ id: "AppAdminCreateMemberInvitationResponse" }));

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
  .output(AppMembershipSchema);

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
  },
};

export type AppAdminApiContract = typeof appAdminApiContract;
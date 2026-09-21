export { AppPeopleQuerySchema, PlatformPeopleQuerySchema } from "./people.js";
export type { AppPeopleQuery, PlatformPeopleQuery, AppPerson, PlatformPerson, PeoplePage } from "./people.js";
export type {
  AccountAvatar,
  AccountId,
  AccountPlatformAuthority,
  AccountSelf,
  AccountSummary,
  App,
  AppAdminMeResponse,
  AppControlAuditEvent,
  AppMemberInvitation,
  AppMemberInvitationStatus,
  AppMembership,
  AppOAuthIssuer,
  AppOAuthIssuerInspection,
  AppRefDomain,
  AppStatus,
  AppUsage,
  CasHash,
  CasRefChanges,
  ExternalIdentityDetail,
  ExternalIdentitySummary,
  Principal,
  Profile,
  PlatformAccountSummary,
  PlatformAccountDetail,
  PlatformAccountListItem,
  PlatformAccountPage,
  PlatformAccountAuditEvent,
  PlatformAccountAuditPage,
  PrimaryVerifiedEmail,
  ProviderKind,
  SpaceRootRefBalance,
  SpaceRootRefEvent,
  VerifiedEmailSource,
} from "./types.js";
export type { AppId } from "@unicas/space-protocol";

export {
  AccountAvatarSchema,
  AccountIdSchema,
  AccountPlatformAuthoritySchema,
  AccountSelfSchema,
  AccountSummarySchema,
  AppControlAuditEventSchema,
  AppMemberInvitationSchema,
  AppMembershipSchema,
  AppOAuthIssuerInspectionSchema,
  AppOAuthIssuerSchema,
  AppRefDomainSchema,
  AppSchema,
  AppUsageSchema,
  CasAdminErrorResponseSchema,
  CasHashSchema,
  CasRefChangesSchema,
  ExternalIdentityDetailSchema,
  ExternalIdentitySummarySchema,
  PlatformAccountSummarySchema,
  PlatformAccountDetailSchema,
  PlatformAccountAuditEventSchema,
  PlatformAccountListItemSchema,
  PrimaryVerifiedEmailSchema,
  PrincipalSchema,
  ProfileSchema,
  ProviderKindSchema,
  SpaceRootRefBalanceSchema,
  SpaceRootRefEventSchema,
  VerifiedEmailSourceSchema,
} from "./schemas.js";

export {
  AppAdminApiBasePath,
  AppAdminApiErrorMap,
  PatchAccountProfileSchema,
  AppAccountAuditQuerySchema,
  PlatformAccountAuditQuerySchema,
  PatchAppRequestSchema,
  AppInvitationQuerySchema,
  InspectAppIssuerRequestSchema,
  ActivateAppIssuerRequestSchema,
  AppIssuerPreconditionSchema,
  appAdminApiContract,
  getAppUsageContract,
} from "./app-v2-contract.js";
export type { AppAdminApiContract } from "./app-v2-contract.js";
export { AppAdminMeResponseSchema } from "./app-v2-contract.js";

export { APP_ADMIN_MCP_TOOLS, APP_ADMIN_MCP_TOOL_LIST } from "./app-mcp-catalog.js";
export { PlatformAuthoritySchema, PlatformAccountQuerySchema, PlatformAuditActionSchema, CreatePlatformInvitationSchema, PlatformInvitationQuerySchema } from "./platform-access.js";
export type { PlatformAuthority, PlatformInvitationStatus, PlatformInvitation, PlatformInvitationPage, PlatformAuditAction } from "./platform-access.js";
export type { AppAdminMcpToolDefinition, AppAdminMcpToolName, AppAdminMcpToolScope } from "./app-mcp-catalog.js";

export {
  CasAdminErrorCodes,
  casAdminErrorHttpStatus,
} from "./errors.js";
export type { CasAdminErrorCode, CasAdminErrorResponse } from "./errors.js";

export {
  CAS_ADMIN_IDEMPOTENCY_RETENTION_MS,
  CasAdminETagHeader,
  CasAdminIdempotencyKeyHeader,
  CasAdminIfMatchHeader,
  formatCasAdminETag,
  parseCasAdminETag,
} from "./concurrency.js";
export type {
  CasAdminCreateHeaders,
  CasAdminListCursor,
  CasAdminMutationPreconditions,
  CasAdminPage,
  CasAdminPageQuery,
  CasAdminRevision,
} from "./concurrency.js";

export {
  casAuthPlanePolicy,
} from "./authz.js";

export { casAdminThreatModel } from "./threat-model.js";

export {
  appAdminRoutes,
  matchAppAdminRoute,
  matchPlatformAdminRoute,
} from "./routes.js";
export type { AppAdminRoute } from "./routes.js";

export type { AppPeopleQuery, PlatformPeopleQuery, AppPerson, PlatformPerson, PeoplePage } from "@unicas/admin-protocol";
/**
 * @unicas/admin-client — Typed HTTP client for the CAS stack control plane.
 *
 * One plain function per `/admin` control-plane operation, request/response
 * types straight from `@unicas/admin-protocol` (the frozen contract). The
 * BFF session cookie + CSRF token come from the session provider; mutations
 * use `If-Match` ETag preconditions and `Idempotency-Key` where allowed.
 */

export { createAdminClient } from "./client.js";
export { AdminClientError } from "./errors.js";
export { CasAdminErrorCodes } from "@unicas/admin-protocol";
export type {
  AdminClient,
} from "./client.js";
export type {
  AdminClientConfig,
  AdminClientRead,
  AdminClientSession,
  AdminHttpFetcher,
} from "./types.js";
// The admin protocol contract is reachable only through this client facade:
// consumers (CLI and WebUI) depend on @unicas/admin-client, never on
// @unicas/admin-protocol directly.
export type {
  App,
  AppAdminMeResponse,
  AppControlAuditEvent,
  AppId,
  AppMemberInvitation,
  AppMembership,
  AppOAuthIssuer,
  AppOAuthIssuerInspection,
  AppRefDomain,
  ManagedSpaceCapability,
  Principal,
  Profile,
  AccountSelf,
  SpaceRootRefBalance,
  SpaceRootRefEvent,
  CasControlAuditEvent,
  CasOAuthIssuerInspection,
  CasPlaygroundFileRoot,
  CasRefDomain,
  CasRootRefBalance,
  CasRootRefEvent,
  CasStack,
  CasStackMember,
  CasStackOAuthIssuer,
  CasManagedCapability,
  PlatformAuthority,
  PlatformAccessStatus,
  EffectivePlatformAccess,
  PlatformAccessState,
  CurrentPlatformAccess,
  PlatformPrincipal,
  PlatformPrincipalListItem,
  PlatformPrincipalDetail,
  PlatformPrincipalPage,
  PlatformAccessSummary,
  PlatformInvitationStatus,
  PlatformInvitation,
  PlatformInvitationPage,
  PlatformAuditAction,
  PlatformAuditEvent,
  PlatformAuditPage,
  ExternalIdentitySummary,
  ProviderKind,
} from "@unicas/admin-protocol";

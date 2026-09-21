import { z } from "zod";
import { AppIdSchema } from "@unicas/tenant-protocol";
import type { CasAdminErrorResponse } from "./errors.js";
import { PlatformAuditActionSchema, PlatformAuthoritySchema } from "./platform-access.js";
import { CasAdminErrorCodes } from "./errors.js";
import type {
  AccountAvatar,
  AccountId,
  AccountPlatformAuthority,
  AccountSelf,
  AccountSummary,
  App,
  AppControlAuditEvent,
  AppUsage,
  AppMemberInvitation,
  AppMembership,
  AppOAuthIssuer,
  AppOAuthIssuerInspection,
  AppRefDomain,
  CasHash,
  CasRefChanges,
  ExternalIdentityDetail,
  ExternalIdentitySummary,
  PlatformAccountSummary,
  PlatformAccountDetail,
  PlatformAccountAuditEvent,
  PlatformAccountListItem,
  PrimaryVerifiedEmail,
  Principal,
  Profile,
  SpaceRootRefBalance,
  SpaceRootRefEvent,
} from "./types.js";

const TimestampSchema = z.number().int().nonnegative()
  .describe("Unix timestamp in milliseconds since 1970-01-01T00:00:00Z.");
const RevisionSchema = z.number().int().nonnegative()
  .describe("Monotonically increasing resource revision used for optimistic concurrency.");
const NonEmptyStringSchema = z.string().min(1);

export const CasHashSchema: z.ZodType<CasHash> = z.string()
  .regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest")
  .describe("Lowercase hexadecimal SHA-256 digest of canonical CAS node bytes.")
  .meta({ id: "CasAdminHash" });

export const CasRefChangesSchema: z.ZodType<CasRefChanges> =
  z.record(CasHashSchema, z.number().int()).readonly()
    .describe("Signed Root Ref deltas keyed by node digest. Positive values acquire references and negative values release them.")
    .meta({ id: "CasAdminRefChanges" });

export const PrincipalSchema: z.ZodType<Principal> = z.object({
  issuer: z.url().describe("Canonical issuer component of the immutable Principal key."),
  subject: NonEmptyStringSchema.describe("Immutable subject component within the issuer."),
}).readonly().meta({ id: "Principal" });

export const ProfileSchema: z.ZodType<Profile> = z.object({
  displayName: z.string().nullable().describe("Display-only name; never an authorization key."),
  emailForDisplay: z.string().nullable().describe("Display-only email; never an authorization key."),
}).readonly().meta({ id: "Profile" });

export const AccountIdSchema: z.ZodType<AccountId> = z.string()
  .regex(/^acct_[A-Za-z0-9_-]{22}$/, "Expected an acct_ prefix followed by a 128-bit base64url identifier")
  .describe("Opaque UniCAS-generated durable administrator account identifier.")
  .meta({ id: "AccountId" });

export const ProviderKindSchema = z.enum(["google", "microsoft", "github"])
  .describe("Configured administrator authentication provider.")
  .meta({ id: "ProviderKind" });

export const VerifiedEmailSourceSchema = z.enum(["google-oidc", "github-emails-api", "unicas-email-challenge"])
  .describe("Verifier that established control of the primary contact address.")
  .meta({ id: "VerifiedEmailSource" });

export const PrimaryVerifiedEmailSchema: z.ZodType<PrimaryVerifiedEmail> = z.object({
  normalizedEmail: z.email().max(254)
    .refine(value => value === value.trim().toLowerCase(), "Expected a trim().toLowerCase() email")
    .describe("Current primary contact normalized with trim().toLowerCase()."),
  source: VerifiedEmailSourceSchema,
  verifiedAt: TimestampSchema,
}).strict().readonly().meta({ id: "PrimaryVerifiedEmail" });

export const AccountAvatarSchema: z.ZodType<AccountAvatar> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    url: z.url(),
    initials: NonEmptyStringSchema,
    colorIndex: z.number().int().nonnegative(),
  }).strict().readonly(),
  z.object({
    kind: z.literal("fallback"),
    initials: NonEmptyStringSchema,
    colorIndex: z.number().int().nonnegative(),
  }).strict().readonly(),
]).meta({ id: "AccountAvatar" });

const ExternalIdentitySummaryShape = {
  externalIdentityId: NonEmptyStringSchema,
  provider: ProviderKindSchema,
  accountHint: z.string().nullable(),
  linkedAt: TimestampSchema,
  lastAuthenticatedAt: TimestampSchema.nullable(),
  currentLogin: z.boolean(),
};

export const ExternalIdentitySummarySchema: z.ZodType<ExternalIdentitySummary> = z.object({
  ...ExternalIdentitySummaryShape,
}).strict().readonly().meta({ id: "ExternalIdentitySummary" });

export const ExternalIdentityDetailSchema: z.ZodType<ExternalIdentityDetail> = z.object({
  ...ExternalIdentitySummaryShape,
  issuer: z.url(),
  subject: NonEmptyStringSchema,
}).strict().readonly().meta({ id: "ExternalIdentityDetail" });

const AccountSummaryShape = {
  accountId: AccountIdSchema,
  displayName: z.string().nullable(),
  primaryVerifiedEmail: PrimaryVerifiedEmailSchema.nullable(),
  avatar: AccountAvatarSchema,
};

export const AccountSummarySchema: z.ZodType<AccountSummary> = z.object({
  ...AccountSummaryShape,
}).strict().readonly().meta({ id: "AccountSummary" });

const PlatformAuthoritiesSchema = z.array(PlatformAuthoritySchema)
  .refine(values => new Set(values).size === values.length, "Expected unique platform authorities")
  .readonly();

export const AccountSelfSchema: z.ZodType<AccountSelf> = z.object({
  ...AccountSummaryShape,
  blockedAt: TimestampSchema.nullable(),
  platformAuthorities: PlatformAuthoritiesSchema,
  identities: z.array(ExternalIdentitySummarySchema).readonly(),
  linkableProviders: z.array(ProviderKindSchema)
    .refine(values => new Set(values).size === values.length, "Expected unique linkable providers")
    .readonly(),
}).strict().readonly().meta({ id: "AccountSelf" });

export const PlatformAccountSummarySchema: z.ZodType<PlatformAccountSummary> = z.object({
  ...AccountSummaryShape,
  blockedAt: TimestampSchema.nullable(),
  platformAuthorities: PlatformAuthoritiesSchema,
}).strict().readonly().meta({ id: "PlatformAccountSummary" });

export const AccountPlatformAuthoritySchema: z.ZodType<AccountPlatformAuthority> = z.object({
  accountId: AccountIdSchema,
  authority: PlatformAuthoritySchema,
  grantedAt: TimestampSchema,
}).strict().readonly().meta({ id: "AccountPlatformAuthority" });

export const AppSchema: z.ZodType<App> = z.object({
  appId: AppIdSchema.describe("Opaque UniCAS-generated App identifier."),
  displayName: NonEmptyStringSchema.describe("Administrator-visible App name."),
  description: z.string().describe("Administrator-visible App description; empty means none."),
  status: z.enum(["active", "suspended"])
    .describe("Operational status. A suspended App cannot serve normal Space traffic."),
  createdAt: TimestampSchema.describe("Time at which UniCAS created the App."),
  revision: RevisionSchema.describe("Current App revision used for optimistic concurrency."),
}).readonly().meta({ id: "App" });

export const AppUsageSchema: z.ZodType<AppUsage> = z.object({
  nodeCount: z.number().int().nonnegative()
    .describe("Node metadata rows owned by all Spaces in the App."),
  readyContentBytes: z.number().int().nonnegative()
    .describe("Logical bytes attributed to App-owned node rows."),
  readyStoredBytes: z.number().int().nonnegative()
    .describe("Physical bytes from the latest verified canonical-object observations."),
  reservedBytes: z.number().int().nonnegative()
    .describe("Known bytes reserved by incomplete uploads across the App."),
  notReadyNodeCount: z.number().int().nonnegative()
    .describe("Nodes whose latest completed canonical-object observation found no object."),
  leasedNodeCount: z.number().int().nonnegative()
    .describe("Nodes carrying a nonzero lease expiry marker."),
}).strict().readonly().meta({ id: "AppUsage" });

export const AppMembershipSchema: z.ZodType<AppMembership> = z.object({
  appId: AppIdSchema.describe("App whose equal administrator authority this membership grants."),
  account: AccountSummarySchema.describe("Stable Account granted membership."),
}).strict().readonly().meta({ id: "AppMembership" });

const PlatformAccountListItemShape = {
  ...AccountSummaryShape,
  blockedAt: TimestampSchema.nullable(),
  platformAuthorities: PlatformAuthoritiesSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  effectiveAccess: z.enum(["active", "blocked", "no_access"]),
  appMembershipCount: z.number().int().nonnegative(),
  lastActiveAt: TimestampSchema.nullable(),
};

export const PlatformAccountListItemSchema: z.ZodType<PlatformAccountListItem> = z.object({
  ...PlatformAccountListItemShape,
}).strict().readonly().meta({ id: "PlatformAccountListItem" });

export const PlatformAccountDetailSchema: z.ZodType<PlatformAccountDetail> = z.object({
  ...PlatformAccountListItemShape,
  memberships: z.array(AppMembershipSchema).readonly(),
}).strict().readonly().meta({ id: "PlatformAccountDetail" });

export const PlatformAccountAuditEventSchema: z.ZodType<PlatformAccountAuditEvent> = z.object({
  eventId: NonEmptyStringSchema,
  action: PlatformAuditActionSchema,
  actorAccount: AccountSummarySchema,
  authenticatedIdentity: ExternalIdentityDetailSchema,
  targetAccount: AccountSummarySchema.nullable(),
  targetInvitationId: NonEmptyStringSchema.nullable(),
  result: z.enum(["succeeded", "denied"]),
  requestId: z.string().nullable(),
  createdAt: TimestampSchema,
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict().readonly().meta({ id: "PlatformAccountAuditEvent" });

export const AppMemberInvitationSchema: z.ZodType<AppMemberInvitation> = z.object({
  invitationId: NonEmptyStringSchema.describe("Opaque persistent invitation identity."),
  appId: AppIdSchema.describe("App the accepted invitation joins."),
  status: z.enum(["pending", "accepted", "expired", "revoked"])
    .describe("Current single-use invitation lifecycle state."),
  emailConstraint: z.string().nullable()
    .describe("Email the authenticated Principal must match, or null when unrestricted."),
  expiresAt: TimestampSchema.describe("Deadline after which acceptance is rejected."),
  createdAt: TimestampSchema.describe("Time at which the invitation was issued."),
  revision: RevisionSchema.describe("Current invitation revision."),
}).readonly().meta({ id: "AppMemberInvitation" });

const AppOAuthIssuerShape = {
  appId: AppIdSchema.describe("App whose Space capabilities this issuer authorizes."),
  issuer: z.url(),
  audience: NonEmptyStringSchema,
  metadataUrl: z.url(),
  metadataType: z.enum(["oauth", "oidc"]),
  authorizationEndpoint: z.url(),
  tokenEndpoint: z.url(),
  jwksUri: z.url(),
  registrationEndpoint: z.url().nullable(),
  scopesSupported: z.array(z.string()).readonly(),
  codeChallengeMethodsSupported: z.array(z.string()).readonly(),
};

export const AppOAuthIssuerSchema: z.ZodType<AppOAuthIssuer> = z.object({
  ...AppOAuthIssuerShape,
  status: z.enum(["pending", "active", "stale", "incompatible", "disabled"]),
  verifiedAt: TimestampSchema.nullable(),
  lastRefreshAt: TimestampSchema.nullable(),
  lastRefreshError: z.string().nullable(),
  jwksDigest: NonEmptyStringSchema,
  capabilityMaxLifetimeSeconds: z.number().int().positive(),
  revision: RevisionSchema,
}).readonly().meta({ id: "AppOAuthIssuer" });

export const AppOAuthIssuerInspectionSchema: z.ZodType<AppOAuthIssuerInspection> = z.object({
  inspectionId: NonEmptyStringSchema,
  metadataUrl: z.url(),
  jwksUri: z.url(),
  challenge: NonEmptyStringSchema,
  expiresAt: TimestampSchema,
  keys: z.array(z.object({
    kid: NonEmptyStringSchema,
    algorithm: NonEmptyStringSchema,
  }).readonly()).readonly(),
}).strict().readonly().meta({ id: "AppOAuthIssuerInspection" });

export const AppRefDomainSchema: z.ZodType<AppRefDomain> = z.object({
  appId: AppIdSchema,
  refDomain: NonEmptyStringSchema,
  revision: RevisionSchema,
}).readonly().meta({ id: "AppRefDomain" });

export const AppControlAuditEventSchema: z.ZodType<AppControlAuditEvent> = z.object({
  eventId: NonEmptyStringSchema,
  appId: AppIdSchema.nullable(),
  actorAccount: AccountSummarySchema,
  authenticatedIdentity: ExternalIdentityDetailSchema,
  targetAccount: AccountSummarySchema.nullable(),
  action: NonEmptyStringSchema,
  target: NonEmptyStringSchema,
  requestId: z.string().nullable(),
  traceId: z.string().nullable(),
  caller: z.object({
    channel: z.enum(["admin-webui", "mcp"]),
    oauthClientHandle: z.string().nullable(),
    toolName: z.string().nullable(),
  }).readonly().nullable(),
  createdAt: TimestampSchema,
}).strict().readonly().meta({ id: "AppControlAuditEvent" });

export const SpaceRootRefBalanceSchema: z.ZodType<SpaceRootRefBalance> = z.object({
  spaceId: NonEmptyStringSchema,
  hash: CasHashSchema,
  count: z.number().int(),
}).readonly().meta({ id: "SpaceRootRefBalance" });

export const SpaceRootRefEventSchema: z.ZodType<SpaceRootRefEvent> = z.object({
  revision: RevisionSchema,
  spaceId: NonEmptyStringSchema,
  requestId: NonEmptyStringSchema,
  changes: CasRefChangesSchema,
  appliedAt: TimestampSchema,
}).readonly().meta({ id: "SpaceRootRefEvent" });

export const CasAdminErrorResponseSchema: z.ZodType<CasAdminErrorResponse> = z.object({
  error: z.enum(Object.values(CasAdminErrorCodes)).describe("Stable machine-readable control-plane error code."),
  message: z.string().optional().describe("Optional diagnostic message intended for operators, not programmatic branching."),
}).readonly().meta({ id: "CasAdminErrorResponse" });
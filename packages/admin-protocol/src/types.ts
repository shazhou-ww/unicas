import type { AppId } from "@unicas/tenant-protocol";
import type { CurrentPlatformAccess, PlatformAuthority } from "./platform-access.js";

/**
 * Content-addressed node digest wire shape.
 * Defined locally so the admin protocol stays independent of the tenant plane.
 * 64 lowercase hexadecimal SHA-256 characters.
 */
export type CasHash = string;

/** Signed non-zero integer Root Ref deltas keyed by content hash. */
export type CasRefChanges = Readonly<Record<CasHash, number>>;

/** Opaque CAS-generated stack identifier. Never caller-chosen. */
export type CasStackId = string;

/** Immutable OIDC subject key: (identityIssuer, subject). Email is display-only. */
export interface CasOperatorIdentityKey {
  readonly identityIssuer: string;
  readonly subject: string;
}

export interface CasOperatorIdentity extends CasOperatorIdentityKey {
  readonly displayName: string | null;
  readonly emailForDisplay: string | null;
}

export interface Principal {
  readonly issuer: string;
  readonly subject: string;
}

export interface Profile {
  readonly displayName: string | null;
  readonly emailForDisplay: string | null;
}

/** Opaque UniCAS-generated durable administrator account identifier. */
export type AccountId = string;

export type ProviderKind = "google" | "microsoft" | "github";

export type VerifiedEmailSource = "google-oidc" | "github-emails-api" | "unicas-email-challenge";

export interface PrimaryVerifiedEmail {
  readonly normalizedEmail: string;
  readonly source: VerifiedEmailSource;
  readonly verifiedAt: number;
}

export type AccountAvatar =
  | { readonly kind: "image"; readonly url: string; readonly initials: string; readonly colorIndex: number }
  | { readonly kind: "fallback"; readonly initials: string; readonly colorIndex: number };

export interface ExternalIdentitySummary {
  readonly externalIdentityId: string;
  readonly provider: ProviderKind;
  readonly accountHint: string | null;
  readonly linkedAt: number;
  readonly lastAuthenticatedAt: number | null;
  readonly currentLogin: boolean;
}

export interface ExternalIdentityDetail extends ExternalIdentitySummary {
  readonly issuer: string;
  readonly subject: string;
}

export interface AccountSummary {
  readonly accountId: AccountId;
  readonly displayName: string | null;
  readonly primaryVerifiedEmail: PrimaryVerifiedEmail | null;
  readonly avatar: AccountAvatar;
}

export interface AccountSelf extends AccountSummary {
  readonly blockedAt: number | null;
  readonly platformAuthorities: readonly PlatformAuthority[];
  readonly identities: readonly ExternalIdentitySummary[];
  readonly linkableProviders: readonly ProviderKind[];
}

export interface PlatformAccountSummary extends AccountSummary {
  readonly blockedAt: number | null;
  readonly platformAuthorities: readonly PlatformAuthority[];
}

export interface AccountPlatformAuthority {
  readonly accountId: AccountId;
  readonly authority: PlatformAuthority;
  readonly grantedAt: number;
}

export type AppStatus = "active" | "suspended";

export interface App {
  readonly appId: AppId;
  readonly displayName: string;
  readonly description: string;
  readonly status: AppStatus;
  readonly createdAt: number;
  readonly revision: number;
}

export interface AppMembership {
  readonly appId: AppId;
  readonly account: AccountSummary;
}

export interface AppAdminMeResponse {
  readonly account: AccountSelf;
  readonly authenticatedIdentity: ExternalIdentitySummary;
  /** @deprecated Use account. */
  readonly principal: Principal;
  /** @deprecated Use account profile/contact fields. */
  readonly profile: Profile;
  readonly platformAccess: CurrentPlatformAccess;
  readonly memberships: readonly AppMembership[];
}

export type AppMemberInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface AppMemberInvitation {
  readonly invitationId: string;
  readonly appId: AppId;
  readonly status: AppMemberInvitationStatus;
  readonly emailConstraint: string | null;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly revision: number;
}

export interface AppOAuthIssuer {
  readonly appId: AppId;
  readonly mode: "managed" | "external";
  readonly issuer: string;
  readonly audience: string;
  readonly metadataUrl: string;
  readonly metadataType: "oauth" | "oidc";
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly registrationEndpoint: string | null;
  readonly scopesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[];
  readonly status: "pending" | "active" | "stale" | "incompatible" | "disabled";
  readonly verifiedAt: number | null;
  readonly lastRefreshAt: number | null;
  readonly lastRefreshError: string | null;
  readonly jwksDigest: string;
  readonly capabilityMaxLifetimeSeconds: number;
  readonly revision: number;
}

export interface AppOAuthIssuerInspection {
  readonly inspectionId: string;
  readonly metadataUrl: string;
  readonly jwksUri: string;
  readonly challenge: string;
  readonly expiresAt: number;
  readonly keys: readonly { readonly kid: string; readonly algorithm: string }[];
}

export interface ManagedSpaceCapability {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly expiresAt: number;
  readonly issuer: string;
  readonly audience: string;
  readonly spaceId: string;
  readonly permissions: readonly string[];
}

export interface AppRefDomain {
  readonly appId: AppId;
  readonly refDomain: string;
  readonly revision: number;
}

export interface AppControlAuditEvent {
  readonly eventId: string;
  readonly appId: AppId | null;
  readonly actor: Principal;
  readonly action: string;
  readonly target: string;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly caller: {
    readonly channel: "admin-webui" | "mcp";
    readonly oauthClientHandle: string | null;
    readonly toolName: string | null;
  } | null;
  readonly createdAt: number;
}

export interface SpaceRootRefBalance {
  readonly spaceId: string;
  readonly hash: CasHash;
  readonly count: number;
}

export interface SpaceRootRefEvent {
  readonly revision: number;
  readonly spaceId: string;
  readonly requestId: string;
  readonly changes: CasRefChanges;
  readonly appliedAt: number;
}

export type CasStackStatus = "active" | "suspended";

export interface CasStack {
  readonly stackId: CasStackId;
  readonly displayName: string;
  readonly description: string;
  readonly status: CasStackStatus;
  readonly createdAt: number;
  readonly revision: number;
}

export interface CasStackMember extends CasOperatorIdentityKey {
  readonly stackId: CasStackId;
  readonly displayName: string | null;
  readonly emailForDisplay: string | null;
}

/** Playground-owned business record that gives a retained CAS manifest meaning. */
export interface CasPlaygroundFileRoot {
  readonly rootId: string;
  readonly name: string;
  readonly manifestHash: CasHash;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * MVP membership is equal: every member has identical stack-admin authority.
 * There is no per-member RBAC grant on control-plane routes.
 */
export const CAS_STACK_MEMBER_AUTHORITY = "equal_administrator" as const;

export type CasMemberInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface CasMemberInvitation {
  readonly invitationId: string;
  readonly stackId: CasStackId;
  readonly status: CasMemberInvitationStatus;
  readonly emailConstraint: string | null;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly revision: number;
}

export type CasOAuthIssuerMetadataType = "oauth" | "oidc";
export type CasOAuthIssuerMode = "managed" | "external";

export type CasOAuthIssuerStatus =
  | "pending"
  | "active"
  | "stale"
  | "incompatible"
  | "disabled";

/** Discovered Stack OAuth authorization-server binding. */
export interface CasStackOAuthIssuer {
  readonly stackId: CasStackId;
  readonly mode: CasOAuthIssuerMode;
  readonly issuer: string;
  readonly audience: string;
  readonly metadataUrl: string;
  readonly metadataType: CasOAuthIssuerMetadataType;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly registrationEndpoint: string | null;
  readonly scopesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[];
  readonly status: CasOAuthIssuerStatus;
  readonly verifiedAt: number | null;
  readonly lastRefreshAt: number | null;
  readonly lastRefreshError: string | null;
  readonly jwksDigest: string;
  /** Per-stack capability signing cap in seconds (default 28800, max 604800). */
  readonly capabilityMaxLifetimeSeconds: number;
  readonly revision: number;
}

export interface CasOAuthIssuerInspectionKey {
  readonly kid: string;
  readonly algorithm: string;
  readonly publicJwk: Readonly<Record<string, unknown>>;
}

export interface CasOAuthIssuerInspection {
  readonly inspectionId: string;
  readonly stackId: CasStackId;
  readonly issuer: string;
  readonly audience: string;
  readonly metadataUrl: string;
  readonly metadataType: CasOAuthIssuerMetadataType;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly registrationEndpoint: string | null;
  readonly scopesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[];
  readonly metadataDigest: string;
  readonly jwksDigest: string;
  readonly capabilityMaxLifetimeSeconds: number;
  /** Exact bytes to sign as the compact-JWS payload for activation. */
  readonly challenge: string;
  readonly expiresAt: number;
  readonly keys: readonly CasOAuthIssuerInspectionKey[];
  /** Revision of the pending OAuth issuer resource. */
  readonly revision: number;
}

/** A refDomain observed in successful Root Ref audit writes. */
export interface CasRefDomain {
  readonly stackId: CasStackId;
  readonly refDomain: string;
  readonly revision: number;
}

export interface CasControlAuditEvent {
  readonly eventId: string;
  readonly stackId: CasStackId | null;
  readonly actor: CasOperatorIdentityKey;
  readonly action: string;
  readonly target: string;
  readonly requestId: string | null;
  readonly traceId: string | null;
  readonly caller: {
    readonly channel: "admin-webui" | "mcp";
    readonly oauthClientHandle: string | null;
    readonly toolName: string | null;
  } | null;
  readonly createdAt: number;
}

/** Platform-operator actions are not stack-membership grants. */
export type CasPlatformOperatorAction =
  | "suspend_stack"
  | "unsuspend_stack"
  | "disaster_recovery";

export interface CasPlatformOperatorCapability {
  readonly action: CasPlatformOperatorAction;
  /**
   * Stack members cannot mint or grant these. Only CAS platform operators
   * hold them, through a plane disjoint from `/admin` stack membership.
   */
  readonly grantedByStackMembership: false;
}

export interface CasRootRefBalance {
  readonly tenantId: string;
  readonly hash: CasHash;
  readonly count: number;
}

export interface CasRootRefEvent {
  readonly revision: number;
  readonly tenantId: string;
  readonly requestId: string;
  readonly changes: CasRefChanges;
  readonly appliedAt: number;
}

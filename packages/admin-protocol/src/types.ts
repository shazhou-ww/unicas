import type { AppId } from "@unicas/tenant-protocol";
import type { PlatformAuthority } from "./platform-access.js";

/**
 * Content-addressed node digest wire shape.
 * Defined locally so the admin protocol stays independent of the tenant plane.
 * 64 lowercase hexadecimal SHA-256 characters.
 */
export type CasHash = string;

/** Signed non-zero integer Root Ref deltas keyed by content hash. */
export type CasRefChanges = Readonly<Record<CasHash, number>>;

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

export interface PlatformAccountListItem extends PlatformAccountSummary {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly effectiveAccess: "active" | "blocked" | "no_access";
  readonly appMembershipCount: number;
  readonly lastActiveAt: number | null;
}

export interface PlatformAccountDetail extends PlatformAccountListItem {
  readonly memberships: readonly AppMembership[];
}

export interface PlatformAccountPage {
  readonly items: readonly PlatformAccountListItem[];
  readonly nextCursor: string | null;
}

export interface PlatformAccountAuditEvent {
  readonly eventId: string;
  readonly action: string;
  readonly actorAccount: AccountSummary;
  readonly authenticatedIdentity: ExternalIdentityDetail;
  readonly targetAccount: AccountSummary | null;
  readonly targetInvitationId: string | null;
  readonly result: "succeeded" | "denied";
  readonly requestId: string | null;
  readonly createdAt: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PlatformAccountAuditPage {
  readonly items: readonly PlatformAccountAuditEvent[];
  readonly nextCursor: string | null;
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

export interface AppRefDomain {
  readonly appId: AppId;
  readonly refDomain: string;
  readonly revision: number;
}

export interface AppControlAuditEvent {
  readonly eventId: string;
  readonly appId: AppId | null;
  readonly actorAccount: AccountSummary;
  readonly authenticatedIdentity: ExternalIdentityDetail;
  readonly targetAccount: AccountSummary | null;
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
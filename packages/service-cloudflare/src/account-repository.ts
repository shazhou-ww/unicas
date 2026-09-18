import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AccountId, App, AppId, AppMemberInvitation, PlatformAuthority, PrimaryVerifiedEmail } from "@unicas/admin-protocol";
import type {
  AccountAppMembershipRecord,
  AccountAppIdempotencyRecord,
  AccountAppInvitationIdempotencyRecord,
  AccountAppInvitationRecord,
  AppAccountAuditRecord,
  AccountProfileRecord,
  AccountPlatformViewRecord,
  AccountRecord,
  AccountRepository,
  AccountWithIdentityCreate,
  ControlOAuthIssuerInspectionRecord,
  ControlOAuthIssuerRecord,
  DiscoveredOAuthJwk,
  ExternalIdentityRecord,
  PlatformAccountAuditRecord,
} from "@unicas/service";

interface AccountRow {
  account_id: AccountId;
  blocked_at: number | null;
  credential_version: number;
  primary_verified_email: string | null;
  email_verification_source: PrimaryVerifiedEmail["source"] | null;
  email_verified_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ExternalIdentityRow {
  external_identity_id: string;
  account_id: AccountId;
  provider: ExternalIdentityRecord["provider"];
  issuer: string;
  subject: string;
  linked_at: number;
  last_authenticated_at: number | null;
  unlinked_at: number | null;
  account_hint: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface ManagedOAuthIssuerRow {
  readonly app_id: string;
  readonly issuer: string;
  readonly audience: string;
  readonly metadata_url: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly scopes_supported: string;
  readonly code_challenge_methods_supported: string;
  readonly status: ControlOAuthIssuerRecord["status"];
  readonly verified_at: number;
  readonly jwks_digest: string;
  readonly capability_max_lifetime_seconds: number;
  readonly revision: number;
}

interface AppOAuthIssuerRow extends ManagedOAuthIssuerRow {
  readonly metadata_type: ControlOAuthIssuerRecord["metadataType"];
  readonly registration_endpoint: string | null;
  readonly last_refresh_at: number | null;
  readonly last_refresh_error: string | null;
}

interface OAuthIssuerInspectionRow {
  readonly inspection_id: string;
  readonly app_id: string;
  readonly issuer: string;
  readonly audience: string;
  readonly metadata_url: string;
  readonly metadata_type: ControlOAuthIssuerRecord["metadataType"];
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly registration_endpoint: string | null;
  readonly scopes_supported: string;
  readonly code_challenge_methods_supported: string;
  readonly metadata_digest: string;
  readonly jwks_digest: string;
  readonly challenge_hash: string;
  readonly capability_max_lifetime_seconds: number;
  readonly created_at: number;
  readonly expires_at: number;
  readonly used_at: number | null;
  readonly revision: number;
}

interface AccountMembershipRow extends AccountRow {
  app_id: AppId;
  joined_at: number;
  display_name: string | null;
  avatar_url: string | null;
  display_name_source: string | null;
  avatar_source: string | null;
  profile_updated_at: number;
}

interface AccountPlatformRow extends AccountRow {
  display_name: string | null;
  avatar_url: string | null;
  display_name_source: string | null;
  avatar_source: string | null;
  profile_updated_at: number;
  platform_admin: number;
  apps_create: number;
  app_membership_count: number;
  last_active_at: number | null;
}

interface AccountAuditRow {
  event_id: string;
  app_id: AppId | null;
  action: string;
  target: string;
  target_invitation_id: string | null;
  result: "succeeded" | "denied";
  request_id: string | null;
  trace_id: string | null;
  caller_channel: "admin-webui" | "mcp" | null;
  oauth_client_handle: string | null;
  tool_name: string | null;
  created_at: number;
  details_json: string;
  actor_account_id: AccountId;
  actor_blocked_at: number | null;
  actor_credential_version: number;
  actor_primary_verified_email: string | null;
  actor_email_verification_source: PrimaryVerifiedEmail["source"] | null;
  actor_email_verified_at: number | null;
  actor_created_at: number;
  actor_updated_at: number;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  actor_display_name_source: string | null;
  actor_avatar_source: string | null;
  actor_profile_updated_at: number;
  actor_external_identity_id: string;
  actor_provider: ExternalIdentityRecord["provider"];
  actor_issuer: string;
  actor_subject: string;
  actor_linked_at: number;
  actor_last_authenticated_at: number | null;
  actor_unlinked_at: number | null;
  actor_account_hint: string | null;
  actor_identity_display_name: string | null;
  actor_identity_avatar_url: string | null;
  target_account_id: AccountId | null;
  target_blocked_at: number | null;
  target_credential_version: number | null;
  target_primary_verified_email: string | null;
  target_email_verification_source: PrimaryVerifiedEmail["source"] | null;
  target_email_verified_at: number | null;
  target_created_at: number | null;
  target_updated_at: number | null;
  target_display_name: string | null;
  target_avatar_url: string | null;
  target_display_name_source: string | null;
  target_avatar_source: string | null;
  target_profile_updated_at: number | null;
}

const platformAccountProjection = `SELECT account.account_id, account.blocked_at,
  account.credential_version, account.primary_verified_email,
  account.email_verification_source, account.email_verified_at,
  account.created_at, account.updated_at, profile.display_name, profile.avatar_url,
  profile.display_name_source, profile.avatar_source, profile.updated_at AS profile_updated_at,
  EXISTS (SELECT 1 FROM cas_account_platform_authorities authority
    WHERE authority.account_id = account.account_id AND authority.authority = 'platform.admin') AS platform_admin,
  EXISTS (SELECT 1 FROM cas_account_platform_authorities authority
    WHERE authority.account_id = account.account_id AND authority.authority = 'apps.create') AS apps_create,
  (SELECT COUNT(*) FROM cas_app_members member
    WHERE member.account_id = account.account_id) AS app_membership_count,
  NULLIF(MAX(
    COALESCE((SELECT MAX(event.created_at) FROM cas_control_audit_events event
      WHERE event.original_account_id = account.account_id), 0),
    COALESCE((SELECT MAX(event.created_at) FROM cas_platform_audit_events event
      WHERE event.actor_account_id = account.account_id), 0)
  ), 0) AS last_active_at
  FROM cas_accounts account
  JOIN cas_account_profiles profile ON profile.account_id = account.account_id`;

const accountAuditProjection = `actor_account.account_id AS actor_account_id,
  actor_account.blocked_at AS actor_blocked_at,
  actor_account.credential_version AS actor_credential_version,
  actor_account.primary_verified_email AS actor_primary_verified_email,
  actor_account.email_verification_source AS actor_email_verification_source,
  actor_account.email_verified_at AS actor_email_verified_at,
  actor_account.created_at AS actor_created_at,
  actor_account.updated_at AS actor_updated_at,
  actor_profile.display_name AS actor_display_name,
  actor_profile.avatar_url AS actor_avatar_url,
  actor_profile.display_name_source AS actor_display_name_source,
  actor_profile.avatar_source AS actor_avatar_source,
  actor_profile.updated_at AS actor_profile_updated_at,
  actor_identity.external_identity_id AS actor_external_identity_id,
  actor_identity.provider AS actor_provider,
  actor_identity.issuer AS actor_issuer,
  actor_identity.subject AS actor_subject,
  actor_identity.linked_at AS actor_linked_at,
  actor_identity.last_authenticated_at AS actor_last_authenticated_at,
  actor_identity.unlinked_at AS actor_unlinked_at,
  actor_identity.account_hint AS actor_account_hint,
  actor_identity.display_name AS actor_identity_display_name,
  actor_identity.avatar_url AS actor_identity_avatar_url,
  target_account.account_id AS target_account_id,
  target_account.blocked_at AS target_blocked_at,
  target_account.credential_version AS target_credential_version,
  target_account.primary_verified_email AS target_primary_verified_email,
  target_account.email_verification_source AS target_email_verification_source,
  target_account.email_verified_at AS target_email_verified_at,
  target_account.created_at AS target_created_at,
  target_account.updated_at AS target_updated_at,
  target_profile.display_name AS target_display_name,
  target_profile.avatar_url AS target_avatar_url,
  target_profile.display_name_source AS target_display_name_source,
  target_profile.avatar_source AS target_avatar_source,
  target_profile.updated_at AS target_profile_updated_at`;

export class D1AccountRepository implements AccountRepository {
  constructor(readonly db: D1Database) { }

  async getAccount(accountId: AccountId): Promise<AccountRecord | null> {
    const row = await this.db.prepare(
      "SELECT account_id, blocked_at, credential_version, primary_verified_email, email_verification_source, email_verified_at, created_at, updated_at FROM cas_accounts WHERE account_id = ?",
    ).bind(accountId).first<AccountRow>();
    return row ? accountRecord(row) : null;
  }

  async getAliasTarget(sourceAccountId: AccountId): Promise<AccountId | null> {
    const row = await this.db.prepare(
      "SELECT canonical_account_id FROM cas_account_aliases WHERE source_account_id = ?",
    ).bind(sourceAccountId).first<{ canonical_account_id: AccountId }>();
    return row?.canonical_account_id ?? null;
  }

  async getActiveIdentity(issuer: string, subject: string): Promise<ExternalIdentityRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM cas_external_identities WHERE issuer = ? AND subject = ? AND unlinked_at IS NULL",
    ).bind(issuer, subject).first<ExternalIdentityRow>();
    return row ? externalIdentityRecord(row) : null;
  }

  async getIdentity(externalIdentityId: string): Promise<ExternalIdentityRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM cas_external_identities WHERE external_identity_id = ?",
    ).bind(externalIdentityId).first<ExternalIdentityRow>();
    return row ? externalIdentityRecord(row) : null;
  }

  async getProfile(accountId: AccountId) {
    const row = await this.db.prepare(
      "SELECT account_id, display_name, avatar_url, display_name_source, avatar_source, updated_at FROM cas_account_profiles WHERE account_id = ?",
    ).bind(accountId).first<{
      account_id: AccountId;
      display_name: string | null;
      avatar_url: string | null;
      display_name_source: string | null;
      avatar_source: string | null;
      updated_at: number;
    }>();
    return row ? {
      accountId: row.account_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      displayNameSource: row.display_name_source,
      avatarSource: row.avatar_source,
      updatedAt: row.updated_at,
    } : null;
  }

  async listActiveIdentities(accountId: AccountId): Promise<readonly ExternalIdentityRecord[]> {
    const rows = await this.db.prepare(
      "SELECT * FROM cas_external_identities WHERE account_id = ? AND unlinked_at IS NULL ORDER BY linked_at, external_identity_id",
    ).bind(accountId).all<ExternalIdentityRow>();
    return (rows.results ?? []).map(externalIdentityRecord);
  }

  async listPlatformAuthorities(accountId: AccountId): Promise<readonly PlatformAuthority[]> {
    const rows = await this.db.prepare(
      "SELECT authority FROM cas_account_platform_authorities WHERE account_id = ? ORDER BY authority",
    ).bind(accountId).all<{ authority: PlatformAuthority }>();
    return (rows.results ?? []).map(row => row.authority);
  }

  async hasAppMembership(accountId: AccountId, appId?: AppId): Promise<boolean> {
    return await this.db.prepare(
      "SELECT 1 AS member FROM cas_app_members WHERE account_id = ? AND (? IS NULL OR app_id = ?) LIMIT 1",
    ).bind(accountId, appId ?? null, appId ?? null).first() !== null;
  }

  async listAccountMembershipAppIds(accountId: AccountId): Promise<readonly AppId[]> {
    const rows = await this.db.prepare(
      "SELECT app_id FROM cas_app_members WHERE account_id = ? ORDER BY app_id",
    ).bind(accountId).all<{ app_id: AppId }>();
    return (rows.results ?? []).map(row => row.app_id);
  }

  async readControlSnapshot(): Promise<number> {
    const row = await this.db.prepare(
      "SELECT value FROM cas_control_meta WHERE key = 'snapshot'",
    ).first<{ value: number }>();
    return row?.value ?? 0;
  }

  async listAccountApps(
    input: Parameters<AccountRepository["listAccountApps"]>[0],
  ): Promise<readonly App[]> {
    const rows = await this.db.prepare(
      `SELECT app.app_id, app.display_name, app.description, app.status, app.created_at, app.revision
       FROM cas_apps AS app
       JOIN cas_app_members AS member ON member.app_id = app.app_id
       WHERE member.account_id = ? AND app.app_id > ?
       ORDER BY app.app_id LIMIT ?`,
    ).bind(input.accountId, input.afterAppId, input.limit).all<{
      app_id: AppId;
      display_name: string;
      description: string;
      status: App["status"];
      created_at: number;
      revision: number;
    }>();
    return (rows.results ?? []).map(row => ({
      appId: row.app_id,
      displayName: row.display_name,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      revision: row.revision,
    }));
  }

  async getAccountApp(accountId: AccountId, appId: AppId): Promise<App | null> {
    const row = await this.db.prepare(
      `SELECT app.app_id, app.display_name, app.description, app.status, app.created_at, app.revision
       FROM cas_apps AS app
       JOIN cas_app_members AS member ON member.app_id = app.app_id
       WHERE member.account_id = ? AND app.app_id = ?`,
    ).bind(accountId, appId).first<{
      app_id: AppId;
      display_name: string;
      description: string;
      status: App["status"];
      created_at: number;
      revision: number;
    }>();
    return row ? {
      appId: row.app_id,
      displayName: row.display_name,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      revision: row.revision,
    } : null;
  }

  async getManagedOAuthIssuer(appId: AppId): Promise<ControlOAuthIssuerRecord | null> {
    const row = await this.db.prepare(
      `SELECT app_id, issuer, audience, metadata_url, authorization_endpoint,
        token_endpoint, jwks_uri, scopes_supported, code_challenge_methods_supported,
        status, verified_at, jwks_digest, capability_max_lifetime_seconds, revision
       FROM cas_app_managed_issuers WHERE app_id = ?`,
    ).bind(appId).first<ManagedOAuthIssuerRow>();
    return row ? {
      stackId: row.app_id,
      mode: "managed",
      issuer: row.issuer,
      audience: row.audience,
      metadataUrl: row.metadata_url,
      metadataType: "oauth",
      authorizationEndpoint: row.authorization_endpoint,
      tokenEndpoint: row.token_endpoint,
      jwksUri: row.jwks_uri,
      registrationEndpoint: null,
      scopesSupported: JSON.parse(row.scopes_supported) as string[],
      codeChallengeMethodsSupported: JSON.parse(row.code_challenge_methods_supported) as string[],
      status: row.status,
      verifiedAt: row.verified_at,
      lastRefreshAt: row.verified_at,
      lastRefreshError: null,
      jwksDigest: row.jwks_digest,
      capabilityMaxLifetimeSeconds: row.capability_max_lifetime_seconds,
      revision: row.revision,
    } : null;
  }

  async getAppOAuthIssuer(appId: AppId): Promise<ControlOAuthIssuerRecord | null> {
    const row = await this.db.prepare(
      `SELECT app_id, issuer, audience, metadata_url, metadata_type,
        authorization_endpoint, token_endpoint, jwks_uri, registration_endpoint,
        scopes_supported, code_challenge_methods_supported, status, verified_at,
        last_refresh_at, last_refresh_error, jwks_digest,
        capability_max_lifetime_seconds, revision
       FROM cas_app_oauth_issuers WHERE app_id = ?`,
    ).bind(appId).first<AppOAuthIssuerRow>();
    return row ? {
      stackId: row.app_id,
      mode: "external",
      issuer: row.issuer,
      audience: row.audience,
      metadataUrl: row.metadata_url,
      metadataType: row.metadata_type,
      authorizationEndpoint: row.authorization_endpoint,
      tokenEndpoint: row.token_endpoint,
      jwksUri: row.jwks_uri,
      registrationEndpoint: row.registration_endpoint,
      scopesSupported: JSON.parse(row.scopes_supported) as string[],
      codeChallengeMethodsSupported: JSON.parse(row.code_challenge_methods_supported) as string[],
      status: row.status,
      verifiedAt: row.verified_at,
      lastRefreshAt: row.last_refresh_at,
      lastRefreshError: row.last_refresh_error,
      jwksDigest: row.jwks_digest,
      capabilityMaxLifetimeSeconds: row.capability_max_lifetime_seconds,
      revision: row.revision,
    } : null;
  }

  async hasAppOAuthIssuerElsewhere(issuer: string, appId: AppId): Promise<boolean> {
    return await this.db.prepare(
      "SELECT 1 AS ok FROM cas_app_oauth_issuers WHERE issuer = ? AND app_id != ?",
    ).bind(issuer, appId).first<{ ok: number }>() !== null;
  }

  async commitInspectAccountOAuthIssuer(
    input: Parameters<AccountRepository["commitInspectAccountOAuthIssuer"]>[0],
  ): Promise<"created" | "actor-not-member" | "issuer-conflict"> {
    const inspection = input.inspection;
    try {
      await this.db.batch([
        this.#requireAppActor(input),
        this.db.prepare(
          "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cas_app_oauth_issuers WHERE issuer = ? AND app_id != ?) THEN 1 ELSE json_extract('invalid', '$') END AS available",
        ).bind(inspection.issuer, inspection.stackId),
        this.db.prepare(
          `INSERT INTO cas_oauth_issuer_inspections
            (inspection_id, app_id, issuer, audience, metadata_url, metadata_type,
             authorization_endpoint, token_endpoint, jwks_uri, registration_endpoint,
             scopes_supported, code_challenge_methods_supported, metadata_digest,
             jwks_digest, challenge_hash, capability_max_lifetime_seconds,
             created_at, expires_at, used_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        ).bind(
          inspection.inspectionId, inspection.stackId, inspection.issuer,
          inspection.audience, inspection.metadataUrl, inspection.metadataType,
          inspection.authorizationEndpoint, inspection.tokenEndpoint,
          inspection.jwksUri, inspection.registrationEndpoint,
          JSON.stringify(inspection.scopesSupported),
          JSON.stringify(inspection.codeChallengeMethodsSupported),
          inspection.metadataDigest, inspection.jwksDigest, inspection.challengeHash,
          inspection.capabilityMaxLifetimeSeconds, inspection.createdAt, inspection.expiresAt,
        ),
        ...input.keys.map(key => this.db.prepare(
          "INSERT INTO cas_oauth_issuer_inspection_keys (inspection_id, kid, algorithm, public_jwk) VALUES (?, ?, ?, ?)",
        ).bind(inspection.inspectionId, key.kid, key.algorithm, JSON.stringify(key.publicJwk))),
        this.#appAuditStatement(input, "oauth_issuer.inspected", inspection.issuer),
        ...this.#controlSnapshotStatements(),
      ]);
      return "created";
    } catch (error) {
      if (!isJsonFailure(error) && !isUniqueFailure(error)) throw error;
      return await this.#isUsableAppActor(input) ? "issuer-conflict" : "actor-not-member";
    }
  }

  async getAppOAuthIssuerInspection(inspectionId: string): Promise<ControlOAuthIssuerInspectionRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM cas_oauth_issuer_inspections WHERE inspection_id = ?",
    ).bind(inspectionId).first<OAuthIssuerInspectionRow>();
    return row ? oauthIssuerInspectionRecord(row) : null;
  }

  async listAppOAuthIssuerInspectionKeys(inspectionId: string): Promise<readonly DiscoveredOAuthJwk[]> {
    const rows = await this.db.prepare(
      "SELECT kid, algorithm, public_jwk FROM cas_oauth_issuer_inspection_keys WHERE inspection_id = ? ORDER BY kid",
    ).bind(inspectionId).all<{ kid: string; algorithm: DiscoveredOAuthJwk["algorithm"]; public_jwk: string }>();
    return (rows.results ?? []).map(row => ({
      kid: row.kid,
      algorithm: row.algorithm,
      publicJwk: JSON.parse(row.public_jwk) as Record<string, unknown>,
    }));
  }

  async commitActivateAccountOAuthIssuer(
    input: Parameters<AccountRepository["commitActivateAccountOAuthIssuer"]>[0],
  ): Promise<"activated" | "actor-not-member" | "unavailable" | "revision-mismatch" | "issuer-conflict"> {
    const issuer = input.issuer;
    const precondition = input.expectedIssuerRevision === null
      ? this.db.prepare(
        "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cas_app_oauth_issuers WHERE app_id = ?) THEN 1 ELSE json_extract('invalid', '$') END AS allowed",
      ).bind(input.appId)
      : this.db.prepare(
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_app_oauth_issuers WHERE app_id = ? AND revision = ?) THEN 1 ELSE json_extract('invalid', '$') END AS allowed",
      ).bind(input.appId, input.expectedIssuerRevision);
    try {
      await this.db.batch([
        this.#requireAppActor(input),
        precondition,
        this.db.prepare(
          `UPDATE cas_oauth_issuer_inspections SET used_at = ?, revision = revision + 1
           WHERE inspection_id = ? AND app_id = ? AND used_at IS NULL AND expires_at > ?`,
        ).bind(input.now, input.inspectionId, input.appId, input.now),
        this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS consumed"),
        this.db.prepare(
          `INSERT INTO cas_app_oauth_issuers
            (app_id, mode, issuer, audience, metadata_url, metadata_type,
             authorization_endpoint, token_endpoint, jwks_uri, registration_endpoint,
             scopes_supported, code_challenge_methods_supported, status, verified_at,
             last_refresh_at, last_refresh_error, jwks_digest,
             capability_max_lifetime_seconds, revision)
           VALUES (?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?)
           ON CONFLICT(app_id) DO UPDATE SET mode = excluded.mode, issuer = excluded.issuer,
             audience = excluded.audience, metadata_url = excluded.metadata_url,
             metadata_type = excluded.metadata_type,
             authorization_endpoint = excluded.authorization_endpoint,
             token_endpoint = excluded.token_endpoint, jwks_uri = excluded.jwks_uri,
             registration_endpoint = excluded.registration_endpoint,
             scopes_supported = excluded.scopes_supported,
             code_challenge_methods_supported = excluded.code_challenge_methods_supported,
             status = excluded.status, verified_at = excluded.verified_at,
             last_refresh_at = excluded.last_refresh_at, last_refresh_error = NULL,
             jwks_digest = excluded.jwks_digest,
             capability_max_lifetime_seconds = excluded.capability_max_lifetime_seconds,
             revision = excluded.revision`,
        ).bind(
          input.appId, issuer.issuer, issuer.audience, issuer.metadataUrl,
          issuer.metadataType, issuer.authorizationEndpoint, issuer.tokenEndpoint,
          issuer.jwksUri, issuer.registrationEndpoint,
          JSON.stringify(issuer.scopesSupported),
          JSON.stringify(issuer.codeChallengeMethodsSupported), input.now, input.now,
          issuer.jwksDigest, issuer.capabilityMaxLifetimeSeconds, issuer.revision,
        ),
        this.#appAuditStatement(input, input.expectedIssuerRevision === null
          ? "oauth_issuer.activated" : "oauth_issuer.replaced", issuer.issuer),
        ...this.#controlSnapshotStatements(),
      ]);
      return "activated";
    } catch (error) {
      if (!isJsonFailure(error) && !isUniqueFailure(error)) throw error;
      if (!await this.#isUsableAppActor(input)) return "actor-not-member";
      if (isUniqueFailure(error) && await this.hasAppOAuthIssuerElsewhere(issuer.issuer, input.appId)) {
        return "issuer-conflict";
      }
      const inspection = await this.getAppOAuthIssuerInspection(input.inspectionId);
      return !inspection || inspection.usedAt !== null || inspection.expiresAt <= input.now
        ? "unavailable" : "revision-mismatch";
    }
  }

  async getAppMemberInvitation(appId: AppId, invitationId: string): Promise<AppMemberInvitation | null> {
    return this.db.prepare(
      `SELECT invitation_id AS invitationId, app_id AS appId, status,
        email_constraint AS emailConstraint, expires_at AS expiresAt,
        created_at AS createdAt, revision
       FROM cas_app_member_invitations WHERE app_id = ? AND invitation_id = ?`,
    ).bind(appId, invitationId).first<AppMemberInvitation>();
  }

  async listAppMemberInvitations(
    input: Parameters<AccountRepository["listAppMemberInvitations"]>[0],
  ): Promise<readonly AppMemberInvitation[]> {
    const result = await this.db.prepare(
      `SELECT invitation_id AS invitationId, app_id AS appId, status,
        email_constraint AS emailConstraint, expires_at AS expiresAt,
        created_at AS createdAt, revision
       FROM cas_app_member_invitations
       WHERE app_id = ? AND invitation_id > ? AND (? IS NULL OR status = ?)
         AND (? IS NULL OR expires_at <= ?)
       ORDER BY invitation_id LIMIT ?`,
    ).bind(
      input.appId,
      input.afterInvitationId,
      input.status ?? null,
      input.status ?? null,
      input.expiresAtOrBefore ?? null,
      input.expiresAtOrBefore ?? null,
      input.limit,
    ).all<AppMemberInvitation>();
    return result.results ?? [];
  }

  async commitAccountAppInvitationTransition(
    input: Parameters<AccountRepository["commitAccountAppInvitationTransition"]>[0],
  ): Promise<"updated" | "actor-not-member" | "unavailable"> {
    const action = input.status === "revoked" ? "member.invitation.revoked" : "member.invitation.expired";
    try {
      await this.db.batch([
        this.#requireAppActor(input),
        this.db.prepare(
          `UPDATE cas_app_member_invitations SET status = ?, revision = revision + 1
           WHERE app_id = ? AND invitation_id = ? AND revision = ? AND status = 'pending'
             AND ((? = 'expired' AND expires_at <= ?) OR (? = 'revoked' AND expires_at > ?))`,
        ).bind(
          input.status,
          input.appId,
          input.invitationId,
          input.expectedRevision,
          input.status,
          input.now,
          input.status,
          input.now,
        ),
        this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS changed"),
        this.#appAuditStatement(input, action, input.invitationId),
        ...this.#controlSnapshotStatements(),
      ]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      return await this.#isUsableAppActor(input) ? "unavailable" : "actor-not-member";
    }
  }

  async getAccountAppInvitationIdempotency(input: {
    readonly accountId: AccountId;
    readonly appId: AppId;
    readonly key: string;
    readonly now: number;
  }): Promise<AccountAppInvitationIdempotencyRecord | null> {
    const row = await this.db.prepare(
      `SELECT account_id, app_id, idempotency_key, payload_hash, response_json,
        created_at, expires_at
       FROM cas_account_app_invitation_idempotency
       WHERE account_id = ? AND app_id = ? AND idempotency_key = ? AND expires_at > ?`,
    ).bind(input.accountId, input.appId, input.key, input.now).first<{
      account_id: AccountId;
      app_id: AppId;
      idempotency_key: string;
      payload_hash: string;
      response_json: string;
      created_at: number;
      expires_at: number;
    }>();
    return row ? {
      accountId: row.account_id,
      appId: row.app_id,
      key: row.idempotency_key,
      payloadHash: row.payload_hash,
      response: JSON.parse(row.response_json) as AccountAppInvitationIdempotencyRecord["response"],
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    } : null;
  }

  async commitCreateAccountAppInvitation(
    input: Parameters<AccountRepository["commitCreateAccountAppInvitation"]>[0],
  ): Promise<"created" | "actor-not-member" | { readonly idempotencyRace: AccountAppInvitationIdempotencyRecord }> {
    const statements: D1PreparedStatement[] = [
      this.#requireAppActor({ ...input, appId: input.invitation.appId }),
      this.db.prepare(
        `INSERT INTO cas_app_member_invitations
          (invitation_id, app_id, status, email_constraint, token_hash,
           expires_at, created_at, revision)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, 1)`,
      ).bind(
        input.invitation.invitationId,
        input.invitation.appId,
        input.invitation.emailConstraint,
        input.invitation.tokenHash,
        input.invitation.expiresAt,
        input.invitation.createdAt,
      ),
      this.#appAuditStatement({ ...input, appId: input.invitation.appId }, "member.invited", input.invitation.invitationId),
      ...this.#controlSnapshotStatements(),
    ];
    if (input.idempotency) {
      statements.push(this.db.prepare(
        `INSERT INTO cas_account_app_invitation_idempotency
          (account_id, app_id, idempotency_key, payload_hash, response_json,
           created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.idempotency.accountId,
        input.idempotency.appId,
        input.idempotency.key,
        input.idempotency.payloadHash,
        JSON.stringify(input.idempotency.response),
        input.idempotency.createdAt,
        input.idempotency.expiresAt,
      ));
    }
    try {
      await this.db.batch(statements);
      return "created";
    } catch (error) {
      if (input.idempotency && isUniqueFailure(error)) {
        const existing = await this.getAccountAppInvitationIdempotency({
          accountId: input.idempotency.accountId,
          appId: input.idempotency.appId,
          key: input.idempotency.key,
          now: input.now,
        });
        if (existing) return { idempotencyRace: existing };
      }
      if (isJsonFailure(error) && !await this.#isUsableAppActor({ ...input, appId: input.invitation.appId })) {
        return "actor-not-member";
      }
      throw error;
    }
  }

  async getAccountAppInvitationByTokenHash(tokenHash: string): Promise<AccountAppInvitationRecord | null> {
    return this.db.prepare(
      `SELECT invitation_id AS invitationId, app_id AS appId, status,
        email_constraint AS emailConstraint, token_hash AS tokenHash,
        expires_at AS expiresAt, created_at AS createdAt, revision
       FROM cas_app_member_invitations WHERE token_hash = ?`,
    ).bind(tokenHash).first<AccountAppInvitationRecord>();
  }

  async commitAcceptAccountAppInvitation(
    input: Parameters<AccountRepository["commitAcceptAccountAppInvitation"]>[0],
  ): Promise<"accepted" | "account-unavailable" | "invitation-unavailable"> {
    const consumeChallenge = input.emailChallenge && input.primaryVerifiedEmail
      ? [
        this.db.prepare(
          `UPDATE cas_email_challenges SET consumed_at = ?
           WHERE challenge_id = ? AND invitation_kind = 'app' AND invitation_id = ?
             AND invitation_token_hash = ?
             AND identity_issuer = (SELECT issuer FROM cas_external_identities
               WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
             AND subject = (SELECT subject FROM cas_external_identities
               WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
             AND authentication_event_id = ? AND normalized_email = ?
             AND verified_at IS NOT NULL AND consumed_at IS NULL
             AND invalidated_at IS NULL AND expires_at > ?`,
        ).bind(
          input.now,
          input.emailChallenge.challengeId,
          input.invitation.invitationId,
          input.invitation.tokenHash,
          input.externalIdentityId,
          input.accountId,
          input.externalIdentityId,
          input.accountId,
          input.emailChallenge.authenticationEventId,
          input.primaryVerifiedEmail.normalizedEmail,
          input.now,
        ),
        this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS consumed"),
      ]
      : [];
    const actorInput = {
      actorAccountId: input.accountId,
      actorExternalIdentityId: input.externalIdentityId,
      appId: input.invitation.appId,
      eventId: input.eventId,
      requestId: input.requestId,
      traceId: input.traceId,
      callerChannel: input.callerChannel,
      oauthClientHandle: input.oauthClientHandle,
      toolName: input.toolName,
      now: input.now,
    };
    const initializePrimaryContact = input.primaryVerifiedEmail
      ? [this.db.prepare(
        `UPDATE cas_accounts SET primary_verified_email = ?, email_verification_source = ?,
           email_verified_at = ?, updated_at = MAX(updated_at, ?)
         WHERE account_id = ? AND primary_verified_email IS NULL`,
      ).bind(
        input.primaryVerifiedEmail.normalizedEmail,
        input.primaryVerifiedEmail.source,
        input.primaryVerifiedEmail.verifiedAt,
        input.now,
        input.accountId,
      )]
      : [];
    try {
      await this.db.batch([
        this.#requireAccountActor(input.accountId, input.externalIdentityId),
        ...consumeChallenge,
        this.db.prepare(
          `UPDATE cas_app_member_invitations SET status = 'accepted', revision = revision + 1
           WHERE invitation_id = ? AND app_id = ? AND token_hash = ?
             AND status = 'pending' AND expires_at > ?`,
        ).bind(
          input.invitation.invitationId,
          input.invitation.appId,
          input.invitation.tokenHash,
          input.now,
        ),
        this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS claimed"),
        this.db.prepare(
          `INSERT OR IGNORE INTO cas_app_members
            (app_id, identity_issuer, subject, joined_at, account_id)
           SELECT ?, issuer, subject, ?, account_id FROM cas_external_identities
           WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL`,
        ).bind(input.invitation.appId, input.now, input.externalIdentityId, input.accountId),
        ...initializePrimaryContact,
        this.#appAuditStatement(actorInput, "member.invitation.accepted", input.invitation.invitationId),
        ...this.#controlSnapshotStatements(),
      ]);
      return "accepted";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const [account, identity] = await Promise.all([
        this.getAccount(input.accountId),
        this.getIdentity(input.externalIdentityId),
      ]);
      if (!account || account.blockedAt !== null || !identity
        || identity.accountId !== input.accountId || identity.unlinkedAt !== null) {
        return "account-unavailable";
      }
      return "invitation-unavailable";
    }
  }

  async appendAccountSessionAudit(
    input: Parameters<AccountRepository["appendAccountSessionAudit"]>[0],
  ): Promise<"recorded" | "account-unavailable"> {
    const result = await this.db.prepare(
      `INSERT INTO cas_control_audit_events
        (event_id, app_id, identity_issuer, subject, action, target, request_id,
         trace_id, caller_channel, oauth_client_handle, tool_name, created_at,
         original_account_id, external_identity_id, target_account_id)
       SELECT ?, NULL, issuer, subject, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL
       FROM cas_external_identities
       WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL
         AND EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ? AND blocked_at IS NULL)`,
    ).bind(
      input.eventId,
      input.action,
      input.accountId,
      input.requestId ?? null,
      input.traceId ?? null,
      input.callerChannel ?? null,
      input.now,
      input.accountId,
      input.externalIdentityId,
      input.externalIdentityId,
      input.accountId,
      input.accountId,
    ).run();
    return (result.meta.changes ?? 0) === 1 ? "recorded" : "account-unavailable";
  }

  async commitPatchAccountManagedOAuthIssuer(
    input: Parameters<AccountRepository["commitPatchAccountManagedOAuthIssuer"]>[0],
  ): Promise<"updated" | "actor-not-member" | "not-found" | "revision-mismatch"> {
    const requireActor = this.db.prepare(
      `SELECT CASE WHEN
         EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ? AND blocked_at IS NULL)
         AND EXISTS (SELECT 1 FROM cas_external_identities
           WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
         AND EXISTS (SELECT 1 FROM cas_app_members WHERE app_id = ? AND account_id = ?)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(
      input.actorAccountId,
      input.actorExternalIdentityId,
      input.actorAccountId,
      input.appId,
      input.actorAccountId,
    );
    const update = this.db.prepare(
      "UPDATE cas_app_managed_issuers SET status = ?, revision = ? WHERE app_id = ? AND revision = ?",
    ).bind(
      input.enabled ? "active" : "disabled",
      input.nextRevision,
      input.appId,
      input.expectedRevision,
    );
    const requireUpdated = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS updated",
    );
    const audit = this.db.prepare(
      `INSERT INTO cas_control_audit_events
        (event_id, app_id, identity_issuer, subject, action, target, request_id,
         trace_id, caller_channel, oauth_client_handle, tool_name, created_at,
         original_account_id, external_identity_id, target_account_id)
       SELECT ?, ?, identity.issuer, identity.subject, ?, issuer.issuer, ?, ?, ?,
         ?, ?, ?, ?, ?, NULL
       FROM cas_external_identities AS identity
       JOIN cas_app_managed_issuers AS issuer ON issuer.app_id = ?
       WHERE identity.external_identity_id = ? AND identity.account_id = ?
         AND identity.unlinked_at IS NULL`,
    ).bind(
      input.eventId,
      input.appId,
      input.enabled ? "managed_issuer.enabled" : "managed_issuer.disabled",
      input.requestId ?? null,
      input.traceId ?? null,
      input.callerChannel ?? null,
      input.oauthClientHandle ?? null,
      input.toolName ?? null,
      input.now,
      input.actorAccountId,
      input.actorExternalIdentityId,
      input.appId,
      input.actorExternalIdentityId,
      input.actorAccountId,
    );
    try {
      await this.db.batch([
        requireActor,
        update,
        requireUpdated,
        audit,
        this.db.prepare("INSERT OR IGNORE INTO cas_control_meta (key, value) VALUES ('snapshot', 0)"),
        this.db.prepare("UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot'"),
      ]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const account = await this.getAccount(input.actorAccountId);
      const identity = await this.getIdentity(input.actorExternalIdentityId);
      if (!account || account.blockedAt !== null || !identity
        || identity.accountId !== input.actorAccountId || identity.unlinkedAt !== null
        || !await this.hasAppMembership(input.actorAccountId, input.appId)) {
        return "actor-not-member";
      }
      return await this.getManagedOAuthIssuer(input.appId) ? "revision-mismatch" : "not-found";
    }
  }

  async commitPatchAccountApp(
    input: Parameters<AccountRepository["commitPatchAccountApp"]>[0],
  ): Promise<"updated" | "actor-not-member" | "not-found" | "revision-mismatch"> {
    const identity = await this.getIdentity(input.actorExternalIdentityId);
    if (!identity || identity.accountId !== input.actorAccountId || identity.unlinkedAt !== null) {
      return "actor-not-member";
    }
    const requireCurrent = this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_app_members WHERE app_id = ? AND account_id = ?)
         AND EXISTS (SELECT 1 FROM cas_external_identities WHERE external_identity_id = ?
           AND account_id = ? AND unlinked_at IS NULL)
         AND EXISTS (SELECT 1 FROM cas_apps WHERE app_id = ? AND revision = ?)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(input.app.appId, input.actorAccountId, input.actorExternalIdentityId,
      input.actorAccountId, input.app.appId, input.expectedRevision);
    const update = this.db.prepare(
      `UPDATE cas_apps SET display_name = ?, description = ?, status = ?, revision = ?
       WHERE app_id = ? AND revision = ?`,
    ).bind(input.app.displayName, input.app.description, input.app.status, input.app.revision,
      input.app.appId, input.expectedRevision);
    const audit = this.db.prepare(
      `INSERT INTO cas_control_audit_events
        (event_id, app_id, identity_issuer, subject, action, target, request_id,
         trace_id, caller_channel, oauth_client_handle, tool_name, created_at,
         original_account_id, external_identity_id, target_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(input.eventId, input.app.appId, identity.issuer, identity.subject, input.action,
      input.app.appId, input.requestId ?? null, input.traceId ?? null,
      input.callerChannel ?? null, input.oauthClientHandle ?? null, input.toolName ?? null,
      input.now, input.actorAccountId, input.actorExternalIdentityId);
    try {
      await this.db.batch([
        requireCurrent,
        update,
        audit,
        this.db.prepare("UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot'"),
      ]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      if (!await this.hasAppMembership(input.actorAccountId, input.app.appId)) return "actor-not-member";
      const current = await this.db.prepare(
        "SELECT revision FROM cas_apps WHERE app_id = ?",
      ).bind(input.app.appId).first<{ revision: number }>();
      if (!current) return "not-found";
      return "revision-mismatch";
    }
  }

  async getAccountAppIdempotency(
    input: Parameters<AccountRepository["getAccountAppIdempotency"]>[0],
  ): Promise<AccountAppIdempotencyRecord | null> {
    const row = await this.db.prepare(
      `SELECT account_id, payload_hash, response_json, created_at, expires_at
       FROM cas_account_app_idempotency
       WHERE account_id = ? AND method = 'POST' AND canonical_route = '/admin/apps'
         AND idempotency_key = ? AND expires_at > ?`,
    ).bind(input.accountId, input.key, input.now).first<{
      account_id: AccountId;
      payload_hash: string;
      response_json: string;
      created_at: number;
      expires_at: number;
    }>();
    return row ? {
      accountId: row.account_id,
      method: "POST",
      canonicalRoute: "/admin/apps",
      key: input.key,
      payloadHash: row.payload_hash,
      response: JSON.parse(row.response_json) as App,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    } : null;
  }

  async commitCreateAccountApp(
    input: Parameters<AccountRepository["commitCreateAccountApp"]>[0],
  ): Promise<"created" | "actor-forbidden" | { readonly idempotencyRace: AccountAppIdempotencyRecord }> {
    const identity = await this.getIdentity(input.actorExternalIdentityId);
    if (!identity || identity.accountId !== input.actorAccountId || identity.unlinkedAt !== null) return "actor-forbidden";
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ? AND blocked_at IS NULL)
          AND EXISTS (SELECT 1 FROM cas_external_identities WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
          AND EXISTS (SELECT 1 FROM cas_account_platform_authorities WHERE account_id = ? AND authority = 'apps.create')
         THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
      ).bind(input.actorAccountId, input.actorExternalIdentityId, input.actorAccountId, input.actorAccountId),
      this.db.prepare(
        "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(input.app.appId, input.app.displayName, input.app.description, input.app.status, input.app.createdAt, input.app.revision),
      this.db.prepare(
        "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES (?, ?, ?, ?, ?)",
      ).bind(input.app.appId, identity.issuer, identity.subject, input.app.createdAt, input.actorAccountId),
      this.db.prepare(
        `INSERT INTO cas_control_audit_events
          (event_id, app_id, identity_issuer, subject, action, target, request_id,
           trace_id, caller_channel, oauth_client_handle, tool_name, created_at,
           original_account_id, external_identity_id, target_account_id)
         VALUES (?, ?, ?, ?, 'app.created', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind(input.eventId, input.app.appId, identity.issuer, identity.subject, input.app.appId,
        input.requestId ?? null, input.traceId ?? null, input.callerChannel ?? null,
        input.oauthClientHandle ?? null, input.toolName ?? null,
        input.app.createdAt, input.actorAccountId, input.actorExternalIdentityId),
    ];
    if (input.managedIssuer) {
      const issuer = input.managedIssuer;
      statements.push(this.db.prepare(
        "INSERT INTO cas_app_managed_issuers (app_id, issuer, audience, metadata_url, authorization_endpoint, token_endpoint, jwks_uri, scopes_supported, code_challenge_methods_supported, status, verified_at, jwks_digest, capability_max_lifetime_seconds, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
      ).bind(issuer.stackId, issuer.issuer, issuer.audience, issuer.metadataUrl,
        issuer.authorizationEndpoint, issuer.tokenEndpoint, issuer.jwksUri,
        JSON.stringify(issuer.scopesSupported), JSON.stringify(issuer.codeChallengeMethodsSupported),
        issuer.verifiedAt, issuer.jwksDigest, issuer.capabilityMaxLifetimeSeconds, issuer.revision));
    }
    if (input.idempotency) {
      statements.push(this.db.prepare(
        `INSERT INTO cas_account_app_idempotency
          (account_id, method, canonical_route, idempotency_key, payload_hash,
           response_json, created_at, expires_at) VALUES (?, 'POST', '/admin/apps', ?, ?, ?, ?, ?)`,
      ).bind(input.idempotency.accountId, input.idempotency.key, input.idempotency.payloadHash,
        JSON.stringify(input.idempotency.response), input.idempotency.createdAt, input.idempotency.expiresAt));
    }
    statements.push(
      this.db.prepare("INSERT OR IGNORE INTO cas_control_meta (key, value) VALUES ('snapshot', 0)"),
      this.db.prepare("UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot'"),
    );
    try {
      await this.db.batch(statements);
      return "created";
    } catch (error) {
      if (input.idempotency && isUniqueFailure(error)) {
        const existing = await this.getAccountAppIdempotency({
          accountId: input.actorAccountId,
          key: input.idempotency.key,
          now: input.app.createdAt,
        });
        if (existing) return { idempotencyRace: existing };
      }
      if (isJsonFailure(error)) return "actor-forbidden";
      throw error;
    }
  }

  async listAppMemberships(
    input: Parameters<AccountRepository["listAppMemberships"]>[0],
  ): Promise<readonly AccountAppMembershipRecord[]> {
    const rows = await this.db.prepare(
      `SELECT member.app_id, member.account_id, member.joined_at,
         account.blocked_at, account.credential_version, account.primary_verified_email,
         account.email_verification_source, account.email_verified_at, account.created_at,
         account.updated_at, profile.display_name, profile.avatar_url,
         profile.display_name_source, profile.avatar_source, profile.updated_at AS profile_updated_at
       FROM cas_app_members AS member
       JOIN cas_accounts AS account ON account.account_id = member.account_id
       JOIN cas_account_profiles AS profile ON profile.account_id = member.account_id
       WHERE member.app_id = ? AND member.account_id > ?
       ORDER BY member.account_id LIMIT ?`,
    ).bind(input.appId, input.afterAccountId, input.limit).all<AccountMembershipRow>();
    return (rows.results ?? []).map(row => ({
      appId: row.app_id,
      account: accountRecord(row),
      profile: {
        accountId: row.account_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        displayNameSource: row.display_name_source,
        avatarSource: row.avatar_source,
        updatedAt: row.profile_updated_at,
      },
      joinedAt: row.joined_at,
    }));
  }

  async commitRemoveAppMembership(
    input: Parameters<AccountRepository["commitRemoveAppMembership"]>[0],
  ): Promise<"removed" | "actor-not-member" | "last-member"> {
    const requireActor = this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_app_members WHERE app_id = ? AND account_id = ?)
         AND EXISTS (SELECT 1 FROM cas_external_identities WHERE external_identity_id = ?
           AND account_id = ? AND unlinked_at IS NULL)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(input.appId, input.actorAccountId, input.actorExternalIdentityId, input.actorAccountId);
    const requireRemainingMember = this.db.prepare(
      `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cas_app_members WHERE app_id = ? AND account_id = ?)
         OR (SELECT COUNT(*) FROM cas_app_members WHERE app_id = ?) > 1
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(input.appId, input.targetAccountId, input.appId);
    const remove = this.db.prepare(
      "DELETE FROM cas_app_members WHERE app_id = ? AND account_id = ?",
    ).bind(input.appId, input.targetAccountId);
    const advanceSnapshot = this.db.prepare(
      "UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot' AND changes() = 1",
    );
    const audit = this.db.prepare(
      `INSERT INTO cas_control_audit_events
        (event_id, app_id, identity_issuer, subject, action, target, request_id,
         trace_id, caller_channel, oauth_client_handle, tool_name, created_at,
         original_account_id, external_identity_id, target_account_id)
       SELECT ?, ?, issuer, subject, 'member.removed', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?
       FROM cas_external_identities
       WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL
         AND EXISTS (SELECT 1 FROM cas_app_members WHERE app_id = ? AND account_id = ?)`,
    ).bind(
      input.eventId,
      input.appId,
      input.targetAccountId,
      input.requestId ?? null,
      input.traceId ?? null,
      input.callerChannel ?? null,
      input.now,
      input.actorAccountId,
      input.actorExternalIdentityId,
      input.targetAccountId,
      input.actorExternalIdentityId,
      input.actorAccountId,
      input.appId,
      input.targetAccountId,
    );
    try {
      await this.db.batch([requireActor, requireRemainingMember, audit, remove, advanceSnapshot]);
      return "removed";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const actorIdentity = await this.getIdentity(input.actorExternalIdentityId);
      if (!await this.hasAppMembership(input.actorAccountId, input.appId)
        || !actorIdentity || actorIdentity.accountId !== input.actorAccountId || actorIdentity.unlinkedAt !== null) {
        return "actor-not-member";
      }
      if (!await this.hasAppMembership(input.targetAccountId, input.appId)) return "removed";
      const count = await this.db.prepare(
        "SELECT COUNT(*) AS count FROM cas_app_members WHERE app_id = ?",
      ).bind(input.appId).first<{ count: number }>();
      return (count?.count ?? 0) <= 1 ? "last-member" : "removed";
    }
  }

  async getPlatformAccount(accountId: AccountId): Promise<AccountPlatformViewRecord | null> {
    const row = await this.db.prepare(
      `${platformAccountProjection} WHERE account.account_id = ?`,
    ).bind(accountId).first<AccountPlatformRow>();
    return row ? accountPlatformRecord(row) : null;
  }

  async listPlatformAccounts(
    input: Parameters<AccountRepository["listPlatformAccounts"]>[0],
  ): Promise<readonly AccountPlatformViewRecord[]> {
    const conditions = ["account.account_id > ?"];
    const bindings: unknown[] = [input.afterAccountId];
    if (input.query !== undefined) {
      conditions.push(`(instr(lower(COALESCE(profile.display_name, '')), ?) > 0
        OR instr(lower(COALESCE(account.primary_verified_email, '')), ?) > 0
        OR instr(lower(account.account_id), ?) > 0)`);
      bindings.push(input.query, input.query, input.query);
    }
    if (input.authority === "none") {
      conditions.push("NOT EXISTS (SELECT 1 FROM cas_account_platform_authorities authority WHERE authority.account_id = account.account_id)");
    } else if (input.authority !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM cas_account_platform_authorities authority WHERE authority.account_id = account.account_id AND authority.authority = ?)");
      bindings.push(input.authority);
    }
    if (input.effectiveAccess === "blocked") conditions.push("account.blocked_at IS NOT NULL");
    if (input.effectiveAccess === "active") {
      conditions.push(`account.blocked_at IS NULL AND (
        EXISTS (SELECT 1 FROM cas_account_platform_authorities authority WHERE authority.account_id = account.account_id)
        OR EXISTS (SELECT 1 FROM cas_app_members member WHERE member.account_id = account.account_id))`);
    }
    if (input.effectiveAccess === "no_access") {
      conditions.push(`account.blocked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM cas_account_platform_authorities authority WHERE authority.account_id = account.account_id)
        AND NOT EXISTS (SELECT 1 FROM cas_app_members member WHERE member.account_id = account.account_id)`);
    }
    bindings.push(input.limit);
    const rows = await this.db.prepare(
      `${platformAccountProjection} WHERE ${conditions.join(" AND ")}
       ORDER BY account.account_id LIMIT ?`,
    ).bind(...bindings).all<AccountPlatformRow>();
    return (rows.results ?? []).map(accountPlatformRecord);
  }

  async commitPlatformAuthority(
    input: Parameters<AccountRepository["commitPlatformAuthority"]>[0],
  ): Promise<"updated" | "actor-forbidden" | "target-not-found" | "last-admin"> {
    const requireActor = this.#requirePlatformActor(input);
    const requireTarget = this.db.prepare(
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ?) THEN 1 ELSE json_extract('invalid', '$') END AS allowed",
    ).bind(input.targetAccountId);
    const requireRemainingAdmin = this.db.prepare(
      `SELECT CASE WHEN ? = 1 OR ? <> 'platform.admin'
        OR NOT EXISTS (SELECT 1 FROM cas_account_platform_authorities
          WHERE account_id = ? AND authority = 'platform.admin')
        OR EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ? AND blocked_at IS NOT NULL)
        OR (SELECT COUNT(*) FROM cas_account_platform_authorities authority
          JOIN cas_accounts account ON account.account_id = authority.account_id
          WHERE authority.authority = 'platform.admin' AND account.blocked_at IS NULL) > 1
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(Number(input.grant), input.authority, input.targetAccountId, input.targetAccountId);
    const changeCondition = input.grant ? "NOT EXISTS" : "EXISTS";
    const audit = this.db.prepare(
      `INSERT INTO cas_platform_audit_events
        (event_id, actor_issuer, actor_subject, target_issuer, target_subject,
         target_invitation_id, action, result, request_id, created_at, details_json,
         actor_account_id, actor_external_identity_id, target_account_id)
       SELECT ?, actor.issuer, actor.subject, NULL, NULL, NULL,
         'platform_access.authority_changed', 'succeeded', ?, ?, ?, ?, ?, ?
       FROM cas_external_identities actor
       WHERE actor.external_identity_id = ? AND actor.account_id = ? AND actor.unlinked_at IS NULL
         AND ${changeCondition} (SELECT 1 FROM cas_account_platform_authorities authority
           WHERE authority.account_id = ? AND authority.authority = ?)`,
    ).bind(
      input.eventId,
      input.requestId ?? null,
      input.now,
      JSON.stringify({ authority: input.authority, granted: input.grant }),
      input.actorAccountId,
      input.actorExternalIdentityId,
      input.targetAccountId,
      input.actorExternalIdentityId,
      input.actorAccountId,
      input.targetAccountId,
      input.authority,
    );
    const mutate = input.grant
      ? this.db.prepare(
        `INSERT OR IGNORE INTO cas_account_platform_authorities (account_id, authority, granted_at)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM cas_platform_audit_events WHERE event_id = ?)`,
      ).bind(input.targetAccountId, input.authority, input.now, input.eventId)
      : this.db.prepare(
        `DELETE FROM cas_account_platform_authorities WHERE account_id = ? AND authority = ?
         AND EXISTS (SELECT 1 FROM cas_platform_audit_events WHERE event_id = ?)`,
      ).bind(input.targetAccountId, input.authority, input.eventId);
    try {
      await this.db.batch([
        requireActor,
        requireTarget,
        requireRemainingAdmin,
        audit,
        mutate,
        ...this.#accountSnapshotStatements(input.eventId),
      ]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const failure = await this.#platformMutationFailure(input, input.authority === "platform.admin" && !input.grant);
      if (failure === "unclassified") throw error;
      return failure;
    }
  }

  async commitPlatformBlock(
    input: Parameters<AccountRepository["commitPlatformBlock"]>[0],
  ): Promise<"updated" | "actor-forbidden" | "target-not-found" | "self-block" | "last-admin"> {
    const requireActor = this.#requirePlatformActor(input);
    const requireTarget = this.db.prepare(
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ?) THEN 1 ELSE json_extract('invalid', '$') END AS allowed",
    ).bind(input.targetAccountId);
    const requireNotSelf = this.db.prepare(
      "SELECT CASE WHEN ? = 0 OR ? <> ? THEN 1 ELSE json_extract('invalid', '$') END AS allowed",
    ).bind(Number(input.blocked), input.actorAccountId, input.targetAccountId);
    const requireRemainingAdmin = this.db.prepare(
      `SELECT CASE WHEN ? = 0
        OR EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ? AND blocked_at IS NOT NULL)
        OR NOT EXISTS (SELECT 1 FROM cas_account_platform_authorities
          WHERE account_id = ? AND authority = 'platform.admin')
        OR (SELECT COUNT(*) FROM cas_account_platform_authorities authority
          JOIN cas_accounts account ON account.account_id = authority.account_id
          WHERE authority.authority = 'platform.admin' AND account.blocked_at IS NULL) > 1
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(Number(input.blocked), input.targetAccountId, input.targetAccountId);
    const audit = this.db.prepare(
      `INSERT INTO cas_platform_audit_events
        (event_id, actor_issuer, actor_subject, target_issuer, target_subject,
         target_invitation_id, action, result, request_id, created_at, details_json,
         actor_account_id, actor_external_identity_id, target_account_id)
       SELECT ?, actor.issuer, actor.subject, NULL, NULL, NULL, ?, 'succeeded', ?, ?, '{}', ?, ?, ?
       FROM cas_external_identities actor
       WHERE actor.external_identity_id = ? AND actor.account_id = ? AND actor.unlinked_at IS NULL
         AND EXISTS (SELECT 1 FROM cas_accounts target WHERE target.account_id = ?
           AND ((? = 1 AND target.blocked_at IS NULL) OR (? = 0 AND target.blocked_at IS NOT NULL)))`,
    ).bind(
      input.eventId,
      input.blocked ? "platform_access.blocked" : "platform_access.restored",
      input.requestId ?? null,
      input.now,
      input.actorAccountId,
      input.actorExternalIdentityId,
      input.targetAccountId,
      input.actorExternalIdentityId,
      input.actorAccountId,
      input.targetAccountId,
      Number(input.blocked),
      Number(input.blocked),
    );
    const mutate = input.blocked
      ? this.db.prepare(
        `UPDATE cas_accounts SET blocked_at = ?, credential_version = credential_version + 1, updated_at = ?
         WHERE account_id = ? AND EXISTS (SELECT 1 FROM cas_platform_audit_events WHERE event_id = ?)`,
      ).bind(input.now, input.now, input.targetAccountId, input.eventId)
      : this.db.prepare(
        `UPDATE cas_accounts SET blocked_at = NULL, updated_at = ?
         WHERE account_id = ? AND EXISTS (SELECT 1 FROM cas_platform_audit_events WHERE event_id = ?)`,
      ).bind(input.now, input.targetAccountId, input.eventId);
    try {
      await this.db.batch([
        requireActor,
        requireTarget,
        requireNotSelf,
        requireRemainingAdmin,
        audit,
        mutate,
        ...this.#accountSnapshotStatements(input.eventId),
      ]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      if (input.blocked && input.actorAccountId === input.targetAccountId) return "self-block";
      const failure = await this.#platformMutationFailure(input, input.blocked);
      if (failure === "unclassified") throw error;
      return failure;
    }
  }

  async getAppAuditEventPosition(appId: AppId, eventId: string) {
    const row = await this.db.prepare(
      "SELECT created_at, event_id FROM cas_control_audit_events WHERE app_id = ? AND event_id = ?",
    ).bind(appId, eventId).first<{ created_at: number; event_id: string }>();
    return row ? { createdAt: row.created_at, eventId: row.event_id } : null;
  }

  async listAppAccountAuditEvents(
    input: Parameters<AccountRepository["listAppAccountAuditEvents"]>[0],
  ): Promise<readonly AppAccountAuditRecord[]> {
    const rows = await this.db.prepare(
      `SELECT event.event_id, event.app_id, event.action, event.target,
         NULL AS target_invitation_id, 'succeeded' AS result, event.request_id,
         event.trace_id, event.caller_channel, event.oauth_client_handle,
         event.tool_name, event.created_at, '{}' AS details_json,
         ${accountAuditProjection}
       FROM cas_control_audit_events event
       JOIN cas_accounts actor_account ON actor_account.account_id = event.original_account_id
       JOIN cas_account_profiles actor_profile ON actor_profile.account_id = actor_account.account_id
       JOIN cas_external_identities actor_identity ON actor_identity.external_identity_id = event.external_identity_id
       LEFT JOIN cas_accounts target_account ON target_account.account_id = event.target_account_id
       LEFT JOIN cas_account_profiles target_profile ON target_profile.account_id = target_account.account_id
       WHERE event.app_id = ?
         AND (? IS NULL OR event.original_account_id = ?)
         AND (? IS NULL OR event.target_account_id = ?)
         AND (event.created_at > ? OR (event.created_at = ? AND event.event_id > ?))
       ORDER BY event.created_at, event.event_id LIMIT ?`,
    ).bind(
      input.appId,
      input.actorAccountId ?? null,
      input.actorAccountId ?? null,
      input.targetAccountId ?? null,
      input.targetAccountId ?? null,
      input.afterCreatedAt,
      input.afterCreatedAt,
      input.afterEventId,
      input.limit,
    ).all<AccountAuditRow>();
    return (rows.results ?? []).map(appAuditRecord);
  }

  async listPlatformAccountAuditEvents(
    input: Parameters<AccountRepository["listPlatformAccountAuditEvents"]>[0],
  ): Promise<readonly PlatformAccountAuditRecord[]> {
    const rows = await this.db.prepare(
      `SELECT event.event_id, NULL AS app_id, event.action, '' AS target,
         event.target_invitation_id, event.result, event.request_id,
         NULL AS trace_id, NULL AS caller_channel, NULL AS oauth_client_handle,
         NULL AS tool_name, event.created_at, event.details_json,
         ${accountAuditProjection}
       FROM cas_platform_audit_events event
       JOIN cas_accounts actor_account ON actor_account.account_id = event.actor_account_id
       JOIN cas_account_profiles actor_profile ON actor_profile.account_id = actor_account.account_id
       JOIN cas_external_identities actor_identity ON actor_identity.external_identity_id = event.actor_external_identity_id
       LEFT JOIN cas_accounts target_account ON target_account.account_id = event.target_account_id
       LEFT JOIN cas_account_profiles target_profile ON target_profile.account_id = target_account.account_id
       WHERE (? IS NULL OR event.action = ?)
         AND (? IS NULL OR event.actor_account_id = ?)
         AND (? IS NULL OR event.target_account_id = ?)
         AND (? IS NULL OR event.created_at > ?)
         AND (? IS NULL OR event.created_at < ? OR (event.created_at = ? AND event.event_id < ?))
       ORDER BY event.created_at DESC, event.event_id DESC LIMIT ?`,
    ).bind(
      input.action ?? null,
      input.action ?? null,
      input.actorAccountId ?? null,
      input.actorAccountId ?? null,
      input.targetAccountId ?? null,
      input.targetAccountId ?? null,
      input.createdAfter ?? null,
      input.createdAfter ?? null,
      input.beforeCreatedAt ?? null,
      input.beforeCreatedAt ?? null,
      input.beforeCreatedAt ?? null,
      input.beforeEventId ?? null,
      input.limit,
    ).all<AccountAuditRow>();
    return (rows.results ?? []).map(platformAuditRecord);
  }

  async createAccountWithIdentity(input: AccountWithIdentityCreate): Promise<"created" | "identity-conflict"> {
    const primary = input.account.primaryVerifiedEmail;
    try {
      await this.db.batch([
        this.db.prepare(
          "INSERT INTO cas_accounts (account_id, blocked_at, credential_version, primary_verified_email, email_verification_source, email_verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          input.account.accountId,
          input.account.blockedAt,
          input.account.credentialVersion,
          primary?.normalizedEmail ?? null,
          primary?.source ?? null,
          primary?.verifiedAt ?? null,
          input.account.createdAt,
          input.account.updatedAt,
        ),
        this.db.prepare(
          "INSERT INTO cas_account_profiles (account_id, display_name, avatar_url, display_name_source, avatar_source, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          input.profile.accountId,
          input.profile.displayName,
          input.profile.avatarUrl,
          input.profile.displayNameSource,
          input.profile.avatarSource,
          input.profile.updatedAt,
        ),
        this.db.prepare(
          "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at, last_authenticated_at, unlinked_at, account_hint, display_name, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          input.identity.externalIdentityId,
          input.identity.accountId,
          input.identity.provider,
          input.identity.issuer,
          input.identity.subject,
          input.identity.linkedAt,
          input.identity.lastAuthenticatedAt,
          input.identity.unlinkedAt,
          input.identity.accountHint,
          input.identity.displayName,
          input.identity.avatarUrl,
        ),
      ]);
      return "created";
    } catch (error) {
      if (await this.getActiveIdentity(input.identity.issuer, input.identity.subject)) {
        return "identity-conflict";
      }
      throw error;
    }
  }

  async commitLinkIdentity(
    input: Parameters<AccountRepository["commitLinkIdentity"]>[0],
  ): Promise<"linked" | "identity-conflict" | "version-mismatch" | "blocked"> {
    const requireAccount = this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts
        WHERE account_id = ? AND blocked_at IS NULL AND credential_version = ?)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(input.accountId, input.expectedCredentialVersion);
    const insertIdentity = this.db.prepare(
      `INSERT INTO cas_external_identities
        (external_identity_id, account_id, provider, issuer, subject, linked_at,
         last_authenticated_at, unlinked_at, account_hint, display_name, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(
      input.identity.externalIdentityId,
      input.identity.accountId,
      input.identity.provider,
      input.identity.issuer,
      input.identity.subject,
      input.identity.linkedAt,
      input.identity.lastAuthenticatedAt,
      input.identity.accountHint,
      input.identity.displayName,
      input.identity.avatarUrl,
    );
    const updateProfile = this.db.prepare(
      `UPDATE cas_account_profiles SET
         display_name = COALESCE(display_name, ?),
         display_name_source = CASE WHEN display_name IS NULL AND ? IS NOT NULL THEN ? ELSE display_name_source END,
         avatar_url = COALESCE(avatar_url, ?),
         avatar_source = CASE WHEN avatar_url IS NULL AND ? IS NOT NULL THEN ? ELSE avatar_source END,
         updated_at = CASE WHEN display_name IS NULL AND ? IS NOT NULL OR avatar_url IS NULL AND ? IS NOT NULL
           THEN ? ELSE updated_at END
       WHERE account_id = ?`,
    ).bind(
      input.displayName,
      input.displayName,
      input.identity.externalIdentityId,
      input.avatarUrl,
      input.avatarUrl,
      input.identity.externalIdentityId,
      input.displayName,
      input.avatarUrl,
      input.now,
      input.accountId,
    );
    const incrementVersion = this.db.prepare(
      "UPDATE cas_accounts SET credential_version = credential_version + 1, updated_at = ? WHERE account_id = ? AND blocked_at IS NULL AND credential_version = ?",
    ).bind(input.now, input.accountId, input.expectedCredentialVersion);
    const requireIncremented = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS incremented",
    );
    try {
      await this.db.batch([requireAccount, insertIdentity, updateProfile, incrementVersion, requireIncremented]);
      return "linked";
    } catch (error) {
      if (!isJsonFailure(error) && !isUniqueFailure(error)) throw error;
      const existing = await this.getActiveIdentity(input.identity.issuer, input.identity.subject);
      if (existing) return "identity-conflict";
      const account = await this.getAccount(input.accountId);
      if (account?.blockedAt !== null) return "blocked";
      return "version-mismatch";
    }
  }

  async commitUnlinkIdentity(
    input: Parameters<AccountRepository["commitUnlinkIdentity"]>[0],
  ): Promise<"unlinked" | "not-found" | "final-identity" | "version-mismatch" | "blocked"> {
    const requireAccount = this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts
        WHERE account_id = ? AND blocked_at IS NULL AND credential_version = ?)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(input.accountId, input.expectedCredentialVersion);
    const requireRemaining = this.db.prepare(
      `SELECT CASE WHEN ? <> ?
        AND EXISTS (SELECT 1 FROM cas_external_identities
          WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
        AND EXISTS (SELECT 1 FROM cas_external_identities
          WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
        AND (SELECT COUNT(*) FROM cas_external_identities
          WHERE account_id = ? AND unlinked_at IS NULL) >= 2
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(
      input.targetExternalIdentityId,
      input.remainingExternalIdentityId,
      input.targetExternalIdentityId,
      input.accountId,
      input.remainingExternalIdentityId,
      input.accountId,
      input.accountId,
    );
    const unlink = this.db.prepare(
      "UPDATE cas_external_identities SET unlinked_at = ? WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL",
    ).bind(input.now, input.targetExternalIdentityId, input.accountId);
    const requireUnlinked = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS unlinked",
    );
    const clearProfileSource = this.db.prepare(
      `UPDATE cas_account_profiles SET
         display_name = CASE WHEN display_name_source = ? THEN NULL ELSE display_name END,
         display_name_source = CASE WHEN display_name_source = ? THEN NULL ELSE display_name_source END,
         avatar_url = CASE WHEN avatar_source = ? THEN NULL ELSE avatar_url END,
         avatar_source = CASE WHEN avatar_source = ? THEN NULL ELSE avatar_source END,
         updated_at = CASE WHEN display_name_source = ? OR avatar_source = ? THEN ? ELSE updated_at END
       WHERE account_id = ?`,
    ).bind(
      input.targetExternalIdentityId,
      input.targetExternalIdentityId,
      input.targetExternalIdentityId,
      input.targetExternalIdentityId,
      input.targetExternalIdentityId,
      input.targetExternalIdentityId,
      input.now,
      input.accountId,
    );
    const incrementVersion = this.db.prepare(
      "UPDATE cas_accounts SET credential_version = credential_version + 1, updated_at = ? WHERE account_id = ? AND blocked_at IS NULL AND credential_version = ?",
    ).bind(input.now, input.accountId, input.expectedCredentialVersion);
    const requireIncremented = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS incremented",
    );
    try {
      await this.db.batch([
        requireAccount,
        requireRemaining,
        unlink,
        requireUnlinked,
        clearProfileSource,
        incrementVersion,
        requireIncremented,
      ]);
      return "unlinked";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const account = await this.getAccount(input.accountId);
      if (account?.blockedAt !== null) return "blocked";
      if (account?.credentialVersion !== input.expectedCredentialVersion) return "version-mismatch";
      const target = await this.getIdentity(input.targetExternalIdentityId);
      const remaining = await this.getIdentity(input.remainingExternalIdentityId);
      if (!target || target.accountId !== input.accountId || target.unlinkedAt !== null
        || !remaining || remaining.accountId !== input.accountId || remaining.unlinkedAt !== null) {
        return "not-found";
      }
      const active = await this.db.prepare(
        "SELECT COUNT(*) AS count FROM cas_external_identities WHERE account_id = ? AND unlinked_at IS NULL",
      ).bind(input.accountId).first<{ count: number }>();
      return (active?.count ?? 0) < 2 || input.targetExternalIdentityId === input.remainingExternalIdentityId
        ? "final-identity"
        : "not-found";
    }
  }

  async updateProfile(
    input: Parameters<AccountRepository["updateProfile"]>[0],
  ): Promise<"updated" | "identity-not-found"> {
    const assignments: string[] = [];
    const bindings: unknown[] = [];
    if (input.displayName !== undefined) {
      assignments.push("display_name = ?", "display_name_source = 'user'");
      bindings.push(input.displayName);
    }
    if (input.avatarExternalIdentityId !== undefined) {
      if (input.avatarExternalIdentityId === null) {
        assignments.push("avatar_url = NULL", "avatar_source = 'user'");
      } else {
        const identity = await this.getIdentity(input.avatarExternalIdentityId);
        if (!identity || identity.accountId !== input.accountId || identity.unlinkedAt !== null || !identity.avatarUrl) {
          return "identity-not-found";
        }
        assignments.push("avatar_url = ?", "avatar_source = ?");
        bindings.push(identity.avatarUrl, identity.externalIdentityId);
      }
    }
    if (assignments.length === 0) return "updated";
    assignments.push("updated_at = ?");
    bindings.push(input.now, input.accountId);
    await this.db.batch([
      this.db.prepare(
        `UPDATE cas_account_profiles SET ${assignments.join(", ")} WHERE account_id = ?`,
      ).bind(...bindings),
      this.db.prepare(
        `INSERT INTO cas_control_meta (key, value) VALUES ('snapshot', 1)
         ON CONFLICT(key) DO UPDATE SET value = value + 1`,
      ),
    ]);
    return "updated";
  }

  #requireAppActor(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly appId?: AppId;
    readonly inspection?: { readonly stackId: string };
  }): D1PreparedStatement {
    const appId = input.appId ?? input.inspection?.stackId;
    return this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts WHERE account_id = ? AND blocked_at IS NULL)
        AND EXISTS (SELECT 1 FROM cas_external_identities
          WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
        AND EXISTS (SELECT 1 FROM cas_app_members WHERE app_id = ? AND account_id = ?)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(input.actorAccountId, input.actorExternalIdentityId, input.actorAccountId, appId, input.actorAccountId);
  }

  #requireAccountActor(accountId: AccountId, externalIdentityId: string): D1PreparedStatement {
    return this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts
          WHERE account_id = ? AND blocked_at IS NULL)
        AND EXISTS (SELECT 1 FROM cas_external_identities
          WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(accountId, externalIdentityId, accountId);
  }

  async #isUsableAppActor(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
    readonly appId?: AppId;
    readonly inspection?: { readonly stackId: string };
  }): Promise<boolean> {
    const [account, identity] = await Promise.all([
      this.getAccount(input.actorAccountId),
      this.getIdentity(input.actorExternalIdentityId),
    ]);
    const appId = input.appId ?? input.inspection?.stackId;
    return account !== null && account.blockedAt === null && identity !== null
      && identity.accountId === input.actorAccountId && identity.unlinkedAt === null
      && appId !== undefined && await this.hasAppMembership(input.actorAccountId, appId);
  }

  #appAuditStatement(
    input: {
      readonly actorAccountId: AccountId;
      readonly actorExternalIdentityId: string;
      readonly eventId: string;
      readonly requestId?: string;
      readonly traceId?: string;
      readonly callerChannel?: string;
      readonly oauthClientHandle?: string;
      readonly toolName?: string;
      readonly now: number;
      readonly appId?: AppId;
      readonly inspection?: { readonly stackId: string };
    },
    action: string,
    target: string,
  ): D1PreparedStatement {
    const appId = input.appId ?? input.inspection?.stackId;
    return this.db.prepare(
      `INSERT INTO cas_control_audit_events
        (event_id, app_id, identity_issuer, subject, action, target, request_id,
         trace_id, caller_channel, oauth_client_handle, tool_name, created_at,
         original_account_id, external_identity_id, target_account_id)
       SELECT ?, ?, issuer, subject, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
       FROM cas_external_identities WHERE external_identity_id = ?
         AND account_id = ? AND unlinked_at IS NULL`,
    ).bind(
      input.eventId, appId, action, target, input.requestId ?? null,
      input.traceId ?? null, input.callerChannel ?? null,
      input.oauthClientHandle ?? null, input.toolName ?? null, input.now,
      input.actorAccountId, input.actorExternalIdentityId,
      input.actorExternalIdentityId, input.actorAccountId,
    );
  }

  #controlSnapshotStatements(): readonly D1PreparedStatement[] {
    return [
      this.db.prepare("INSERT OR IGNORE INTO cas_control_meta (key, value) VALUES ('snapshot', 0)"),
      this.db.prepare("UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot'"),
    ];
  }

  #requirePlatformActor(input: {
    readonly actorAccountId: AccountId;
    readonly actorExternalIdentityId: string;
  }): D1PreparedStatement {
    return this.db.prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_accounts
          WHERE account_id = ? AND blocked_at IS NULL)
        AND EXISTS (SELECT 1 FROM cas_account_platform_authorities
          WHERE account_id = ? AND authority = 'platform.admin')
        AND EXISTS (SELECT 1 FROM cas_external_identities
          WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
       THEN 1 ELSE json_extract('invalid', '$') END AS allowed`,
    ).bind(
      input.actorAccountId,
      input.actorAccountId,
      input.actorExternalIdentityId,
      input.actorAccountId,
    );
  }

  #accountSnapshotStatements(eventId: string): readonly D1PreparedStatement[] {
    return [
      this.db.prepare(
        `INSERT OR IGNORE INTO cas_control_meta (key, value)
         SELECT 'snapshot', 0 WHERE EXISTS (SELECT 1 FROM cas_platform_audit_events WHERE event_id = ?)`,
      ).bind(eventId),
      this.db.prepare(
        `UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot'
         AND EXISTS (SELECT 1 FROM cas_platform_audit_events WHERE event_id = ?)`,
      ).bind(eventId),
    ];
  }

  async #platformMutationFailure(
    input: {
      readonly actorAccountId: AccountId;
      readonly actorExternalIdentityId: string;
      readonly targetAccountId: AccountId;
    },
    checkLastAdmin: boolean,
  ): Promise<"actor-forbidden" | "target-not-found" | "last-admin" | "unclassified"> {
    const [actor, actorIdentity, actorAuthorities, target] = await Promise.all([
      this.getAccount(input.actorAccountId),
      this.getIdentity(input.actorExternalIdentityId),
      this.listPlatformAuthorities(input.actorAccountId),
      this.getAccount(input.targetAccountId),
    ]);
    if (!actor || actor.blockedAt !== null || !actorAuthorities.includes("platform.admin")
      || !actorIdentity || actorIdentity.accountId !== input.actorAccountId || actorIdentity.unlinkedAt !== null) {
      return "actor-forbidden";
    }
    if (!target) return "target-not-found";
    if (checkLastAdmin && target.blockedAt === null
      && (await this.listPlatformAuthorities(target.accountId)).includes("platform.admin")) {
      const active = await this.db.prepare(
        `SELECT COUNT(*) AS count FROM cas_account_platform_authorities authority
         JOIN cas_accounts account ON account.account_id = authority.account_id
         WHERE authority.authority = 'platform.admin' AND account.blocked_at IS NULL`,
      ).first<{ count: number }>();
      if ((active?.count ?? 0) <= 1) return "last-admin";
    }
    return "unclassified";
  }
}

function accountRecord(row: AccountRow): AccountRecord {
  const primaryVerifiedEmail = row.primary_verified_email !== null
    && row.email_verification_source !== null
    && row.email_verified_at !== null
    ? {
      normalizedEmail: row.primary_verified_email,
      source: row.email_verification_source,
      verifiedAt: row.email_verified_at,
    }
    : null;
  return {
    accountId: row.account_id,
    blockedAt: row.blocked_at,
    credentialVersion: row.credential_version,
    primaryVerifiedEmail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function externalIdentityRecord(row: ExternalIdentityRow): ExternalIdentityRecord {
  return {
    externalIdentityId: row.external_identity_id,
    accountId: row.account_id,
    provider: row.provider,
    issuer: row.issuer,
    subject: row.subject,
    linkedAt: row.linked_at,
    lastAuthenticatedAt: row.last_authenticated_at,
    unlinkedAt: row.unlinked_at,
    accountHint: row.account_hint,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

function isJsonFailure(error: unknown): boolean {
  return error instanceof Error && /malformed JSON/i.test(error.message);
}

function isUniqueFailure(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function accountPlatformRecord(row: AccountPlatformRow): AccountPlatformViewRecord {
  const platformAuthorities: PlatformAuthority[] = [];
  if (row.platform_admin === 1) platformAuthorities.push("platform.admin");
  if (row.apps_create === 1) platformAuthorities.push("apps.create");
  return {
    account: accountRecord(row),
    profile: {
      accountId: row.account_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      displayNameSource: row.display_name_source,
      avatarSource: row.avatar_source,
      updatedAt: row.profile_updated_at,
    },
    platformAuthorities,
    appMembershipCount: row.app_membership_count,
    lastActiveAt: row.last_active_at,
  };
}

function auditActor(row: AccountAuditRow) {
  return {
    account: accountRecord({
      account_id: row.actor_account_id,
      blocked_at: row.actor_blocked_at,
      credential_version: row.actor_credential_version,
      primary_verified_email: row.actor_primary_verified_email,
      email_verification_source: row.actor_email_verification_source,
      email_verified_at: row.actor_email_verified_at,
      created_at: row.actor_created_at,
      updated_at: row.actor_updated_at,
    }),
    profile: {
      accountId: row.actor_account_id,
      displayName: row.actor_display_name,
      avatarUrl: row.actor_avatar_url,
      displayNameSource: row.actor_display_name_source,
      avatarSource: row.actor_avatar_source,
      updatedAt: row.actor_profile_updated_at,
    },
    identity: externalIdentityRecord({
      external_identity_id: row.actor_external_identity_id,
      account_id: row.actor_account_id,
      provider: row.actor_provider,
      issuer: row.actor_issuer,
      subject: row.actor_subject,
      linked_at: row.actor_linked_at,
      last_authenticated_at: row.actor_last_authenticated_at,
      unlinked_at: row.actor_unlinked_at,
      account_hint: row.actor_account_hint,
      display_name: row.actor_identity_display_name,
      avatar_url: row.actor_identity_avatar_url,
    }),
  };
}

function auditTarget(row: AccountAuditRow): {
  readonly targetAccount: AccountRecord | null;
  readonly targetProfile: AccountProfileRecord | null;
} {
  if (row.target_account_id === null) return { targetAccount: null, targetProfile: null };
  if (row.target_credential_version === null || row.target_created_at === null
    || row.target_updated_at === null || row.target_profile_updated_at === null) {
    throw new Error("Incomplete target Account audit projection");
  }
  return {
    targetAccount: accountRecord({
      account_id: row.target_account_id,
      blocked_at: row.target_blocked_at,
      credential_version: row.target_credential_version,
      primary_verified_email: row.target_primary_verified_email,
      email_verification_source: row.target_email_verification_source,
      email_verified_at: row.target_email_verified_at,
      created_at: row.target_created_at,
      updated_at: row.target_updated_at,
    }),
    targetProfile: {
      accountId: row.target_account_id,
      displayName: row.target_display_name,
      avatarUrl: row.target_avatar_url,
      displayNameSource: row.target_display_name_source,
      avatarSource: row.target_avatar_source,
      updatedAt: row.target_profile_updated_at,
    },
  };
}

function appAuditRecord(row: AccountAuditRow): AppAccountAuditRecord {
  return {
    ...auditActor(row),
    ...auditTarget(row),
    eventId: row.event_id,
    appId: row.app_id,
    action: row.action,
    target: row.target,
    requestId: row.request_id,
    traceId: row.trace_id,
    callerChannel: row.caller_channel,
    oauthClientHandle: row.oauth_client_handle,
    toolName: row.tool_name,
    createdAt: row.created_at,
  };
}

function platformAuditRecord(row: AccountAuditRow): PlatformAccountAuditRecord {
  let details: Readonly<Record<string, string | number | boolean | null>> = {};
  try {
    const parsed = JSON.parse(row.details_json) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      && Object.values(parsed).every(value => value === null || ["string", "number", "boolean"].includes(typeof value))) {
      details = parsed as Readonly<Record<string, string | number | boolean | null>>;
    }
  } catch { /* Invalid legacy details remain redacted. */ }
  return {
    ...auditActor(row),
    ...auditTarget(row),
    eventId: row.event_id,
    action: row.action as PlatformAccountAuditRecord["action"],
    targetInvitationId: row.target_invitation_id,
    result: row.result,
    requestId: row.request_id,
    createdAt: row.created_at,
    details,
  };
}

function oauthIssuerInspectionRecord(row: OAuthIssuerInspectionRow): ControlOAuthIssuerInspectionRecord {
  return {
    inspectionId: row.inspection_id,
    stackId: row.app_id,
    issuer: row.issuer,
    audience: row.audience,
    metadataUrl: row.metadata_url,
    metadataType: row.metadata_type,
    authorizationEndpoint: row.authorization_endpoint,
    tokenEndpoint: row.token_endpoint,
    jwksUri: row.jwks_uri,
    registrationEndpoint: row.registration_endpoint,
    scopesSupported: JSON.parse(row.scopes_supported) as string[],
    codeChallengeMethodsSupported: JSON.parse(row.code_challenge_methods_supported) as string[],
    metadataDigest: row.metadata_digest,
    jwksDigest: row.jwks_digest,
    challengeHash: row.challenge_hash,
    capabilityMaxLifetimeSeconds: row.capability_max_lifetime_seconds,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revision: row.revision,
  };
}
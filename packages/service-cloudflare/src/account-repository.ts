import type { D1Database } from "@cloudflare/workers-types";
import type { AccountId, AppId, PlatformAuthority, PrimaryVerifiedEmail } from "@unicas/admin-protocol";
import type {
  AccountAppMembershipRecord,
  AccountRecord,
  AccountRepository,
  AccountWithIdentityCreate,
  ExternalIdentityRecord,
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

interface AccountMembershipRow extends AccountRow {
  app_id: AppId;
  joined_at: number;
  display_name: string | null;
  avatar_url: string | null;
  display_name_source: string | null;
  avatar_source: string | null;
  profile_updated_at: number;
}

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
         original_account_id, external_identity_id)
       SELECT ?, ?, issuer, subject, 'member.removed', ?, ?, ?, ?, NULL, NULL, ?, ?, ?
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
    await this.db.prepare(
      `UPDATE cas_account_profiles SET ${assignments.join(", ")} WHERE account_id = ?`,
    ).bind(...bindings).run();
    return "updated";
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
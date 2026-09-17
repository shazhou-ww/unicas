import type { D1Database } from "@cloudflare/workers-types";
import type { AccountId, PlatformAuthority, PrimaryVerifiedEmail } from "@unicas/admin-protocol";
import type {
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

  async listPlatformAuthorities(accountId: AccountId): Promise<readonly PlatformAuthority[]> {
    const rows = await this.db.prepare(
      "SELECT authority FROM cas_account_platform_authorities WHERE account_id = ? ORDER BY authority",
    ).bind(accountId).all<{ authority: PlatformAuthority }>();
    return (rows.results ?? []).map(row => row.authority);
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
          "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at, last_authenticated_at, unlinked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          input.identity.externalIdentityId,
          input.identity.accountId,
          input.identity.provider,
          input.identity.issuer,
          input.identity.subject,
          input.identity.linkedAt,
          input.identity.lastAuthenticatedAt,
          input.identity.unlinkedAt,
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
  };
}
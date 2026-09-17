/**
 * CAS_CONTROL_DB schema owned by the Cloudflare deployment adapter.
 * Principal state is deliberately separate from Space node data. Migrations
 * are idempotent and restartable so hosts can safely initialize each binding.
 */

import type { D1Database } from "@cloudflare/workers-types";

const CONTROL_TABLE_MIGRATIONS = [
  "CREATE TABLE IF NOT EXISTS cas_accounts (account_id TEXT PRIMARY KEY CHECK(length(account_id) = 27 AND substr(account_id, 1, 5) = 'acct_'), blocked_at INTEGER CHECK(blocked_at IS NULL OR blocked_at >= 0), credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version >= 1), primary_verified_email TEXT, email_verification_source TEXT CHECK(email_verification_source IS NULL OR email_verification_source IN ('google-oidc','github-emails-api','unicas-email-challenge')), email_verified_at INTEGER CHECK(email_verified_at IS NULL OR email_verified_at >= 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, CHECK((primary_verified_email IS NULL AND email_verification_source IS NULL AND email_verified_at IS NULL) OR (primary_verified_email IS NOT NULL AND email_verification_source IS NOT NULL AND email_verified_at IS NOT NULL)))",
  "CREATE TABLE IF NOT EXISTS cas_account_profiles (account_id TEXT PRIMARY KEY, display_name TEXT, avatar_url TEXT, display_name_source TEXT, avatar_source TEXT, updated_at INTEGER NOT NULL, FOREIGN KEY(account_id) REFERENCES cas_accounts(account_id))",
  "CREATE TABLE IF NOT EXISTS cas_external_identities (external_identity_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','github')), issuer TEXT NOT NULL, subject TEXT NOT NULL, linked_at INTEGER NOT NULL, last_authenticated_at INTEGER, unlinked_at INTEGER, FOREIGN KEY(account_id) REFERENCES cas_accounts(account_id))",
  "CREATE TABLE IF NOT EXISTS cas_account_platform_authorities (account_id TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority IN ('platform.admin','apps.create')), granted_at INTEGER NOT NULL, PRIMARY KEY(account_id, authority), FOREIGN KEY(account_id) REFERENCES cas_accounts(account_id))",
  "CREATE TABLE IF NOT EXISTS cas_account_aliases (source_account_id TEXT PRIMARY KEY, canonical_account_id TEXT NOT NULL, created_at INTEGER NOT NULL, reason TEXT NOT NULL, CHECK(source_account_id <> canonical_account_id), FOREIGN KEY(source_account_id) REFERENCES cas_accounts(account_id), FOREIGN KEY(canonical_account_id) REFERENCES cas_accounts(account_id))",
  "CREATE TABLE IF NOT EXISTS cas_identity_migration_map (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, account_id TEXT NOT NULL UNIQUE, external_identity_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, PRIMARY KEY(identity_issuer, subject), FOREIGN KEY(account_id) REFERENCES cas_accounts(account_id), FOREIGN KEY(external_identity_id) REFERENCES cas_external_identities(external_identity_id))",
  "CREATE TABLE IF NOT EXISTS cas_identity_migration_journal (stage TEXT PRIMARY KEY, source_count INTEGER NOT NULL CHECK(source_count >= 0), mapped_count INTEGER NOT NULL CHECK(mapped_count >= 0), failure_count INTEGER NOT NULL CHECK(failure_count >= 0), completed_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS cas_platform_principals (principal_ref TEXT PRIMARY KEY, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','blocked')), platform_admin INTEGER NOT NULL DEFAULT 0 CHECK(platform_admin IN (0,1)), apps_create INTEGER NOT NULL DEFAULT 0 CHECK(apps_create IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, account_id TEXT, UNIQUE(identity_issuer, subject))",
  "CREATE TABLE IF NOT EXISTS cas_platform_audit_events (event_id TEXT PRIMARY KEY, actor_issuer TEXT NOT NULL, actor_subject TEXT NOT NULL, target_issuer TEXT, target_subject TEXT, target_invitation_id TEXT, action TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('succeeded','denied')), request_id TEXT, created_at INTEGER NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', actor_account_id TEXT, actor_external_identity_id TEXT, target_account_id TEXT, target_external_identity_id TEXT)",
  "CREATE TABLE IF NOT EXISTS cas_platform_invitations (invitation_id TEXT PRIMARY KEY, email_constraint TEXT NOT NULL, platform_admin INTEGER NOT NULL DEFAULT 0 CHECK(platform_admin IN (0,1)), apps_create INTEGER NOT NULL DEFAULT 0 CHECK(apps_create IN (0,1)), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','expired','revoked')), token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, created_by_issuer TEXT NOT NULL, created_by_subject TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_by_account_id TEXT)",
  "CREATE TABLE IF NOT EXISTS cas_platform_invitation_idempotency (actor_issuer TEXT NOT NULL, actor_subject TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, invitation_id TEXT NOT NULL, sealed_token TEXT NOT NULL, expires_at INTEGER NOT NULL, actor_account_id TEXT, PRIMARY KEY(actor_issuer, actor_subject, idempotency_key))",
  "CREATE TABLE IF NOT EXISTS cas_operator_identities (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, display_name TEXT, email_for_display TEXT, created_at INTEGER NOT NULL, account_id TEXT, PRIMARY KEY (identity_issuer, subject))",
  "CREATE TABLE IF NOT EXISTS cas_apps (app_id TEXT NOT NULL, display_name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (app_id))",
  "CREATE TABLE IF NOT EXISTS cas_app_members (app_id TEXT NOT NULL, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, joined_at INTEGER NOT NULL, account_id TEXT, PRIMARY KEY (app_id, identity_issuer, subject))",
  "CREATE TABLE IF NOT EXISTS cas_app_member_invitations (invitation_id TEXT NOT NULL, app_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')), email_constraint TEXT, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (invitation_id))",
  "CREATE TABLE IF NOT EXISTS cas_playground_file_roots (app_id TEXT NOT NULL, owner_key TEXT NOT NULL, root_id TEXT NOT NULL, name TEXT NOT NULL, manifest_hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, account_id TEXT, PRIMARY KEY (app_id, owner_key, root_id))",
  "CREATE TABLE IF NOT EXISTS cas_app_oauth_issuers (app_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'external', issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, metadata_type TEXT NOT NULL CHECK (metadata_type IN ('oauth','oidc')), authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, registration_endpoint TEXT, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK (status IN ('pending','active','stale','incompatible','disabled')), verified_at INTEGER, last_refresh_at INTEGER, last_refresh_error TEXT, jwks_digest TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL DEFAULT 28800 CHECK (capability_max_lifetime_seconds BETWEEN 60 AND 604800), revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (app_id))",
  "CREATE TABLE IF NOT EXISTS cas_app_managed_issuers (app_id TEXT NOT NULL, issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK (status IN ('active','disabled')), verified_at INTEGER NOT NULL, jwks_digest TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (capability_max_lifetime_seconds BETWEEN 60 AND 604800), revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (app_id), UNIQUE (issuer))",
  "CREATE TABLE IF NOT EXISTS cas_oauth_issuer_inspections (inspection_id TEXT NOT NULL, app_id TEXT NOT NULL, issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, metadata_type TEXT NOT NULL CHECK (metadata_type IN ('oauth','oidc')), authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, registration_endpoint TEXT, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', metadata_digest TEXT NOT NULL, jwks_digest TEXT NOT NULL, challenge_hash TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (inspection_id))",
  "CREATE TABLE IF NOT EXISTS cas_oauth_issuer_inspection_keys (inspection_id TEXT NOT NULL, kid TEXT NOT NULL, algorithm TEXT NOT NULL, public_jwk TEXT NOT NULL, PRIMARY KEY (inspection_id, kid))",
  "CREATE TABLE IF NOT EXISTS cas_control_audit_events (event_id TEXT NOT NULL, app_id TEXT, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, request_id TEXT, trace_id TEXT, caller_channel TEXT, oauth_client_handle TEXT, tool_name TEXT, created_at INTEGER NOT NULL, original_account_id TEXT, external_identity_id TEXT, PRIMARY KEY (event_id))",
  "CREATE TABLE IF NOT EXISTS cas_control_idempotency (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, method TEXT NOT NULL, canonical_route TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, account_id TEXT, PRIMARY KEY (identity_issuer, subject, method, canonical_route, idempotency_key))",
  "CREATE TABLE IF NOT EXISTS cas_admin_sessions (session_id TEXT NOT NULL, encrypted_payload TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, account_id TEXT, external_identity_id TEXT, credential_version INTEGER, PRIMARY KEY (session_id))",
  "CREATE TABLE IF NOT EXISTS cas_control_meta (key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (key))",
];

const CONTROL_INDEX_MIGRATIONS = [
  "CREATE UNIQUE INDEX IF NOT EXISTS cas_external_identities_active_key ON cas_external_identities(issuer, subject) WHERE unlinked_at IS NULL",
  "CREATE INDEX IF NOT EXISTS cas_external_identities_by_account ON cas_external_identities(account_id, unlinked_at, last_authenticated_at)",
  "CREATE INDEX IF NOT EXISTS cas_account_authorities_by_authority ON cas_account_platform_authorities(authority, account_id)",
  "CREATE INDEX IF NOT EXISTS cas_account_aliases_by_canonical ON cas_account_aliases(canonical_account_id, source_account_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS cas_platform_principals_by_account ON cas_platform_principals(account_id) WHERE account_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS cas_app_members_by_account ON cas_app_members(app_id, account_id) WHERE account_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS cas_playground_file_roots_by_account ON cas_playground_file_roots(app_id, account_id, name, root_id) WHERE account_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS cas_control_audit_by_account ON cas_control_audit_events(original_account_id, created_at, event_id) WHERE original_account_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS cas_admin_sessions_by_account ON cas_admin_sessions(account_id, credential_version, expires_at) WHERE account_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS cas_invitations_by_token_hash ON cas_app_member_invitations(token_hash)",
  "CREATE INDEX IF NOT EXISTS cas_platform_invitations_by_token_hash ON cas_platform_invitations(token_hash)",
  "CREATE INDEX IF NOT EXISTS cas_platform_invitations_by_email ON cas_platform_invitations(email_constraint, invitation_id)",
  "CREATE INDEX IF NOT EXISTS cas_platform_invitation_idempotency_by_expiry ON cas_platform_invitation_idempotency(expires_at)",
  "CREATE INDEX IF NOT EXISTS cas_playground_file_roots_by_owner ON cas_playground_file_roots(app_id, owner_key, name, root_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS cas_oauth_issuer_by_issuer ON cas_app_oauth_issuers(issuer)",
  "CREATE INDEX IF NOT EXISTS cas_oauth_issuers_by_status ON cas_app_oauth_issuers(status, app_id)",
  "CREATE INDEX IF NOT EXISTS cas_managed_issuers_by_status ON cas_app_managed_issuers(status, app_id)",
  "CREATE INDEX IF NOT EXISTS cas_oauth_inspections_by_app ON cas_oauth_issuer_inspections(app_id, created_at)",
  "CREATE INDEX IF NOT EXISTS cas_oauth_inspections_by_expiry ON cas_oauth_issuer_inspections(expires_at)",
  "CREATE INDEX IF NOT EXISTS cas_control_audit_by_app ON cas_control_audit_events(app_id, created_at, event_id)",
  "CREATE INDEX IF NOT EXISTS cas_control_idempotency_by_expiry ON cas_control_idempotency(expires_at)",
  "CREATE INDEX IF NOT EXISTS cas_admin_sessions_by_expiry ON cas_admin_sessions(expires_at)",
];

export const CONTROL_SCHEMA_MIGRATIONS = [
  ...CONTROL_TABLE_MIGRATIONS,
  ...CONTROL_INDEX_MIGRATIONS,
];

export async function migrateControlSchema(db: D1Database): Promise<void> {
  for (const sql of CONTROL_TABLE_MIGRATIONS) await db.exec(sql);
  await renameColumn(db, "cas_oauth_issuer_inspections", "stack_id", "app_id");
  await renameColumn(db, "cas_control_audit_events", "stack_id", "app_id");
  await ensureColumns(db, "cas_platform_audit_events", {
    actor_account_id: "TEXT",
    actor_external_identity_id: "TEXT",
    target_account_id: "TEXT",
    target_external_identity_id: "TEXT",
    target_invitation_id: "TEXT",
    request_id: "TEXT",
    details_json: "TEXT NOT NULL DEFAULT '{}'",
  });
  await ensureColumns(db, "cas_platform_principals", { account_id: "TEXT" });
  await ensureColumns(db, "cas_platform_invitations", { created_by_account_id: "TEXT" });
  await ensureColumns(db, "cas_platform_invitation_idempotency", { actor_account_id: "TEXT" });
  await ensureColumns(db, "cas_operator_identities", { account_id: "TEXT" });
  await ensureColumns(db, "cas_app_members", { account_id: "TEXT" });
  await ensureColumns(db, "cas_playground_file_roots", { account_id: "TEXT" });
  await ensureColumns(db, "cas_control_audit_events", {
    original_account_id: "TEXT",
    external_identity_id: "TEXT",
  });
  await ensureColumns(db, "cas_control_idempotency", { account_id: "TEXT" });
  await ensureColumns(db, "cas_admin_sessions", {
    account_id: "TEXT",
    external_identity_id: "TEXT",
    credential_version: "INTEGER",
  });
  for (const sql of CONTROL_INDEX_MIGRATIONS) await db.exec(sql);
  await db.prepare(
    `INSERT INTO cas_platform_principals
      (principal_ref, identity_issuer, subject, status, platform_admin,
       apps_create, revision, created_at, updated_at)
     SELECT 'prn_' || lower(hex(randomblob(16))), member.identity_issuer,
       member.subject, 'active', 0, 0, 1, MIN(member.joined_at), MIN(member.joined_at)
     FROM cas_app_members AS member
     LEFT JOIN cas_platform_principals AS access
       ON access.identity_issuer = member.identity_issuer AND access.subject = member.subject
     WHERE access.principal_ref IS NULL
     GROUP BY member.identity_issuer, member.subject`,
  ).run();
}

async function renameColumn(
  db: D1Database,
  table: string,
  legacyName: string,
  currentName: string,
): Promise<void> {
  const current = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set((current.results ?? []).map(column => column.name));
  if (names.has(legacyName) && !names.has(currentName)) {
    await db.exec(`ALTER TABLE ${table} RENAME COLUMN ${legacyName} TO ${currentName}`);
  }
}

async function ensureColumns(
  db: D1Database,
  table: string,
  columns: Readonly<Record<string, string>>,
): Promise<void> {
  const current = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set((current.results ?? []).map(column => column.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!names.has(name)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

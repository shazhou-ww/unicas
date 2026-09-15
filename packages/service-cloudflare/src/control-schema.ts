/**
 * CAS_CONTROL_DB schema owned by the Cloudflare deployment adapter.
 * Principal state is deliberately separate from Space node data. Migrations
 * are idempotent and restartable so hosts can safely initialize each binding.
 */

import type { D1Database } from "@cloudflare/workers-types";

const CONTROL_TABLE_MIGRATIONS = [
  "CREATE TABLE IF NOT EXISTS cas_platform_principals (principal_ref TEXT PRIMARY KEY, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','blocked')), platform_admin INTEGER NOT NULL DEFAULT 0 CHECK(platform_admin IN (0,1)), apps_create INTEGER NOT NULL DEFAULT 0 CHECK(apps_create IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(identity_issuer, subject))",
  "CREATE TABLE IF NOT EXISTS cas_platform_audit_events (event_id TEXT PRIMARY KEY, actor_issuer TEXT NOT NULL, actor_subject TEXT NOT NULL, target_issuer TEXT, target_subject TEXT, action TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('succeeded','denied')), created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS cas_operator_identities (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, display_name TEXT, email_for_display TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (identity_issuer, subject))",
  "CREATE TABLE IF NOT EXISTS cas_apps (app_id TEXT NOT NULL, display_name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (app_id))",
  "CREATE TABLE IF NOT EXISTS cas_app_members (app_id TEXT NOT NULL, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (app_id, identity_issuer, subject))",
  "CREATE TABLE IF NOT EXISTS cas_app_member_invitations (invitation_id TEXT NOT NULL, app_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')), email_constraint TEXT, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (invitation_id))",
  "CREATE TABLE IF NOT EXISTS cas_playground_file_roots (app_id TEXT NOT NULL, owner_key TEXT NOT NULL, root_id TEXT NOT NULL, name TEXT NOT NULL, manifest_hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (app_id, owner_key, root_id))",
  "CREATE TABLE IF NOT EXISTS cas_app_oauth_issuers (app_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'external', issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, metadata_type TEXT NOT NULL CHECK (metadata_type IN ('oauth','oidc')), authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, registration_endpoint TEXT, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK (status IN ('pending','active','stale','incompatible','disabled')), verified_at INTEGER, last_refresh_at INTEGER, last_refresh_error TEXT, jwks_digest TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL DEFAULT 28800 CHECK (capability_max_lifetime_seconds BETWEEN 60 AND 604800), revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (app_id))",
  "CREATE TABLE IF NOT EXISTS cas_app_managed_issuers (app_id TEXT NOT NULL, issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK (status IN ('active','disabled')), verified_at INTEGER NOT NULL, jwks_digest TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (capability_max_lifetime_seconds BETWEEN 60 AND 604800), revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (app_id), UNIQUE (issuer))",
  "CREATE TABLE IF NOT EXISTS cas_oauth_issuer_inspections (inspection_id TEXT NOT NULL, app_id TEXT NOT NULL, issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, metadata_type TEXT NOT NULL CHECK (metadata_type IN ('oauth','oidc')), authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, registration_endpoint TEXT, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', metadata_digest TEXT NOT NULL, jwks_digest TEXT NOT NULL, challenge_hash TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (inspection_id))",
  "CREATE TABLE IF NOT EXISTS cas_oauth_issuer_inspection_keys (inspection_id TEXT NOT NULL, kid TEXT NOT NULL, algorithm TEXT NOT NULL, public_jwk TEXT NOT NULL, PRIMARY KEY (inspection_id, kid))",
  "CREATE TABLE IF NOT EXISTS cas_control_audit_events (event_id TEXT NOT NULL, app_id TEXT, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, request_id TEXT, trace_id TEXT, caller_channel TEXT, oauth_client_handle TEXT, tool_name TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (event_id))",
  "CREATE TABLE IF NOT EXISTS cas_control_idempotency (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, method TEXT NOT NULL, canonical_route TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (identity_issuer, subject, method, canonical_route, idempotency_key))",
  "CREATE TABLE IF NOT EXISTS cas_admin_sessions (session_id TEXT NOT NULL, encrypted_payload TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY (session_id))",
  "CREATE TABLE IF NOT EXISTS cas_control_meta (key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (key))",
];

const CONTROL_INDEX_MIGRATIONS = [
  "CREATE INDEX IF NOT EXISTS cas_invitations_by_token_hash ON cas_app_member_invitations(token_hash)",
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
  for (const sql of CONTROL_SCHEMA_MIGRATIONS) await db.exec(sql);
}

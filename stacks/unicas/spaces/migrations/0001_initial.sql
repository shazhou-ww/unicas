PRAGMA foreign_keys = ON;

CREATE TABLE spaces_principals (
  principal_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE spaces_external_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'github')),
  provider_subject TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES spaces_principals(principal_id) ON DELETE CASCADE,
  display_email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX spaces_external_identities_principal
  ON spaces_external_identities(principal_id);

CREATE TABLE spaces_principal_spaces (
  principal_id TEXT PRIMARY KEY REFERENCES spaces_principals(principal_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  ref_domain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (app_id, space_id),
  UNIQUE (app_id, space_id, ref_domain)
);

CREATE TABLE spaces_sessions (
  session_id_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES spaces_principals(principal_id) ON DELETE CASCADE,
  csrf_token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX spaces_sessions_expiry ON spaces_sessions(expires_at);

CREATE TABLE spaces_oauth_attempts (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX spaces_oauth_attempts_expiry ON spaces_oauth_attempts(expires_at);

CREATE TABLE spaces_file_system_roots (
  root_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL UNIQUE REFERENCES spaces_principals(principal_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE spaces_pending_root_releases (
  request_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES spaces_principals(principal_id) ON DELETE RESTRICT,
  root_id TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (principal_id, root_id, manifest_hash)
);

CREATE INDEX spaces_pending_root_releases_principal
  ON spaces_pending_root_releases(principal_id, created_at);

CREATE TABLE spaces_smoke_runs (
  run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES spaces_principals(principal_id) ON DELETE RESTRICT,
  expires_at INTEGER NOT NULL,
  cleanup_state TEXT NOT NULL CHECK (cleanup_state IN ('active', 'pending', 'complete', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX spaces_smoke_runs_cleanup
  ON spaces_smoke_runs(cleanup_state, expires_at);

CREATE UNIQUE INDEX spaces_smoke_runs_open_principal
  ON spaces_smoke_runs(principal_id)
  WHERE cleanup_state <> 'complete';

CREATE TABLE spaces_smoke_resources (
  run_id TEXT NOT NULL REFERENCES spaces_smoke_runs(run_id) ON DELETE CASCADE,
  root_id TEXT NOT NULL REFERENCES spaces_file_system_roots(root_id) ON DELETE CASCADE,
  absolute_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, absolute_path)
);
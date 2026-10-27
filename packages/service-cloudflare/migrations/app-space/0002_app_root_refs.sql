CREATE TABLE IF NOT EXISTS cas_app_root_revisions (
  app_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  checkpoint INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint >= 0)
);
CREATE TABLE IF NOT EXISTS cas_app_root_refs (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  ref_count INTEGER NOT NULL CHECK (ref_count > 0),
  PRIMARY KEY (app_id, space_id, hash)
);
CREATE TABLE IF NOT EXISTS cas_app_root_events (
  app_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  space_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, revision),
  UNIQUE (app_id, space_id, request_id)
);
CREATE TABLE IF NOT EXISTS cas_app_root_requests (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, space_id, request_id)
);
CREATE TABLE IF NOT EXISTS cas_app_root_cutover (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  source_digest TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS cas_app_root_events_no_update
BEFORE UPDATE ON cas_app_root_events BEGIN
  SELECT RAISE(ABORT, 'Root Ref events are append-only');
END;
CREATE TRIGGER IF NOT EXISTS cas_app_root_events_no_delete
BEFORE DELETE ON cas_app_root_events BEGIN
  SELECT RAISE(ABORT, 'Root Ref events are append-only');
END;

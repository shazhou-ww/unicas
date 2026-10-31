CREATE TABLE IF NOT EXISTS cas_nodes (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  content_size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  lease_started_at INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  child_ref_count INTEGER NOT NULL DEFAULT 0 CHECK (child_ref_count >= 0),
  root_ref_count INTEGER NOT NULL DEFAULT 0 CHECK (root_ref_count >= 0),
  ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1)),
  canonical_stored_bytes INTEGER CHECK (canonical_stored_bytes IS NULL OR canonical_stored_bytes >= 0),
  canonical_observed_at INTEGER CHECK (canonical_observed_at IS NULL OR canonical_observed_at >= 0),
  PRIMARY KEY (app_id, space_id, hash)
);

CREATE TABLE IF NOT EXISTS cas_edges (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  child_hash TEXT NOT NULL,
  PRIMARY KEY (app_id, space_id, parent_hash, ordinal)
);

CREATE TABLE IF NOT EXISTS cas_root_ref_requests (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  ref_domain TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, space_id, ref_domain, request_id)
);

CREATE TABLE IF NOT EXISTS cas_root_domain_events (
  app_id TEXT NOT NULL,
  ref_domain TEXT NOT NULL,
  revision INTEGER NOT NULL,
  space_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, ref_domain, revision)
);

CREATE TABLE IF NOT EXISTS cas_root_domain_refs (
  app_id TEXT NOT NULL,
  ref_domain TEXT NOT NULL,
  space_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  ref_count INTEGER NOT NULL,
  PRIMARY KEY (app_id, ref_domain, space_id, hash)
);

CREATE TABLE IF NOT EXISTS cas_root_domain_revisions (
  app_id TEXT NOT NULL,
  ref_domain TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, ref_domain)
);

CREATE TABLE IF NOT EXISTS cas_upload_reservations (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  stored_bytes INTEGER NOT NULL CHECK (stored_bytes > 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, space_id, hash)
);

CREATE TABLE IF NOT EXISTS cas_direct_upload_sessions (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  temporary_object_key TEXT NOT NULL,
  stored_bytes INTEGER NOT NULL CHECK (stored_bytes > 0),
  lease_duration_ms INTEGER NOT NULL CHECK (lease_duration_ms > 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, space_id, hash),
  UNIQUE (upload_id),
  UNIQUE (temporary_object_key)
);

CREATE TABLE IF NOT EXISTS cas_node_uploads (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  generation TEXT NOT NULL,
  temporary_object_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  cleanup_at INTEGER NOT NULL,
  rejection_code TEXT,
  rejection_message TEXT,
  stored_bytes INTEGER,
  content_size INTEGER,
  content_type TEXT,
  refs_json TEXT,
  PRIMARY KEY (app_id, space_id, hash),
  UNIQUE (temporary_object_key),
  CHECK ((rejection_code IS NULL) = (rejection_message IS NULL)),
  CHECK ((stored_bytes IS NULL) = (content_size IS NULL)),
  CHECK ((stored_bytes IS NULL) = (content_type IS NULL)),
  CHECK ((stored_bytes IS NULL) = (refs_json IS NULL))
);

CREATE TABLE IF NOT EXISTS cas_node_upload_cleanup (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  temporary_object_key TEXT NOT NULL,
  cleanup_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, space_id, temporary_object_key)
);

CREATE TABLE IF NOT EXISTS cas_space_usage (
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  ready_content_bytes INTEGER NOT NULL DEFAULT 0 CHECK (ready_content_bytes >= 0),
  ready_stored_bytes INTEGER NOT NULL DEFAULT 0 CHECK (ready_stored_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  not_ready_node_count INTEGER NOT NULL DEFAULT 0 CHECK (not_ready_node_count >= 0),
  leased_node_count INTEGER NOT NULL DEFAULT 0 CHECK (leased_node_count >= 0),
  unobserved_node_count INTEGER NOT NULL DEFAULT 0 CHECK (unobserved_node_count >= 0),
  repaired_at INTEGER NOT NULL DEFAULT 0 CHECK (repaired_at >= 0),
  PRIMARY KEY (app_id, space_id)
);

CREATE TABLE IF NOT EXISTS cas_usage_projection_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cas_edges_by_child
  ON cas_edges(app_id, space_id, child_hash);
CREATE INDEX IF NOT EXISTS cas_root_domain_events_by_request
  ON cas_root_domain_events(app_id, space_id, ref_domain, request_id);
CREATE INDEX IF NOT EXISTS cas_root_domain_refs_by_scan
  ON cas_root_domain_refs(app_id, ref_domain, space_id, hash);
CREATE INDEX IF NOT EXISTS cas_node_uploads_by_cleanup
  ON cas_node_uploads(app_id, space_id, cleanup_at);
CREATE INDEX IF NOT EXISTS cas_node_upload_cleanup_by_deadline
  ON cas_node_upload_cleanup(app_id, space_id, cleanup_at);
CREATE INDEX IF NOT EXISTS cas_nodes_by_usage_observation
  ON cas_nodes(canonical_observed_at, app_id, space_id, hash);
CREATE INDEX IF NOT EXISTS cas_space_usage_by_repair
  ON cas_space_usage(repaired_at, app_id, space_id);

DELETE FROM cas_space_usage
WHERE NOT EXISTS (
  SELECT 1 FROM cas_usage_projection_migrations WHERE version = 1
);

INSERT INTO cas_space_usage (
  app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
  reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
)
SELECT app_id, space_id, COUNT(*), COALESCE(SUM(content_size), 0),
  COALESCE(SUM(canonical_stored_bytes), 0), 0,
  COALESCE(SUM(CASE WHEN canonical_observed_at IS NOT NULL AND canonical_stored_bytes IS NULL THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN lease_expires_at > 0 THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN canonical_observed_at IS NULL THEN 1 ELSE 0 END), 0)
FROM cas_nodes
WHERE NOT EXISTS (
  SELECT 1 FROM cas_usage_projection_migrations WHERE version = 1
)
GROUP BY app_id, space_id;

INSERT OR IGNORE INTO cas_space_usage (
  app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
  reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
)
SELECT app_id, space_id, 0, 0, 0, COALESCE(SUM(stored_bytes), 0), 0, 0, 0
FROM cas_upload_reservations
WHERE NOT EXISTS (
  SELECT 1 FROM cas_usage_projection_migrations WHERE version = 1
)
GROUP BY app_id, space_id;

UPDATE cas_space_usage
SET reserved_bytes = COALESCE((
  SELECT SUM(reservation.stored_bytes)
  FROM cas_upload_reservations AS reservation
  WHERE reservation.app_id = cas_space_usage.app_id
    AND reservation.space_id = cas_space_usage.space_id
), 0)
WHERE NOT EXISTS (
  SELECT 1 FROM cas_usage_projection_migrations WHERE version = 1
);

INSERT OR IGNORE INTO cas_usage_projection_migrations (version, applied_at)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_update_guard
BEFORE UPDATE ON cas_nodes
WHEN NOT EXISTS (
  SELECT 1 FROM cas_space_usage
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'missing Space usage projection');
END;

CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_delete_guard
BEFORE DELETE ON cas_nodes
WHEN NOT EXISTS (
  SELECT 1 FROM cas_space_usage
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'missing Space usage projection');
END;

CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_insert
AFTER INSERT ON cas_nodes
BEGIN
  INSERT INTO cas_space_usage (
    app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
    reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
  )
  VALUES (
    NEW.app_id, NEW.space_id, 1, NEW.content_size,
    COALESCE(NEW.canonical_stored_bytes, 0), 0,
    (CASE WHEN NEW.canonical_observed_at IS NOT NULL AND NEW.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END),
    (CASE WHEN NEW.lease_expires_at > 0 THEN 1 ELSE 0 END),
    (CASE WHEN NEW.canonical_observed_at IS NULL THEN 1 ELSE 0 END)
  )
  ON CONFLICT(app_id, space_id) DO UPDATE SET
    node_count = node_count + 1,
    ready_content_bytes = ready_content_bytes + NEW.content_size,
    ready_stored_bytes = ready_stored_bytes + COALESCE(NEW.canonical_stored_bytes, 0),
    not_ready_node_count = not_ready_node_count
      + (CASE WHEN NEW.canonical_observed_at IS NOT NULL AND NEW.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END),
    leased_node_count = leased_node_count
      + (CASE WHEN NEW.lease_expires_at > 0 THEN 1 ELSE 0 END),
    unobserved_node_count = unobserved_node_count
      + (CASE WHEN NEW.canonical_observed_at IS NULL THEN 1 ELSE 0 END);
END;

CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_update
AFTER UPDATE OF content_size, lease_expires_at, canonical_stored_bytes, canonical_observed_at ON cas_nodes
BEGIN
  UPDATE cas_space_usage SET
    ready_content_bytes = ready_content_bytes + NEW.content_size - OLD.content_size,
    ready_stored_bytes = ready_stored_bytes
      + COALESCE(NEW.canonical_stored_bytes, 0)
      - COALESCE(OLD.canonical_stored_bytes, 0),
    not_ready_node_count = not_ready_node_count
      + (CASE WHEN NEW.canonical_observed_at IS NOT NULL AND NEW.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.canonical_observed_at IS NOT NULL AND OLD.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END),
    leased_node_count = leased_node_count
      + (CASE WHEN NEW.lease_expires_at > 0 THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.lease_expires_at > 0 THEN 1 ELSE 0 END),
    unobserved_node_count = unobserved_node_count
      + (CASE WHEN NEW.canonical_observed_at IS NULL THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.canonical_observed_at IS NULL THEN 1 ELSE 0 END)
  WHERE app_id = NEW.app_id AND space_id = NEW.space_id;
END;

CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_delete
AFTER DELETE ON cas_nodes
BEGIN
  UPDATE cas_space_usage SET
    node_count = node_count - 1,
    ready_content_bytes = ready_content_bytes - OLD.content_size,
    ready_stored_bytes = ready_stored_bytes - COALESCE(OLD.canonical_stored_bytes, 0),
    not_ready_node_count = not_ready_node_count
      - (CASE WHEN OLD.canonical_observed_at IS NOT NULL AND OLD.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END),
    leased_node_count = leased_node_count
      - (CASE WHEN OLD.lease_expires_at > 0 THEN 1 ELSE 0 END),
    unobserved_node_count = unobserved_node_count
      - (CASE WHEN OLD.canonical_observed_at IS NULL THEN 1 ELSE 0 END)
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id;
  DELETE FROM cas_space_usage
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id
    AND node_count = 0 AND reserved_bytes = 0;
END;

CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_insert
AFTER INSERT ON cas_upload_reservations
BEGIN
  INSERT INTO cas_space_usage (
    app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
    reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
  )
  VALUES (NEW.app_id, NEW.space_id, 0, 0, 0, NEW.stored_bytes, 0, 0, 0)
  ON CONFLICT(app_id, space_id) DO UPDATE SET
    reserved_bytes = reserved_bytes + NEW.stored_bytes;
END;

CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_update_guard
BEFORE UPDATE ON cas_upload_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM cas_space_usage
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'missing Space usage projection');
END;

CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_delete_guard
BEFORE DELETE ON cas_upload_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM cas_space_usage
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'missing Space usage projection');
END;

CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_update
AFTER UPDATE OF stored_bytes ON cas_upload_reservations
BEGIN
  UPDATE cas_space_usage
  SET reserved_bytes = reserved_bytes + NEW.stored_bytes - OLD.stored_bytes
  WHERE app_id = NEW.app_id AND space_id = NEW.space_id;
END;

CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_delete
AFTER DELETE ON cas_upload_reservations
BEGIN
  UPDATE cas_space_usage
  SET reserved_bytes = reserved_bytes - OLD.stored_bytes
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id;
  DELETE FROM cas_space_usage
  WHERE app_id = OLD.app_id AND space_id = OLD.space_id
    AND node_count = 0 AND reserved_bytes = 0;
END;

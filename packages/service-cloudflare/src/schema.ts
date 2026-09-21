/**
 * App-scoped Space storage schema (canonical CAS server).
 *
 * Every Space-owned key carries the stable `appId` namespace so two Apps
 * sharing a textual `spaceId` never share nodes, edges, idempotency, audit,
 * leases, usage, or GC. The domain event/projection/revision tables are the
 * strongly-recorded audit projection; `cas_nodes.root_ref_count` remains the
 * only authoritative lifecycle input.
 */

import type { D1Database } from "@cloudflare/workers-types";

const TABLE_MIGRATIONS = [
  // Authoritative node rows: (appId, spaceId, hash).
  "CREATE TABLE IF NOT EXISTS cas_nodes (app_id TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, content_size INTEGER NOT NULL, content_type TEXT NOT NULL, lease_started_at INTEGER NOT NULL DEFAULT 0, lease_expires_at INTEGER NOT NULL DEFAULT 0, child_ref_count INTEGER NOT NULL DEFAULT 0 CHECK (child_ref_count >= 0), root_ref_count INTEGER NOT NULL DEFAULT 0 CHECK (root_ref_count >= 0), ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1)), canonical_stored_bytes INTEGER CHECK (canonical_stored_bytes IS NULL OR canonical_stored_bytes >= 0), canonical_observed_at INTEGER CHECK (canonical_observed_at IS NULL OR canonical_observed_at >= 0), PRIMARY KEY (app_id, space_id, hash))",

  // Edges: parent -> children with ordinal.
  "CREATE TABLE IF NOT EXISTS cas_edges (app_id TEXT NOT NULL, space_id TEXT NOT NULL, parent_hash TEXT NOT NULL, ordinal INTEGER NOT NULL, child_hash TEXT NOT NULL, PRIMARY KEY (app_id, space_id, parent_hash, ordinal))",

  // Domain-scoped idempotency: (appId, spaceId, refDomain, requestId).
  "CREATE TABLE IF NOT EXISTS cas_root_ref_requests (app_id TEXT NOT NULL, space_id TEXT NOT NULL, ref_domain TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, revision INTEGER NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY (app_id, space_id, ref_domain, request_id))",

  // Domain event log (strongly recorded audit; append-only).
  "CREATE TABLE IF NOT EXISTS cas_root_domain_events (app_id TEXT NOT NULL, ref_domain TEXT NOT NULL, revision INTEGER NOT NULL, space_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, changes_json TEXT NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY (app_id, ref_domain, revision))",

  // Current-balance projection per (appId, refDomain, spaceId, hash).
  "CREATE TABLE IF NOT EXISTS cas_root_domain_refs (app_id TEXT NOT NULL, ref_domain TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, ref_count INTEGER NOT NULL, PRIMARY KEY (app_id, ref_domain, space_id, hash))",

  // Per-(appId, refDomain) monotonic revision allocator.
  "CREATE TABLE IF NOT EXISTS cas_root_domain_revisions (app_id TEXT NOT NULL, ref_domain TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (app_id, ref_domain))",

  // Internal quota reservation for the R2-before-D1 node commit window.
  "CREATE TABLE IF NOT EXISTS cas_upload_reservations (app_id TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, stored_bytes INTEGER NOT NULL CHECK (stored_bytes > 0), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (app_id, space_id, hash))",

  // Direct-to-R2 upload sessions. Ready state remains represented only by cas_nodes.
  "CREATE TABLE IF NOT EXISTS cas_direct_upload_sessions (app_id TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, upload_id TEXT NOT NULL, temporary_object_key TEXT NOT NULL, stored_bytes INTEGER NOT NULL CHECK (stored_bytes > 0), lease_duration_ms INTEGER NOT NULL CHECK (lease_duration_ms > 0), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (app_id, space_id, hash), UNIQUE (upload_id), UNIQUE (temporary_object_key))",

  // V2 lease-driven uploads. State is derived from nullable rejection and
  // validation evidence; no persisted workflow-state enum is used.
  "CREATE TABLE IF NOT EXISTS cas_node_uploads (app_id TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, generation TEXT NOT NULL, temporary_object_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, cleanup_at INTEGER NOT NULL, rejection_code TEXT, rejection_message TEXT, stored_bytes INTEGER, content_size INTEGER, content_type TEXT, refs_json TEXT, PRIMARY KEY (app_id, space_id, hash), UNIQUE (temporary_object_key), CHECK ((rejection_code IS NULL) = (rejection_message IS NULL)), CHECK ((stored_bytes IS NULL) = (content_size IS NULL)), CHECK ((stored_bytes IS NULL) = (content_type IS NULL)), CHECK ((stored_bytes IS NULL) = (refs_json IS NULL)))",

  // Superseded temporary keys retained until deletion succeeds.
  "CREATE TABLE IF NOT EXISTS cas_node_upload_cleanup (app_id TEXT NOT NULL, space_id TEXT NOT NULL, temporary_object_key TEXT NOT NULL, cleanup_at INTEGER NOT NULL, PRIMARY KEY (app_id, space_id, temporary_object_key))",

  // Mutable per-Space projection used by bounded App usage reads.
  "CREATE TABLE IF NOT EXISTS cas_space_usage (app_id TEXT NOT NULL, space_id TEXT NOT NULL, node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0), ready_content_bytes INTEGER NOT NULL DEFAULT 0 CHECK (ready_content_bytes >= 0), ready_stored_bytes INTEGER NOT NULL DEFAULT 0 CHECK (ready_stored_bytes >= 0), reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0), not_ready_node_count INTEGER NOT NULL DEFAULT 0 CHECK (not_ready_node_count >= 0), leased_node_count INTEGER NOT NULL DEFAULT 0 CHECK (leased_node_count >= 0), unobserved_node_count INTEGER NOT NULL DEFAULT 0 CHECK (unobserved_node_count >= 0), repaired_at INTEGER NOT NULL DEFAULT 0 CHECK (repaired_at >= 0), PRIMARY KEY (app_id, space_id))",

  // One-time grouped backfill marker; physical observation proceeds separately.
  "CREATE TABLE IF NOT EXISTS cas_usage_projection_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
];

const INDEX_MIGRATIONS = [
  "CREATE INDEX IF NOT EXISTS cas_edges_by_child ON cas_edges(app_id, space_id, child_hash)",
  "CREATE INDEX IF NOT EXISTS cas_root_domain_events_by_request ON cas_root_domain_events(app_id, space_id, ref_domain, request_id)",
  "CREATE INDEX IF NOT EXISTS cas_root_domain_refs_by_scan ON cas_root_domain_refs(app_id, ref_domain, space_id, hash)",
  "CREATE INDEX IF NOT EXISTS cas_node_uploads_by_cleanup ON cas_node_uploads(app_id, space_id, cleanup_at)",
  "CREATE INDEX IF NOT EXISTS cas_node_upload_cleanup_by_deadline ON cas_node_upload_cleanup(app_id, space_id, cleanup_at)",
  "CREATE INDEX IF NOT EXISTS cas_nodes_by_usage_observation ON cas_nodes(canonical_observed_at, app_id, space_id, hash)",
  "CREATE INDEX IF NOT EXISTS cas_space_usage_by_repair ON cas_space_usage(repaired_at, app_id, space_id)",
];

const TRIGGER_MIGRATIONS = [
  `CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_update_guard BEFORE UPDATE ON cas_nodes
   WHEN NOT EXISTS (SELECT 1 FROM cas_space_usage WHERE app_id = OLD.app_id AND space_id = OLD.space_id)
   BEGIN SELECT RAISE(ABORT, 'missing Space usage projection'); END`,
  `CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_delete_guard BEFORE DELETE ON cas_nodes
   WHEN NOT EXISTS (SELECT 1 FROM cas_space_usage WHERE app_id = OLD.app_id AND space_id = OLD.space_id)
   BEGIN SELECT RAISE(ABORT, 'missing Space usage projection'); END`,
  `CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_insert AFTER INSERT ON cas_nodes BEGIN
    INSERT INTO cas_space_usage (app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes, reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count)
    VALUES (NEW.app_id, NEW.space_id, 1, NEW.content_size, COALESCE(NEW.canonical_stored_bytes, 0), 0,
      CASE WHEN NEW.canonical_observed_at IS NOT NULL AND NEW.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END,
      CASE WHEN NEW.lease_expires_at > 0 THEN 1 ELSE 0 END,
      CASE WHEN NEW.canonical_observed_at IS NULL THEN 1 ELSE 0 END)
    ON CONFLICT(app_id, space_id) DO UPDATE SET
      node_count = node_count + 1,
      ready_content_bytes = ready_content_bytes + NEW.content_size,
      ready_stored_bytes = ready_stored_bytes + COALESCE(NEW.canonical_stored_bytes, 0),
      not_ready_node_count = not_ready_node_count + CASE WHEN NEW.canonical_observed_at IS NOT NULL AND NEW.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END,
      leased_node_count = leased_node_count + CASE WHEN NEW.lease_expires_at > 0 THEN 1 ELSE 0 END,
      unobserved_node_count = unobserved_node_count + CASE WHEN NEW.canonical_observed_at IS NULL THEN 1 ELSE 0 END;
  END`,
  `CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_update AFTER UPDATE OF content_size, lease_expires_at, canonical_stored_bytes, canonical_observed_at ON cas_nodes BEGIN
    UPDATE cas_space_usage SET
      ready_content_bytes = ready_content_bytes + NEW.content_size - OLD.content_size,
      ready_stored_bytes = ready_stored_bytes + COALESCE(NEW.canonical_stored_bytes, 0) - COALESCE(OLD.canonical_stored_bytes, 0),
      not_ready_node_count = not_ready_node_count
        + CASE WHEN NEW.canonical_observed_at IS NOT NULL AND NEW.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END
        - CASE WHEN OLD.canonical_observed_at IS NOT NULL AND OLD.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END,
      leased_node_count = leased_node_count
        + CASE WHEN NEW.lease_expires_at > 0 THEN 1 ELSE 0 END
        - CASE WHEN OLD.lease_expires_at > 0 THEN 1 ELSE 0 END,
      unobserved_node_count = unobserved_node_count
        + CASE WHEN NEW.canonical_observed_at IS NULL THEN 1 ELSE 0 END
        - CASE WHEN OLD.canonical_observed_at IS NULL THEN 1 ELSE 0 END
    WHERE app_id = NEW.app_id AND space_id = NEW.space_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS cas_nodes_usage_delete AFTER DELETE ON cas_nodes BEGIN
    UPDATE cas_space_usage SET
      node_count = node_count - 1,
      ready_content_bytes = ready_content_bytes - OLD.content_size,
      ready_stored_bytes = ready_stored_bytes - COALESCE(OLD.canonical_stored_bytes, 0),
      not_ready_node_count = not_ready_node_count - CASE WHEN OLD.canonical_observed_at IS NOT NULL AND OLD.canonical_stored_bytes IS NULL THEN 1 ELSE 0 END,
      leased_node_count = leased_node_count - CASE WHEN OLD.lease_expires_at > 0 THEN 1 ELSE 0 END,
      unobserved_node_count = unobserved_node_count - CASE WHEN OLD.canonical_observed_at IS NULL THEN 1 ELSE 0 END
    WHERE app_id = OLD.app_id AND space_id = OLD.space_id;
    DELETE FROM cas_space_usage WHERE app_id = OLD.app_id AND space_id = OLD.space_id
      AND node_count = 0 AND reserved_bytes = 0;
  END`,
  `CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_insert AFTER INSERT ON cas_upload_reservations BEGIN
    INSERT INTO cas_space_usage (app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes, reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count)
    VALUES (NEW.app_id, NEW.space_id, 0, 0, 0, NEW.stored_bytes, 0, 0, 0)
    ON CONFLICT(app_id, space_id) DO UPDATE SET reserved_bytes = reserved_bytes + NEW.stored_bytes;
  END`,
  `CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_update_guard BEFORE UPDATE ON cas_upload_reservations
   WHEN NOT EXISTS (SELECT 1 FROM cas_space_usage WHERE app_id = OLD.app_id AND space_id = OLD.space_id)
   BEGIN SELECT RAISE(ABORT, 'missing Space usage projection'); END`,
  `CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_delete_guard BEFORE DELETE ON cas_upload_reservations
   WHEN NOT EXISTS (SELECT 1 FROM cas_space_usage WHERE app_id = OLD.app_id AND space_id = OLD.space_id)
   BEGIN SELECT RAISE(ABORT, 'missing Space usage projection'); END`,
  `CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_update AFTER UPDATE OF stored_bytes ON cas_upload_reservations BEGIN
    UPDATE cas_space_usage SET reserved_bytes = reserved_bytes + NEW.stored_bytes - OLD.stored_bytes
    WHERE app_id = NEW.app_id AND space_id = NEW.space_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS cas_upload_reservations_usage_delete AFTER DELETE ON cas_upload_reservations BEGIN
    UPDATE cas_space_usage SET reserved_bytes = reserved_bytes - OLD.stored_bytes
    WHERE app_id = OLD.app_id AND space_id = OLD.space_id;
    DELETE FROM cas_space_usage WHERE app_id = OLD.app_id AND space_id = OLD.space_id
      AND node_count = 0 AND reserved_bytes = 0;
  END`,
];

export const APP_SPACE_SCHEMA_MIGRATIONS = [
  ...TABLE_MIGRATIONS,
  ...INDEX_MIGRATIONS,
  ...TRIGGER_MIGRATIONS,
];

/** Initialize the App-scoped Space schema. Idempotent. */
export async function migrateAppSpaceSchema(db: D1Database): Promise<void> {
  for (const sql of TABLE_MIGRATIONS) {
    await db.exec(sql);
  }
  await ensureColumn(
    db,
    "ready",
    "ALTER TABLE cas_nodes ADD COLUMN ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1))",
  );
  await ensureColumn(
    db,
    "canonical_stored_bytes",
    "ALTER TABLE cas_nodes ADD COLUMN canonical_stored_bytes INTEGER CHECK (canonical_stored_bytes IS NULL OR canonical_stored_bytes >= 0)",
  );
  await ensureColumn(
    db,
    "canonical_observed_at",
    "ALTER TABLE cas_nodes ADD COLUMN canonical_observed_at INTEGER CHECK (canonical_observed_at IS NULL OR canonical_observed_at >= 0)",
  );
  for (const sql of INDEX_MIGRATIONS) await db.exec(sql);
  for (const sql of TRIGGER_MIGRATIONS) await db.prepare(sql).run();

  const projectionBackfilled = await db.prepare(
    "SELECT 1 AS applied FROM cas_usage_projection_migrations WHERE version = 1",
  ).first<{ applied: number }>();
  if (projectionBackfilled) return;

  await db.batch([
    db.prepare("DELETE FROM cas_space_usage"),
    db.prepare(
      `INSERT INTO cas_space_usage (
         app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
         reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
       )
       SELECT app_id, space_id, COUNT(*), COALESCE(SUM(content_size), 0),
         COALESCE(SUM(canonical_stored_bytes), 0), 0,
         COALESCE(SUM(CASE WHEN canonical_observed_at IS NOT NULL AND canonical_stored_bytes IS NULL THEN 1 ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN lease_expires_at > 0 THEN 1 ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN canonical_observed_at IS NULL THEN 1 ELSE 0 END), 0)
       FROM cas_nodes GROUP BY app_id, space_id`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO cas_space_usage (
         app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
         reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
       )
       SELECT app_id, space_id, 0, 0, 0, COALESCE(SUM(stored_bytes), 0), 0, 0, 0
       FROM cas_upload_reservations GROUP BY app_id, space_id`,
    ),
    db.prepare(
      `UPDATE cas_space_usage SET reserved_bytes = COALESCE((
         SELECT SUM(reservation.stored_bytes) FROM cas_upload_reservations AS reservation
         WHERE reservation.app_id = cas_space_usage.app_id
           AND reservation.space_id = cas_space_usage.space_id
       ), 0)`,
    ),
    db.prepare(
      "INSERT OR IGNORE INTO cas_usage_projection_migrations (version, applied_at) VALUES (1, ?)",
    ).bind(Date.now()),
  ]);
}

async function ensureColumn(db: D1Database, name: string, alterSql: string): Promise<void> {
  if (await hasColumn(db, name)) return;
  try {
    await db.exec(alterSql);
  } catch (error) {
    if (!await hasColumn(db, name)) throw error;
  }
}

async function hasColumn(db: D1Database, name: string): Promise<boolean> {
  const columns = await db.prepare("PRAGMA table_info(cas_nodes)").all<{ name: string }>();
  return columns.results.some((column) => column.name === name);
}

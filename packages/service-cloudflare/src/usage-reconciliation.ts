import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { appCanonicalNodeKey } from "./do-names.js";

export const DEFAULT_USAGE_RECONCILE_MAX_NODES = 100;

interface UsageObservationRow {
  readonly app_id: string;
  readonly space_id: string;
  readonly hash: string;
}

export interface UsageReconciliationResult {
  readonly examined: number;
  readonly observed: number;
  readonly missing: number;
  readonly failed: number;
  readonly backfill: boolean;
}

export async function reconcileAppUsageObservations(input: {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly limit?: number;
  readonly now?: () => number;
}): Promise<UsageReconciliationResult> {
  const limit = input.limit ?? DEFAULT_USAGE_RECONCILE_MAX_NODES;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("usage reconciliation limit must be a positive integer");
  }

  let rows = await input.db.prepare(
    `SELECT app_id, space_id, hash FROM cas_nodes
     WHERE canonical_observed_at IS NULL
     ORDER BY app_id, space_id, hash LIMIT ?`,
  ).bind(limit).all<UsageObservationRow>();
  const backfill = rows.results.length > 0;
  if (!backfill) {
    rows = await input.db.prepare(
      `SELECT app_id, space_id, hash FROM cas_nodes
       WHERE canonical_observed_at IS NOT NULL
       ORDER BY canonical_observed_at, app_id, space_id, hash LIMIT ?`,
    ).bind(limit).all<UsageObservationRow>();
  }

  let observed = 0;
  let missing = 0;
  let failed = 0;
  const now = input.now ?? (() => Date.now());
  for (const row of rows.results) {
    try {
      const object = await input.bucket.head(appCanonicalNodeKey(row.app_id, row.space_id, row.hash));
      const observedAt = now();
      try {
        await writeNodeObservation(input.db, row, object?.size ?? null, observedAt);
      } catch {
        await repairSpaceUsageProjection(
          input.db,
          { appId: row.app_id, spaceId: row.space_id },
          observedAt,
        );
        await writeNodeObservation(input.db, row, object?.size ?? null, observedAt);
      }
      observed += 1;
      if (object === null) missing += 1;
    } catch {
      failed += 1;
    }
  }
  return { examined: rows.results.length, observed, missing, failed, backfill };
}

function writeNodeObservation(
  db: D1Database,
  row: UsageObservationRow,
  storedBytes: number | null,
  observedAt: number,
): Promise<void> {
  return db.prepare(
    `UPDATE cas_nodes SET canonical_stored_bytes = ?, canonical_observed_at = ?
     WHERE app_id = ? AND space_id = ? AND hash = ?`,
  ).bind(storedBytes, observedAt, row.app_id, row.space_id, row.hash).run().then(() => undefined);
}

export async function repairSpaceUsageProjection(
  db: D1Database,
  scope: { readonly appId: string; readonly spaceId: string },
  repairedAt = Date.now(),
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM cas_space_usage WHERE app_id = ? AND space_id = ?")
      .bind(scope.appId, scope.spaceId),
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
       FROM cas_nodes WHERE app_id = ? AND space_id = ? GROUP BY app_id, space_id`,
    ).bind(scope.appId, scope.spaceId),
    db.prepare(
      `INSERT OR IGNORE INTO cas_space_usage (
         app_id, space_id, node_count, ready_content_bytes, ready_stored_bytes,
         reserved_bytes, not_ready_node_count, leased_node_count, unobserved_node_count
       )
       SELECT app_id, space_id, 0, 0, 0, COALESCE(SUM(stored_bytes), 0), 0, 0, 0
       FROM cas_upload_reservations
       WHERE app_id = ? AND space_id = ? GROUP BY app_id, space_id`,
    ).bind(scope.appId, scope.spaceId),
    db.prepare(
      `UPDATE cas_space_usage SET reserved_bytes = COALESCE((
         SELECT SUM(stored_bytes) FROM cas_upload_reservations
         WHERE app_id = ? AND space_id = ?
       ), 0) WHERE app_id = ? AND space_id = ?`,
    ).bind(scope.appId, scope.spaceId, scope.appId, scope.spaceId),
    db.prepare(
      "UPDATE cas_space_usage SET repaired_at = ? WHERE app_id = ? AND space_id = ?",
    ).bind(repairedAt, scope.appId, scope.spaceId),
  ]);
}

export async function repairOldestSpaceUsageProjection(input: {
  readonly db: D1Database;
  readonly now?: () => number;
}): Promise<boolean> {
  const scope = await input.db.prepare(
    `SELECT app_id, space_id FROM cas_space_usage
     ORDER BY repaired_at, app_id, space_id LIMIT 1`,
  ).first<{ app_id: string; space_id: string }>();
  if (!scope) return false;
  await repairSpaceUsageProjection(
    input.db,
    { appId: scope.app_id, spaceId: scope.space_id },
    (input.now ?? (() => Date.now()))(),
  );
  return true;
}
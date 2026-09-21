import type { D1Database } from "@cloudflare/workers-types";
import type { AppUsageProjection, AppUsageRepository } from "@unicas/service";

interface AppUsageRow {
  readonly node_count: number;
  readonly ready_content_bytes: number;
  readonly ready_stored_bytes: number;
  readonly reserved_bytes: number;
  readonly not_ready_node_count: number;
  readonly leased_node_count: number;
  readonly unobserved_node_count: number;
}

export const APP_USAGE_QUERY = `SELECT
  COALESCE(SUM(node_count), 0) AS node_count,
  COALESCE(SUM(ready_content_bytes), 0) AS ready_content_bytes,
  COALESCE(SUM(ready_stored_bytes), 0) AS ready_stored_bytes,
  COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes,
  COALESCE(SUM(not_ready_node_count), 0) AS not_ready_node_count,
  COALESCE(SUM(leased_node_count), 0) AS leased_node_count,
  COALESCE(SUM(unobserved_node_count), 0) AS unobserved_node_count
FROM cas_space_usage
WHERE app_id = ?`;

export class CloudflareAppUsageRepository implements AppUsageRepository {
  constructor(readonly db: D1Database) { }

  async readAppUsage(appId: string): Promise<AppUsageProjection> {
    const row = await this.db.prepare(APP_USAGE_QUERY).bind(appId).first<AppUsageRow>();
    return {
      nodeCount: row?.node_count ?? 0,
      readyContentBytes: row?.ready_content_bytes ?? 0,
      readyStoredBytes: row?.ready_stored_bytes ?? 0,
      reservedBytes: row?.reserved_bytes ?? 0,
      notReadyNodeCount: row?.not_ready_node_count ?? 0,
      leasedNodeCount: row?.leased_node_count ?? 0,
      unobservedNodeCount: row?.unobserved_node_count ?? 0,
    };
  }
}
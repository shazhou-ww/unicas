import type { D1Database } from "@cloudflare/workers-types";
import type { AppGcSpaceRepository } from "@unicas/service";

export class CloudflareAppGcRepository implements AppGcSpaceRepository {
  constructor(readonly db: D1Database) { }

  async listUsageBearingSpaceIds(input: {
    readonly appId: string;
    readonly afterSpaceId: string;
    readonly limit: number;
  }): Promise<readonly string[]> {
    const rows = await this.db.prepare(
      `SELECT space_id
       FROM cas_space_usage
       WHERE app_id = ? AND (node_count > 0 OR reserved_bytes > 0) AND space_id > ?
       ORDER BY space_id
       LIMIT ?`,
    ).bind(input.appId, input.afterSpaceId, input.limit).all<{ space_id: string }>();
    return rows.results.map(row => row.space_id);
  }
}

import type { D1Database } from "@cloudflare/workers-types";

/** Never open a new writer over a populated, unreconciled legacy ledger. */
export async function assertRootRefCutover(db: D1Database): Promise<void> {
  const marker = await db.prepare("SELECT singleton FROM cas_app_root_cutover WHERE singleton = 1").first();
  if (marker) return;
  const legacy = await db.prepare(
    `SELECT 1 AS pending FROM cas_root_domain_revisions
     UNION ALL SELECT 1 FROM cas_root_domain_refs
     UNION ALL SELECT 1 FROM cas_root_domain_events
     UNION ALL SELECT 1 FROM cas_root_ref_requests LIMIT 1`,
  ).first();
  if (legacy) throw new Error("Root Ref offline cutover required");
}

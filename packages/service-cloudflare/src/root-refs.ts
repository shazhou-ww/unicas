import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";
import {
  applyRootRefsUpdate,
  type CanonicalRootRefsUpdate,
  type RootRefsUpdateResult,
  type RootRefCommitPlan,
  type RootRefAppState,
  type RootRefNodeState,
  type RootRefRepository,
  type RootRefRequestRecord,
  type RootRefScope,
} from "@unicas/service";
import { appCanonicalNodeKey } from "./do-names.js";
import { listAppRootRefs } from "./audit-reads.js";
import { assertRootRefCutover } from "./root-cutover.js";

export {
  canonicalizeRootRefsUpdate,
  parseRootRefsBody,
  RootRefsErrorCodes,
  RootRefsRetryableError,
  RootRefsValidationError,
  withRootRefsRetry,
} from "@unicas/service";
export type {
  CanonicalRootRefsUpdate,
  RootRefsRetryOptions,
  RootRefsUpdateResult,
  RootRefsErrorCode,
} from "@unicas/service";

export class CloudflareRootRefRepository implements RootRefRepository {
  constructor(readonly db: D1Database, readonly bucket: R2Bucket) {}

  async findRequest(scope: RootRefScope, requestId: string): Promise<RootRefRequestRecord | null> {
    await assertRootRefCutover(this.db);
    const row = await this.db.prepare(
      "SELECT payload_hash, revision FROM cas_app_root_requests WHERE app_id = ? AND space_id = ? AND request_id = ?",
    ).bind(scope.appId, scope.spaceId, requestId).first<{ payload_hash: string; revision: number }>();
    return row === null ? null : { payloadHash: row.payload_hash, revision: row.revision };
  }

  async readNodes(scope: RootRefScope, hashes: readonly string[]): Promise<readonly RootRefNodeState[]> {
    const nodes: RootRefNodeState[] = [];
    for (const hash of hashes) {
      const row = await this.db.prepare(
        "SELECT root_ref_count FROM cas_nodes WHERE app_id = ? AND space_id = ? AND hash = ?",
      ).bind(scope.appId, scope.spaceId, hash).first<{ root_ref_count: number }>();
      if (row) nodes.push({ hash, rootRefCount: row.root_ref_count });
    }
    return nodes;
  }

  async findUnreadyNode(scope: RootRefScope, hashes: readonly string[]): Promise<string | null> {
    for (const hash of hashes) {
      if (!(await this.bucket.head(appCanonicalNodeKey(scope.appId, scope.spaceId, hash)))) return hash;
    }
    return null;
  }

  async readAppState(scope: RootRefScope): Promise<RootRefAppState> {
    const revision = await this.db.prepare(
      "SELECT revision FROM cas_app_root_revisions WHERE app_id = ?",
    ).bind(scope.appId).first<{ revision: number }>();
    const rows = await this.db.prepare(
      "SELECT hash, ref_count FROM cas_app_root_refs WHERE app_id = ? AND space_id = ?",
    ).bind(scope.appId, scope.spaceId).all<{ hash: string; ref_count: number }>();
    return {
      revision: revision?.revision ?? 0,
      balances: new Map(rows.results.map(row => [row.hash, row.ref_count])),
    };
  }

  async commit(plan: RootRefCommitPlan): Promise<"committed" | "revision-conflict"> {
    const { scope } = plan;
    // NOT NULL aborts the whole batch on a lost CAS, including every later delta.
    const batch: D1PreparedStatement[] = [
      this.db.prepare(
        "INSERT OR IGNORE INTO cas_app_root_revisions (app_id, revision) VALUES (?, 0)",
      ).bind(scope.appId),
      this.db.prepare(
        `UPDATE cas_app_root_revisions SET revision =
         CASE WHEN revision = ? THEN ? ELSE NULL END WHERE app_id = ?`,
      ).bind(plan.expectedRevision, plan.revision, scope.appId),
    ];
    for (const [hash, delta] of plan.entries) {
      batch.push(this.db.prepare(
        "UPDATE cas_nodes SET root_ref_count = root_ref_count + ? WHERE app_id = ? AND space_id = ? AND hash = ?",
      ).bind(delta, scope.appId, scope.spaceId, hash));
      const projection = plan.projections.find(candidate => candidate.hash === hash)!;
      batch.push(projection.refCount === null
        ? this.db.prepare(
          "DELETE FROM cas_app_root_refs WHERE app_id = ? AND space_id = ? AND hash = ?",
        ).bind(scope.appId, scope.spaceId, hash)
        : this.db.prepare(
          `INSERT INTO cas_app_root_refs (app_id, space_id, hash, ref_count) VALUES (?, ?, ?, ?)
           ON CONFLICT(app_id, space_id, hash) DO UPDATE SET ref_count = excluded.ref_count`,
        ).bind(scope.appId, scope.spaceId, hash, projection.refCount));
    }
    batch.push(this.db.prepare(
      `INSERT INTO cas_app_root_events
       (app_id, revision, space_id, request_id, payload_hash, changes_json, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(scope.appId, plan.revision, scope.spaceId, plan.requestId, plan.payloadHash, plan.changesJson, plan.appliedAt));
    batch.push(this.db.prepare(
      `INSERT INTO cas_app_root_requests (app_id, space_id, request_id, payload_hash, revision, applied_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(scope.appId, scope.spaceId, plan.requestId, plan.payloadHash, plan.revision, plan.appliedAt));
    await this.db.batch(batch);
    return "committed";
  }
}

export async function listRootRefs(input: {
  readonly db: D1Database;
  readonly appId: string;
  readonly spaceId: string;
  readonly limit: number;
  readonly cursor: string;
}) {
  const page = await listAppRootRefs({
    db: input.db,
    appId: input.appId,
    spaceId: input.spaceId,
    limit: input.limit,
    ...(input.cursor === "" ? {} : { cursor: input.cursor }),
  });
  return {
    revision: page.revision,
    items: page.refs.map(row => ({ hash: row.hash, refCount: row.count })),
    nextCursor: page.nextCursor,
  };
}

export function executeRootRefsUpdate(input: {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly appId: string;
  readonly spaceId: string;
  readonly canonical: CanonicalRootRefsUpdate;
  readonly now?: () => number;
}): Promise<RootRefsUpdateResult> {
  return applyRootRefsUpdate({
    repository: new CloudflareRootRefRepository(input.db, input.bucket),
    appId: input.appId,
    spaceId: input.spaceId,
    canonical: input.canonical,
    now: input.now,
  });
}

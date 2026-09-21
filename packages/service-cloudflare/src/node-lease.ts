import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";
import { hashToHex, sha256 } from "@unicas/codec";
import type {
  AdoptedCanonicalNodePlan,
  CanonicalDirectUploadRepository,
  CanonicalDirectUploadSession,
  CanonicalNodeLeaseRecord,
  CanonicalNodeLeaseRepository,
  CanonicalOrphanObject,
  CanonicalUploadReservation,
  LeaseDrivenNodeUploadRepository,
  LeaseDrivenUploadRecord,
  LeaseDrivenUploadValidation,
  NodeLeaseRecord,
  NodeLeaseScope,
  UploadedCanonicalNodeCommit,
} from "@unicas/service";
import { appCanonicalNodeKey } from "./do-names.js";
import { timeOperation, type TimingSink } from "./timing.js";

/**
 * Short-lived positive "node is ready" cache keyed by hash, used to avoid an
 * R2 HEAD on every readiness check. Nodes are immutable once committed; only
 * cooperative GC can remove them, and GC deletes the D1 row too, so a row hit
 * plus this cache is a safe readiness signal for everything a live document
 * references. Entries expire quickly so a GC'd row is not masked for long.
 */
export interface NodeReadyCache {
  get(hash: string): number | undefined;
  set(hash: string, expiresAt: number): void;
}

/** Positive ready-cache lifetime. */
export const READY_CACHE_TTL_MS = 60_000;

function cacheExpiry(): number {
  return Date.now() + READY_CACHE_TTL_MS;
}

/** D1/R2 adapter for node renewal, upload, and canonical orphan adoption. */
export class CloudflareNodeLeaseRepository implements CanonicalNodeLeaseRepository, CanonicalDirectUploadRepository, LeaseDrivenNodeUploadRepository {
  constructor(
    readonly db: D1Database,
    readonly bucket: R2Bucket,
    readonly timing?: TimingSink,
    readonly readyCache?: NodeReadyCache,
  ) { }

  async readNodeLease(scope: NodeLeaseScope, hash: string): Promise<NodeLeaseRecord | null> {
    const row = await timeOperation(this.timing, "cas_d1_lease", () => this.db.prepare(
      "SELECT lease_started_at, lease_expires_at FROM cas_nodes WHERE app_id = ? AND space_id = ? AND hash = ? AND ready = 1",
    ).bind(scope.stackId, scope.tenantId, hash).first<{ lease_started_at: number; lease_expires_at: number }>());
    return row === null ? null : { leaseStartedAt: row.lease_started_at, leaseExpiresAt: row.lease_expires_at };
  }

  async readCanonicalNodeLease(scope: NodeLeaseScope, hash: string): Promise<CanonicalNodeLeaseRecord | null> {
    const row = await timeOperation(this.timing, "cas_d1_lease", () => this.db.prepare(
      "SELECT content_size, content_type, lease_started_at, lease_expires_at FROM cas_nodes WHERE app_id = ? AND space_id = ? AND hash = ? AND ready = 1",
    ).bind(scope.stackId, scope.tenantId, hash).first<{
      content_size: number; content_type: string; lease_started_at: number; lease_expires_at: number;
    }>());
    return row === null ? null : {
      contentSize: row.content_size,
      contentType: row.content_type,
      leaseStartedAt: row.lease_started_at,
      leaseExpiresAt: row.lease_expires_at,
    };
  }

  async readNodeRefs(scope: NodeLeaseScope, hash: string): Promise<readonly string[]> {
    const edges = await timeOperation(this.timing, "cas_d1_refs", () => this.db.prepare(
      "SELECT child_hash FROM cas_edges WHERE app_id = ? AND space_id = ? AND parent_hash = ? ORDER BY ordinal ASC",
    ).bind(scope.stackId, scope.tenantId, hash).all<{ child_hash: string }>());
    return edges.results.map((edge) => edge.child_hash);
  }

  async readCanonicalObject(scope: NodeLeaseScope, hash: string): Promise<CanonicalOrphanObject | null> {
    const object = await timeOperation(this.timing, "cas_r2_head", () =>
      this.bucket.head(appCanonicalNodeKey(scope.stackId, scope.tenantId, hash)));
    if (object === null) return null;
    return {
      storedBytes: object.size,
      ...(object.checksums.sha256 === undefined ? {} : { sha256Hex: hashToHex(new Uint8Array(object.checksums.sha256)) }),
    };
  }

  async readCanonicalBytes(scope: NodeLeaseScope, hash: string): Promise<Uint8Array | null> {
    const object = await timeOperation(this.timing, "cas_r2_read", () =>
      this.bucket.get(appCanonicalNodeKey(scope.stackId, scope.tenantId, hash)));
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async readCanonicalPrefix(scope: NodeLeaseScope, hash: string, length: number): Promise<ReadableStream<Uint8Array> | null> {
    const object = await timeOperation(this.timing, "cas_r2_prefix", () =>
      this.bucket.get(appCanonicalNodeKey(scope.stackId, scope.tenantId, hash), { range: { offset: 0, length } }));
    if (object === null || object.body === undefined) return null;
    return object.body as unknown as ReadableStream<Uint8Array>;
  }

  async isNodeReady(scope: NodeLeaseScope, hash: string): Promise<boolean> {
    const row = await timeOperation(this.timing, "cas_d1_ready", () => this.db.prepare(
      "SELECT 1 AS found FROM cas_nodes WHERE app_id = ? AND space_id = ? AND hash = ? AND ready = 1",
    ).bind(scope.stackId, scope.tenantId, hash).first<{ found: number }>());
    if (row === null) return false;
    const object = await timeOperation(this.timing, "cas_r2_head", () =>
      this.bucket.head(appCanonicalNodeKey(scope.stackId, scope.tenantId, hash)));
    if (object !== null) this.readyCache?.set(hash, cacheExpiry());
    return object !== null;
  }

  async renewNodeLease(scope: NodeLeaseScope, hash: string, lease: NodeLeaseRecord): Promise<void> {
    await timeOperation(this.timing, "cas_d1_renew", () => this.db.prepare(
      "UPDATE cas_nodes SET lease_started_at = ?, lease_expires_at = ? WHERE app_id = ? AND space_id = ? AND hash = ?",
    ).bind(lease.leaseStartedAt, lease.leaseExpiresAt, scope.stackId, scope.tenantId, hash).run());
  }

  async reserveCanonicalUpload(scope: NodeLeaseScope, reservation: CanonicalUploadReservation): Promise<void> {
    await timeOperation(this.timing, "cas_d1_reserve", () => this.db.prepare(
      `INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(app_id, space_id, hash) DO UPDATE SET stored_bytes = excluded.stored_bytes, expires_at = excluded.expires_at`,
    ).bind(scope.stackId, scope.tenantId, reservation.hash, reservation.storedBytes, reservation.createdAt, reservation.expiresAt).run());
  }

  async readCanonicalUploadSession(scope: NodeLeaseScope, hash: string): Promise<CanonicalDirectUploadSession | null> {
    const row = await timeOperation(this.timing, "cas_d1_upload_session", () => this.db.prepare(
      `SELECT upload_id, temporary_object_key, stored_bytes, lease_duration_ms, created_at, expires_at
       FROM cas_direct_upload_sessions WHERE app_id = ? AND space_id = ? AND hash = ?`,
    ).bind(scope.stackId, scope.tenantId, hash).first<{
      upload_id: string;
      temporary_object_key: string;
      stored_bytes: number;
      lease_duration_ms: number;
      created_at: number;
      expires_at: number;
    }>());
    return row === null ? null : {
      hash,
      uploadId: row.upload_id,
      temporaryObjectKey: row.temporary_object_key,
      storedBytes: row.stored_bytes,
      leaseDurationMs: row.lease_duration_ms,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async reserveCanonicalUploadSession(scope: NodeLeaseScope, session: CanonicalDirectUploadSession): Promise<void> {
    await timeOperation(this.timing, "cas_d1_upload_session_reserve", () => this.db.batch([
      this.db.prepare(
        `INSERT INTO cas_direct_upload_sessions
           (app_id, space_id, hash, upload_id, temporary_object_key, stored_bytes, lease_duration_ms, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, space_id, hash) DO UPDATE SET
           upload_id = excluded.upload_id,
           temporary_object_key = excluded.temporary_object_key,
           stored_bytes = excluded.stored_bytes,
           lease_duration_ms = excluded.lease_duration_ms,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      ).bind(
        scope.stackId,
        scope.tenantId,
        session.hash,
        session.uploadId,
        session.temporaryObjectKey,
        session.storedBytes,
        session.leaseDurationMs,
        session.createdAt,
        session.expiresAt,
      ),
      this.db.prepare(
        `INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, space_id, hash) DO UPDATE SET
           stored_bytes = excluded.stored_bytes,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      ).bind(
        scope.stackId,
        scope.tenantId,
        session.hash,
        session.storedBytes,
        session.createdAt,
        session.expiresAt,
      ),
    ]).then(() => undefined));
  }

  async readLeaseDrivenUpload(scope: NodeLeaseScope, hash: string): Promise<LeaseDrivenUploadRecord | null> {
    const row = await timeOperation(this.timing, "cas_d1_node_upload", () => this.db.prepare(
      `SELECT generation, temporary_object_key, created_at, expires_at, cleanup_at,
              rejection_code, rejection_message, stored_bytes, content_size, content_type, refs_json
       FROM cas_node_uploads WHERE app_id = ? AND space_id = ? AND hash = ?`,
    ).bind(scope.stackId, scope.tenantId, hash).first<{
      generation: string;
      temporary_object_key: string;
      created_at: number;
      expires_at: number;
      cleanup_at: number;
      rejection_code: LeaseDrivenUploadRecord["rejection"] extends infer R
      ? R extends { code: infer C } ? C : never
      : never;
      rejection_message: string | null;
      stored_bytes: number | null;
      content_size: number | null;
      content_type: string | null;
      refs_json: string | null;
    }>());
    if (row === null) return null;
    const validation = row.stored_bytes === null
      ? null
      : {
        storedBytes: row.stored_bytes,
        contentSize: row.content_size!,
        contentType: row.content_type!,
        refs: JSON.parse(row.refs_json!) as string[],
      };
    return {
      hash,
      generation: row.generation,
      temporaryObjectKey: row.temporary_object_key,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      cleanupAt: row.cleanup_at,
      rejection: row.rejection_code === null
        ? null
        : { code: row.rejection_code, message: row.rejection_message! },
      validation,
    };
  }

  async countLeaseDrivenUploads(scope: NodeLeaseScope): Promise<number> {
    const row = await timeOperation(this.timing, "cas_d1_node_upload_count", () => this.db.prepare(
      "SELECT COUNT(*) AS count FROM cas_node_uploads WHERE app_id = ? AND space_id = ?",
    ).bind(scope.stackId, scope.tenantId).first<{ count: number }>());
    return row?.count ?? 0;
  }

  async replaceLeaseDrivenUpload(
    scope: NodeLeaseScope,
    expectedGeneration: string | null,
    record: LeaseDrivenUploadRecord,
  ): Promise<boolean> {
    const values = [
      record.generation,
      record.temporaryObjectKey,
      record.createdAt,
      record.expiresAt,
      record.cleanupAt,
      record.rejection?.code ?? null,
      record.rejection?.message ?? null,
      record.validation?.storedBytes ?? null,
      record.validation?.contentSize ?? null,
      record.validation?.contentType ?? null,
      record.validation === null ? null : JSON.stringify(record.validation.refs),
    ];
    if (expectedGeneration === null) {
      const result = await timeOperation(this.timing, "cas_d1_node_upload_replace", () => this.db.prepare(
        `INSERT INTO cas_node_uploads
           (app_id, space_id, hash, generation, temporary_object_key, created_at, expires_at, cleanup_at,
            rejection_code, rejection_message, stored_bytes, content_size, content_type, refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, space_id, hash) DO NOTHING`,
      ).bind(scope.stackId, scope.tenantId, record.hash, ...values).run());
      return result.meta.changes === 1;
    }
    const results = await timeOperation(this.timing, "cas_d1_node_upload_replace", () => this.db.batch([
      this.db.prepare(
        `INSERT INTO cas_node_upload_cleanup (app_id, space_id, temporary_object_key, cleanup_at)
         SELECT app_id, space_id, temporary_object_key, cleanup_at FROM cas_node_uploads
         WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?
         ON CONFLICT(app_id, space_id, temporary_object_key) DO UPDATE SET cleanup_at = excluded.cleanup_at`,
      ).bind(scope.stackId, scope.tenantId, record.hash, expectedGeneration),
      this.db.prepare(
        `UPDATE cas_node_uploads SET
           generation = ?, temporary_object_key = ?, created_at = ?, expires_at = ?, cleanup_at = ?,
           rejection_code = ?, rejection_message = ?, stored_bytes = ?, content_size = ?, content_type = ?, refs_json = ?
         WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?`,
      ).bind(...values, scope.stackId, scope.tenantId, record.hash, expectedGeneration),
    ]));
    return results[1].meta.changes === 1;
  }

  async stageLeaseDrivenUploadValidation(
    scope: NodeLeaseScope,
    hash: string,
    generation: string,
    validation: LeaseDrivenUploadValidation,
  ): Promise<boolean> {
    const results = await timeOperation(this.timing, "cas_d1_node_upload_validate", () => this.db.batch([
      this.db.prepare(
        `UPDATE cas_node_uploads SET stored_bytes = ?, content_size = ?, content_type = ?, refs_json = ?
         WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?`,
      ).bind(
        validation.storedBytes,
        validation.contentSize,
        validation.contentType,
        JSON.stringify(validation.refs),
        scope.stackId,
        scope.tenantId,
        hash,
        generation,
      ),
      this.db.prepare(
        `INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at)
         SELECT app_id, space_id, hash, ?, created_at, cleanup_at FROM cas_node_uploads
         WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?
         ON CONFLICT(app_id, space_id, hash) DO UPDATE SET
           stored_bytes = excluded.stored_bytes,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      ).bind(validation.storedBytes, scope.stackId, scope.tenantId, hash, generation),
    ]));
    return results[0].meta.changes === 1;
  }

  async readTemporaryUploadObject(_scope: NodeLeaseScope, temporaryObjectKey: string) {
    const object = await timeOperation(this.timing, "cas_r2_upload_head", () =>
      this.bucket.head(temporaryObjectKey));
    return object === null ? null : { storedBytes: object.size };
  }

  async readTemporaryUploadBytes(_scope: NodeLeaseScope, temporaryObjectKey: string) {
    const object = await timeOperation(this.timing, "cas_r2_upload_read", () =>
      this.bucket.get(temporaryObjectKey));
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async deleteTemporaryUploadObject(_scope: NodeLeaseScope, temporaryObjectKey: string): Promise<void> {
    await timeOperation(this.timing, "cas_r2_upload_delete", () =>
      this.bucket.delete(temporaryObjectKey));
    await timeOperation(this.timing, "cas_d1_node_upload_cleanup_ack", () => this.db.prepare(
      "DELETE FROM cas_node_upload_cleanup WHERE app_id = ? AND space_id = ? AND temporary_object_key = ?",
    ).bind(_scope.stackId, _scope.tenantId, temporaryObjectKey).run());
  }

  async deleteLeaseDrivenUpload(
    scope: NodeLeaseScope,
    hash: string,
    generation: string,
  ): Promise<void> {
    await timeOperation(this.timing, "cas_d1_node_upload_delete", () => this.db.prepare(
      "DELETE FROM cas_node_uploads WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?",
    ).bind(scope.stackId, scope.tenantId, hash, generation).run());
  }

  async putVerifiedCanonicalBytes(scope: NodeLeaseScope, hash: string, bytes: Uint8Array): Promise<void> {
    const key = appCanonicalNodeKey(scope.stackId, scope.tenantId, hash);
    const stored = await timeOperation(this.timing, "cas_r2_put", () => this.bucket.put(
      key,
      bytes,
      { sha256: hash, onlyIf: { etagDoesNotMatch: "*" } },
    ));
    if (stored !== null) return;
    const existing = await this.readCanonicalBytes(scope, hash);
    if (existing === null || hashToHex(await sha256(existing)) !== hash) {
      throw new Error("Canonical object conflicts with its hash");
    }
  }

  async cleanupExpiredLeaseDrivenUploads(
    scope: NodeLeaseScope,
    now: number,
    limit: number,
  ): Promise<number> {
    const rows = await timeOperation(this.timing, "cas_d1_node_upload_cleanup_scan", () => this.db.prepare(
      `SELECT hash, generation, temporary_object_key FROM cas_node_uploads
       WHERE app_id = ? AND space_id = ? AND cleanup_at <= ?
       ORDER BY cleanup_at ASC, hash ASC LIMIT ?`,
    ).bind(scope.stackId, scope.tenantId, now, limit).all<{
      hash: string;
      generation: string;
      temporary_object_key: string;
    }>());
    let deleted = 0;
    for (const row of rows.results) {
      await this.deleteTemporaryUploadObject(scope, row.temporary_object_key);
      const results = await timeOperation(this.timing, "cas_d1_node_upload_cleanup", () => this.db.batch([
        this.db.prepare(
          `DELETE FROM cas_upload_reservations
           WHERE app_id = ? AND space_id = ? AND hash = ?
             AND EXISTS (
               SELECT 1 FROM cas_node_uploads
               WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?
             )`,
        ).bind(
          scope.stackId,
          scope.tenantId,
          row.hash,
          scope.stackId,
          scope.tenantId,
          row.hash,
          row.generation,
        ),
        this.db.prepare(
          "DELETE FROM cas_node_uploads WHERE app_id = ? AND space_id = ? AND hash = ? AND generation = ?",
        ).bind(scope.stackId, scope.tenantId, row.hash, row.generation),
      ]));
      deleted += results[1].meta.changes;
    }
    const remaining = Math.max(0, limit - deleted);
    if (remaining === 0) return deleted;
    const superseded = await timeOperation(this.timing, "cas_d1_node_upload_cleanup_queue", () => this.db.prepare(
      `SELECT temporary_object_key FROM cas_node_upload_cleanup
       WHERE app_id = ? AND space_id = ? AND cleanup_at <= ?
       ORDER BY cleanup_at ASC, temporary_object_key ASC LIMIT ?`,
    ).bind(scope.stackId, scope.tenantId, now, remaining).all<{ temporary_object_key: string }>());
    for (const row of superseded.results) {
      await this.deleteTemporaryUploadObject(scope, row.temporary_object_key);
      deleted += 1;
    }
    return deleted;
  }

  async deleteCanonicalUploadSession(
    scope: NodeLeaseScope,
    hash: string,
    uploadId: string,
  ): Promise<void> {
    await timeOperation(this.timing, "cas_d1_upload_session_delete", () => this.db.batch([
      this.db.prepare(
        `DELETE FROM cas_upload_reservations
         WHERE app_id = ? AND space_id = ? AND hash = ?
           AND EXISTS (
             SELECT 1 FROM cas_direct_upload_sessions
             WHERE app_id = ? AND space_id = ? AND hash = ? AND upload_id = ?
           )`,
      ).bind(scope.stackId, scope.tenantId, hash, scope.stackId, scope.tenantId, hash, uploadId),
      this.db.prepare(
        "DELETE FROM cas_direct_upload_sessions WHERE app_id = ? AND space_id = ? AND hash = ? AND upload_id = ?",
      ).bind(scope.stackId, scope.tenantId, hash, uploadId),
    ]).then(() => undefined));
  }

  async putCanonicalObject(scope: NodeLeaseScope, hash: string, body: ReadableStream<Uint8Array>): Promise<void> {
    const key = appCanonicalNodeKey(scope.stackId, scope.tenantId, hash);
    try {
      const stored = await timeOperation(this.timing, "cas_r2_put", () => this.bucket.put(
        key,
        body as unknown as Parameters<R2Bucket["put"]>[1],
        { sha256: hash, onlyIf: { etagDoesNotMatch: "*" } },
      ));
      if (stored === null) {
        const existing = await this.readCanonicalBytes(scope, hash);
        if (existing === null || hashToHex(await sha256(existing)) !== hash) {
          throw new Error("Canonical object conflicts with its hash");
        }
      }
    } catch (error) {
      // The cloud-neutral kernel sanitizes this into a stable client error;
      // keep the platform detail (e.g. R2 checksum failure) in the logs only.
      console.error(`R2 canonical upload failed for ${scope.stackId}/${scope.tenantId}/${hash}`, error);
      throw error;
    }
  }

  async commitUploadedCanonicalNode(scope: NodeLeaseScope, plan: UploadedCanonicalNodeCommit): Promise<void> {
    if (plan.kind === "existing") {
      await timeOperation(this.timing, "cas_d1_commit", () => this.db.batch([
        this.db.prepare(
          `UPDATE cas_nodes SET lease_started_at = ?, lease_expires_at = ?,
             canonical_stored_bytes = ?, canonical_observed_at = ?
           WHERE app_id = ? AND space_id = ? AND hash = ?`,
        ).bind(
          plan.leaseStartedAt,
          plan.leaseExpiresAt,
          plan.storedBytes,
          Date.now(),
          scope.stackId,
          scope.tenantId,
          plan.hash,
        ),
        this.db.prepare("DELETE FROM cas_upload_reservations WHERE app_id = ? AND space_id = ? AND hash = ?")
          .bind(scope.stackId, scope.tenantId, plan.hash),
        this.db.prepare("DELETE FROM cas_direct_upload_sessions WHERE app_id = ? AND space_id = ? AND hash = ?")
          .bind(scope.stackId, scope.tenantId, plan.hash),
      ]).then(() => undefined));
      this.readyCache?.set(plan.hash, cacheExpiry());
      return;
    }
    await this.commitNewNode(scope, plan);
  }

  async commitAdoptedCanonicalNode(scope: NodeLeaseScope, plan: AdoptedCanonicalNodePlan): Promise<void> {
    const reservation = this.db.prepare(
      `INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(app_id, space_id, hash) DO UPDATE SET stored_bytes = excluded.stored_bytes`,
    ).bind(scope.stackId, scope.tenantId, plan.hash, plan.storedBytes, plan.reservationCreatedAt, plan.reservationExpiresAt);
    await this.commitNewNode(scope, { kind: "new", ...plan }, reservation);
  }

  async commitNewNode(
    scope: NodeLeaseScope,
    plan: Extract<UploadedCanonicalNodeCommit, { kind: "new" }>,
    first?: D1PreparedStatement,
  ): Promise<void> {
    const batch: D1PreparedStatement[] = [];
    if (first) batch.push(first);
    batch.push(this.db.prepare(
      `INSERT INTO cas_nodes (
         app_id, space_id, hash, content_size, content_type, lease_started_at,
         lease_expires_at, canonical_stored_bytes, canonical_observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      scope.stackId,
      scope.tenantId,
      plan.hash,
      plan.contentSize,
      plan.contentType,
      plan.leaseStartedAt,
      plan.leaseExpiresAt,
      plan.storedBytes,
      Date.now(),
    ));
    for (let index = 0; index < plan.refs.length; index++) {
      batch.push(
        this.db.prepare("INSERT INTO cas_edges (app_id, space_id, parent_hash, ordinal, child_hash) VALUES (?, ?, ?, ?, ?)")
          .bind(scope.stackId, scope.tenantId, plan.hash, index, plan.refs[index]),
        this.db.prepare("UPDATE cas_nodes SET child_ref_count = child_ref_count + 1 WHERE app_id = ? AND space_id = ? AND hash = ?")
          .bind(scope.stackId, scope.tenantId, plan.refs[index]),
      );
    }
    batch.push(this.db.prepare("DELETE FROM cas_upload_reservations WHERE app_id = ? AND space_id = ? AND hash = ?")
      .bind(scope.stackId, scope.tenantId, plan.hash));
    batch.push(this.db.prepare("DELETE FROM cas_direct_upload_sessions WHERE app_id = ? AND space_id = ? AND hash = ?")
      .bind(scope.stackId, scope.tenantId, plan.hash));
    await timeOperation(this.timing, "cas_d1_commit", () => this.db.batch(batch).then(() => undefined));
    // The node was uploaded by this same DO and the D1 row is now committed;
    // mark it ready so later child checks in the same flow skip the R2 HEAD.
    this.readyCache?.set(plan.hash, cacheExpiry());
    for (const child of plan.refs) this.readyCache?.set(child, cacheExpiry());
  }
}

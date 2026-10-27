import type { D1Database } from "@cloudflare/workers-types";
import { assertRootRefCutover } from "./root-cutover.js";

export const CAS_AUDIT_DEFAULT_LIMIT = 200;
export const CAS_AUDIT_MAX_LIMIT = 1000;
export const AuditReadErrorCodes = {
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_CURSOR: "INVALID_CURSOR",
  ROOT_REF_SNAPSHOT_CHANGED: "ROOT_REF_SNAPSHOT_CHANGED",
} as const;

export class AuditReadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "AuditReadError";
  }
}

export interface AppRootBalanceRow {
  readonly spaceId: string;
  readonly hash: string;
  readonly count: number;
}
export interface AppRootRefsPage {
  readonly revision: number;
  readonly refs: readonly AppRootBalanceRow[];
  readonly nextCursor: string | null;
}
export interface AppRootEventRow {
  readonly revision: number;
  readonly spaceId: string;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly changes: Record<string, number>;
  readonly appliedAt: number;
}
export interface AppRootEventsPage {
  readonly events: readonly AppRootEventRow[];
  readonly latestRevision: number;
  readonly nextAfter: number;
}

export function parseAuditLimit(value: number | undefined): number | null {
  if (value === undefined) return CAS_AUDIT_DEFAULT_LIMIT;
  return Number.isSafeInteger(value) && value >= 1 && value <= CAS_AUDIT_MAX_LIMIT ? value : null;
}

interface RefsCursor {
  readonly version: 2;
  readonly kind: "refs";
  readonly revision: number;
  readonly appId: string;
  readonly spaceFilter: string | null;
  readonly lastSpace: string;
  readonly lastHash: string;
}
export function encodeRefsCursor(cursor: RefsCursor): string {
  return btoa(JSON.stringify(cursor));
}
export function decodeRefsCursor(value: string): RefsCursor | null {
  let parsed: unknown;
  try { parsed = JSON.parse(atob(value)); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const c = parsed as Record<string, unknown>;
  if (c.version !== 2 || c.kind !== "refs" || typeof c.revision !== "number"
    || !Number.isSafeInteger(c.revision) || c.revision < 0 || typeof c.appId !== "string"
    || (c.spaceFilter !== null && typeof c.spaceFilter !== "string")
    || typeof c.lastSpace !== "string" || typeof c.lastHash !== "string") return null;
  return {
    version: 2, kind: "refs", revision: c.revision, appId: c.appId,
    spaceFilter: c.spaceFilter, lastSpace: c.lastSpace, lastHash: c.lastHash,
  };
}

export async function listAppRootRefs(input: {
  readonly db: D1Database;
  readonly appId: string;
  readonly spaceId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}): Promise<AppRootRefsPage> {
  await assertRootRefCutover(input.db);
  const limit = parseAuditLimit(input.limit);
  if (limit === null) throw new AuditReadError(400, AuditReadErrorCodes.INVALID_REQUEST, "invalid list limit");
  const cursor = input.cursor === undefined ? null : decodeRefsCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new AuditReadError(400, AuditReadErrorCodes.INVALID_CURSOR, "malformed cursor");
  }
  const filter = input.spaceId ?? null;
  if (cursor && (cursor.appId !== input.appId || cursor.spaceFilter !== filter)) {
    throw new AuditReadError(400, AuditReadErrorCodes.INVALID_CURSOR, "cursor scope differs");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = await readAppRevision(input.db, input.appId);
    if (cursor && cursor.revision !== revision) throw snapshotChanged();
    const rows = await input.db.prepare(
      `SELECT space_id, hash, ref_count FROM cas_app_root_refs WHERE app_id = ?
       ${filter === null ? "" : "AND space_id = ?"} AND (space_id, hash) > (?, ?)
       ORDER BY space_id, hash LIMIT ?`,
    ).bind(input.appId, ...(filter === null ? [] : [filter]),
      cursor?.lastSpace ?? "", cursor?.lastHash ?? "", limit + 1,
    ).all<{ space_id: string; hash: string; ref_count: number }>();
    if (await readAppRevision(input.db, input.appId) !== revision) {
      if (cursor) throw snapshotChanged();
      continue;
    }
    const refs = rows.results.slice(0, limit).map(row => ({
      spaceId: row.space_id, hash: row.hash, count: row.ref_count,
    }));
    const last = refs.at(-1);
    return {
      revision, refs,
      nextCursor: rows.results.length > limit && last ? encodeRefsCursor({
        version: 2, kind: "refs", revision, appId: input.appId, spaceFilter: filter,
        lastSpace: last.spaceId, lastHash: last.hash,
      }) : null,
    };
  }
  throw snapshotChanged();
}

export async function listAppRootEvents(input: {
  readonly db: D1Database;
  readonly appId: string;
  readonly spaceId?: string;
  readonly after?: number;
  readonly limit?: number;
}): Promise<AppRootEventsPage> {
  await assertRootRefCutover(input.db);
  const limit = parseAuditLimit(input.limit);
  const after = input.after ?? 0;
  if (limit === null || !Number.isSafeInteger(after) || after < 0) {
    throw new AuditReadError(400, AuditReadErrorCodes.INVALID_REQUEST, "invalid event page");
  }
  const latestRevision = await readAppRevision(input.db, input.appId);
  const rows = await input.db.prepare(
    `SELECT revision, space_id, request_id, payload_hash, changes_json, applied_at
     FROM cas_app_root_events WHERE app_id = ? AND revision > ? AND revision <= ?
     ${input.spaceId === undefined ? "" : "AND space_id = ?"} ORDER BY revision LIMIT ?`,
  ).bind(input.appId, after, latestRevision,
    ...(input.spaceId === undefined ? [] : [input.spaceId]), limit + 1,
  ).all<{ revision: number; space_id: string; request_id: string; payload_hash: string; changes_json: string; applied_at: number }>();
  const events = rows.results.slice(0, limit).map(row => ({
    revision: row.revision, spaceId: row.space_id, requestId: row.request_id,
    payloadHash: row.payload_hash, changes: parseChanges(row.changes_json), appliedAt: row.applied_at,
  }));
  return {
    events, latestRevision,
    nextAfter: rows.results.length > limit
      ? events.at(-1)!.revision : Math.max(after, latestRevision),
  };
}

function parseChanges(text: string): Record<string, number> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid stored Root Ref event");
  const result: Record<string, number> = {};
  for (const [hash, delta] of Object.entries(value)) {
    if (!/^[0-9a-f]{64}$/.test(hash) || typeof delta !== "number" || !Number.isSafeInteger(delta) || delta === 0) {
      throw new Error("invalid stored Root Ref delta");
    }
    result[hash] = delta;
  }
  return result;
}

function snapshotChanged(): AuditReadError {
  return new AuditReadError(409, AuditReadErrorCodes.ROOT_REF_SNAPSHOT_CHANGED, "App revision changed while reading");
}
async function readAppRevision(db: D1Database, appId: string): Promise<number> {
  const row = await db.prepare("SELECT revision FROM cas_app_root_revisions WHERE app_id = ?")
    .bind(appId).first<{ revision: number }>();
  return row?.revision ?? 0;
}

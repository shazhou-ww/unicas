import type {
  SpaceFileRootCatalog,
  SpaceFileRootInfo,
} from "@unicas/space-file-client";
import type { D1Database } from "@cloudflare/workers-types";

export interface PendingRootRelease {
  readonly requestId: string;
  readonly rootId: string;
  readonly manifestHash: string;
}

export class FileRootConflictError extends Error {
  readonly code = "root_revision_conflict";

  constructor(message = "The file root changed; reload and retry") {
    super(message);
  }
}

interface FileRootRow {
  readonly root_id: string;
  readonly name: string;
  readonly manifest_hash: string;
  readonly revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

const selectRoots = `
  SELECT root_id, name, manifest_hash, revision, created_at, updated_at
  FROM spaces_file_system_roots
  WHERE principal_id = ?
  ORDER BY created_at, root_id
`;

export class D1FileRootCatalog implements SpaceFileRootCatalog {
  readonly #db: D1Database;
  readonly #principalId: string;
  readonly #now: () => number;

  constructor(db: D1Database, principalId: string, now: () => number = () => Date.now()) {
    this.#db = db;
    this.#principalId = principalId;
    this.#now = now;
  }

  async list(): Promise<readonly SpaceFileRootInfo[]> {
    const result = await this.#db.prepare(selectRoots).bind(this.#principalId).all<FileRootRow>();
    return result.results.map(toRootInfo);
  }

  async create(input: {
    readonly rootId: string;
    readonly name: string;
    readonly manifestHash: string;
  }): Promise<SpaceFileRootInfo> {
    const now = this.#now();
    try {
      await this.#db.prepare(`
        INSERT INTO spaces_file_system_roots (
          root_id, principal_id, name, manifest_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
      `).bind(input.rootId, this.#principalId, input.name, input.manifestHash, now, now).run();
    } catch (error) {
      if ((await this.list()).length > 0) {
        throw new FileRootConflictError("The Principal already owns a file root");
      }
      throw error;
    }
    return this.#requireRoot(input.rootId);
  }

  async update(input: {
    readonly rootId: string;
    readonly revision: number;
    readonly name: string;
    readonly manifestHash: string;
  }): Promise<SpaceFileRootInfo> {
    const current = await this.#requireRoot(input.rootId);
    if (current.revision !== input.revision) throw new FileRootConflictError();
    const now = this.#now();
    const statements = [];
    if (current.manifestHash !== input.manifestHash) {
      const requestId = `spaces-root:${input.rootId}:revision:${input.revision}:release`;
      statements.push(this.#db.prepare(`
        INSERT INTO spaces_pending_root_releases (
          request_id, principal_id, root_id, manifest_hash, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (principal_id, root_id, manifest_hash) DO NOTHING
      `).bind(requestId, this.#principalId, input.rootId, current.manifestHash, now));
    }
    statements.push(this.#db.prepare(`
      UPDATE spaces_file_system_roots
      SET name = ?, manifest_hash = ?, revision = revision + 1, updated_at = ?
      WHERE root_id = ? AND principal_id = ? AND revision = ?
    `).bind(
      input.name,
      input.manifestHash,
      now,
      input.rootId,
      this.#principalId,
      input.revision,
    ));
    const results = await this.#db.batch(statements);
    if (results.at(-1)?.meta.changes !== 1) throw new FileRootConflictError();
    return this.#requireRoot(input.rootId);
  }

  async delete(input: { readonly rootId: string; readonly revision: number }): Promise<void> {
    const result = await this.#db.prepare(`
      DELETE FROM spaces_file_system_roots
      WHERE root_id = ? AND principal_id = ? AND revision = ?
    `).bind(input.rootId, this.#principalId, input.revision).run();
    if (result.meta.changes !== 1) throw new FileRootConflictError();
  }

  async listPendingReleases(limit = 20): Promise<readonly PendingRootRelease[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Pending release limit must be between 1 and 100");
    }
    const result = await this.#db.prepare(`
      SELECT request_id, root_id, manifest_hash
      FROM spaces_pending_root_releases
      WHERE principal_id = ?
      ORDER BY created_at, request_id LIMIT ?
    `).bind(this.#principalId, limit).all<{
      request_id: string;
      root_id: string;
      manifest_hash: string;
    }>();
    return result.results.map((row) => ({
      requestId: row.request_id,
      rootId: row.root_id,
      manifestHash: row.manifest_hash,
    }));
  }

  async completePendingRelease(requestId: string): Promise<void> {
    await this.#db.prepare(`
      DELETE FROM spaces_pending_root_releases
      WHERE request_id = ? AND principal_id = ?
    `).bind(requestId, this.#principalId).run();
  }

  async #requireRoot(rootId: string): Promise<SpaceFileRootInfo> {
    const row = await this.#db.prepare(`
      SELECT root_id, name, manifest_hash, revision, created_at, updated_at
      FROM spaces_file_system_roots
      WHERE root_id = ? AND principal_id = ?
    `).bind(rootId, this.#principalId).first<FileRootRow>();
    if (!row) throw new FileRootConflictError();
    return toRootInfo(row);
  }
}

function toRootInfo(row: FileRootRow): SpaceFileRootInfo {
  return {
    rootId: row.root_id,
    name: row.name,
    manifestHash: row.manifest_hash,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
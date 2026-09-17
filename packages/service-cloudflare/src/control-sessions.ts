/** D1 persistence for opaque encrypted admin BFF sessions. */

import type { D1Database } from "@cloudflare/workers-types";
import type { ControlSessionRepository, StoredSession } from "@unicas/service";

export class ControlSessionStore implements ControlSessionRepository {
  readonly #db: D1Database;
  readonly #now: () => number;

  constructor(db: D1Database, now: () => number = () => Date.now()) {
    this.#db = db;
    this.#now = now;
  }

  async create(sessionId: string, encryptedPayload: string, ttlMs: number, account?: Parameters<ControlSessionRepository["create"]>[3]): Promise<void> {
    const now = this.#now();
    await this.#db
      .prepare("INSERT INTO cas_admin_sessions (session_id, encrypted_payload, expires_at, created_at, last_seen_at, account_id, external_identity_id, credential_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(sessionId, encryptedPayload, now + ttlMs, now, now, account?.accountId ?? null, account?.externalIdentityId ?? null, account?.credentialVersion ?? null)
      .run();
  }

  async read(sessionId: string): Promise<StoredSession | null> {
    const now = this.#now();
    const row = await this.#db
      .prepare("SELECT session_id, encrypted_payload, expires_at, created_at, last_seen_at FROM cas_admin_sessions WHERE session_id = ?")
      .bind(sessionId)
      .first<StoredSessionRow>();
    if (!row) return null;
    if (row.expires_at <= now) {
      await this.delete(sessionId);
      return null;
    }
    return {
      sessionId: row.session_id,
      encryptedPayload: row.encrypted_payload,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async touch(sessionId: string, ttlMs: number): Promise<void> {
    const now = this.#now();
    await this.#db
      .prepare("UPDATE cas_admin_sessions SET expires_at = ?, last_seen_at = ? WHERE session_id = ?")
      .bind(now + ttlMs, now, sessionId)
      .run();
  }

  async take(sessionId: string): Promise<StoredSession | null> {
    const row = await this.#db.prepare(
      "DELETE FROM cas_admin_sessions WHERE session_id = ? RETURNING session_id, encrypted_payload, expires_at, created_at, last_seen_at",
    ).bind(sessionId).first<StoredSessionRow>();
    if (!row || row.expires_at <= this.#now()) return null;
    return {
      sessionId: row.session_id,
      encryptedPayload: row.encrypted_payload,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async rotateLegacy(input: Parameters<NonNullable<ControlSessionRepository["rotateLegacy"]>>[0]): Promise<boolean> {
    const now = this.#now();
    try {
      await this.#db.batch([
        this.#db.prepare(
          `INSERT INTO cas_admin_sessions
            (session_id, encrypted_payload, expires_at, created_at, last_seen_at, account_id, external_identity_id, credential_version)
           SELECT ?, ?, expires_at, ?, ?, ?, ?, ? FROM cas_admin_sessions
           WHERE session_id = ? AND encrypted_payload = ? AND expires_at > ?`,
        ).bind(input.sessionId, input.encryptedPayload, now, now, input.accountId, input.externalIdentityId,
          input.credentialVersion, input.previousSessionId, input.previousEncryptedPayload, now),
        this.#db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS rotated"),
        this.#db.prepare("DELETE FROM cas_admin_sessions WHERE session_id = ?").bind(input.previousSessionId),
        this.#db.prepare(
          `INSERT INTO cas_identity_migration_journal (stage, source_count, mapped_count, failure_count, completed_at)
           VALUES ('browser-cli-session-rotation', 1, 1, 0, ?)
           ON CONFLICT(stage) DO UPDATE SET source_count = source_count + 1,
             mapped_count = mapped_count + 1, completed_at = excluded.completed_at`,
        ).bind(now),
      ]);
      return true;
    } catch (error) {
      if (error instanceof Error && /malformed JSON/i.test(error.message)) return false;
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.#db
      .prepare("DELETE FROM cas_admin_sessions WHERE session_id = ?")
      .bind(sessionId)
      .run();
  }

  async pruneExpired(): Promise<number> {
    const result = await this.#db
      .prepare("DELETE FROM cas_admin_sessions WHERE expires_at <= ?")
      .bind(this.#now())
      .run();
    return result.meta.changes ?? 0;
  }
}

interface StoredSessionRow {
  readonly session_id: string;
  readonly encrypted_payload: string;
  readonly expires_at: number;
  readonly created_at: number;
  readonly last_seen_at: number;
}

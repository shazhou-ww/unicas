import type { D1Database } from "@cloudflare/workers-types";
import { randomToken, sha256Hex } from "./crypto.js";

export type IdentityProvider = "google" | "microsoft" | "github";
export type PrincipalStatus = "active" | "suspended";

export interface PrincipalContext {
  readonly principalId: string;
  readonly status: PrincipalStatus;
  readonly displayName: string;
  readonly provider: IdentityProvider | "smoke";
  readonly appId: string;
  readonly spaceId: string;
  readonly refDomain: string;
}

export interface OAuthAttempt {
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface IssuedSession {
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly expiresAt: number;
}

export interface AuthenticatedSession {
  readonly context: PrincipalContext;
  readonly csrfTokenHash: string;
  readonly expiresAt: number;
}

export interface SmokeCleanupPlan {
  readonly runId: string;
  readonly principalId: string;
  readonly rootId: string | null;
  readonly state: "pending" | "complete";
  readonly paths: readonly string[];
}

interface PrincipalRow {
  readonly principal_id: string;
  readonly status: PrincipalStatus;
  readonly display_name: string;
  readonly provider: IdentityProvider | null;
  readonly app_id: string;
  readonly space_id: string;
  readonly ref_domain: string;
}

interface SessionRow extends PrincipalRow {
  readonly csrf_token_hash: string;
  readonly expires_at: number;
  readonly last_seen_at: number;
}

const SessionTouchIntervalMs = 5 * 60 * 1000;

export class SpacesRepository {
  readonly #db: D1Database;
  readonly #now: () => number;

  constructor(db: D1Database, now: () => number = () => Date.now()) {
    this.#db = db;
    this.#now = now;
  }

  async createOAuthAttempt(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly lifetimeMs: number;
  }): Promise<void> {
    const now = this.#now();
    await this.#db.prepare(`
      INSERT INTO spaces_oauth_attempts (state_hash, nonce, code_verifier, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(await sha256Hex(input.state), input.nonce, input.codeVerifier, now + input.lifetimeMs, now).run();
  }

  async consumeOAuthAttempt(state: string): Promise<OAuthAttempt | null> {
    const row = await this.#db.prepare(`
      DELETE FROM spaces_oauth_attempts
      WHERE state_hash = ? AND expires_at > ?
      RETURNING nonce, code_verifier
    `).bind(await sha256Hex(state), this.#now()).first<{ nonce: string; code_verifier: string }>();
    return row ? { nonce: row.nonce, codeVerifier: row.code_verifier } : null;
  }

  async resolveExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): Promise<PrincipalContext | null> {
    const row = await this.#db.prepare(`
      SELECT p.principal_id, p.status, p.display_name, i.provider,
             m.app_id, m.space_id, m.ref_domain
      FROM spaces_external_identities i
      JOIN spaces_principals p ON p.principal_id = i.principal_id
      JOIN spaces_principal_spaces m ON m.principal_id = p.principal_id
      WHERE i.provider = ? AND i.provider_subject = ?
    `).bind(provider, providerSubject).first<PrincipalRow>();
    return row ? toPrincipalContext(row) : null;
  }

  async readPrincipal(principalId: string): Promise<PrincipalContext | null> {
    const row = await this.#db.prepare(`
      SELECT p.principal_id, p.status, p.display_name, i.provider,
             m.app_id, m.space_id, m.ref_domain
      FROM spaces_principals p
      LEFT JOIN spaces_external_identities i ON i.principal_id = p.principal_id
      JOIN spaces_principal_spaces m ON m.principal_id = p.principal_id
      WHERE p.principal_id = ?
      ORDER BY CASE i.provider WHEN 'google' THEN 0 WHEN 'microsoft' THEN 1 ELSE 2 END
      LIMIT 1
    `).bind(principalId).first<PrincipalRow>();
    return row ? toPrincipalContext(row) : null;
  }

  async createSession(principalId: string, lifetimeMs: number): Promise<IssuedSession> {
    const sessionId = randomToken();
    const csrfToken = randomToken();
    const now = this.#now();
    const expiresAt = now + lifetimeMs;
    await this.#db.prepare(`
      INSERT INTO spaces_sessions (
        session_id_hash, principal_id, csrf_token_hash, expires_at, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      await sha256Hex(sessionId),
      principalId,
      await sha256Hex(csrfToken),
      expiresAt,
      now,
      now,
    ).run();
    return { sessionId, csrfToken, expiresAt };
  }

  async readSession(sessionId: string): Promise<AuthenticatedSession | null> {
    const sessionIdHash = await sha256Hex(sessionId);
    const row = await this.#db.prepare(`
      SELECT p.principal_id, p.status, p.display_name, i.provider,
             m.app_id, m.space_id, m.ref_domain,
              s.csrf_token_hash, s.expires_at, s.last_seen_at
      FROM spaces_sessions s
      JOIN spaces_principals p ON p.principal_id = s.principal_id
      LEFT JOIN spaces_external_identities i ON i.principal_id = p.principal_id
      JOIN spaces_principal_spaces m ON m.principal_id = p.principal_id
      WHERE s.session_id_hash = ?
      ORDER BY CASE i.provider WHEN 'google' THEN 0 WHEN 'microsoft' THEN 1 ELSE 2 END
      LIMIT 1
    `).bind(sessionIdHash).first<SessionRow>();
    if (!row) return null;
    if (row.expires_at <= this.#now()) {
      await this.#db.prepare("DELETE FROM spaces_sessions WHERE session_id_hash = ?")
        .bind(sessionIdHash).run();
      return null;
    }
    const now = this.#now();
    if (now - row.last_seen_at >= SessionTouchIntervalMs) {
      await this.#db.prepare("UPDATE spaces_sessions SET last_seen_at = ? WHERE session_id_hash = ?")
        .bind(now, sessionIdHash).run();
    }
    return {
      context: toPrincipalContext(row),
      csrfTokenHash: row.csrf_token_hash,
      expiresAt: row.expires_at,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.#db.prepare("DELETE FROM spaces_sessions WHERE session_id_hash = ?")
      .bind(await sha256Hex(sessionId)).run();
  }

  async verifyCsrf(session: AuthenticatedSession, csrfToken: string): Promise<boolean> {
    return await sha256Hex(csrfToken) === session.csrfTokenHash;
  }

  async createSmokeRun(principalId: string, lifetimeMs: number): Promise<{
    readonly runId: string;
    readonly expiresAt: number;
  }> {
    const runId = `smoke-${this.#now()}-${randomToken(9)}`;
    const now = this.#now();
    const expiresAt = now + lifetimeMs;
    await this.#db.prepare(`
      INSERT INTO spaces_smoke_runs (
        run_id, principal_id, expires_at, cleanup_state, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?)
    `).bind(runId, principalId, expiresAt, now, now).run();
    return { runId, expiresAt };
  }

  async trackSmokeResource(input: {
    readonly runId: string;
    readonly principalId: string;
    readonly absolutePath: string;
  }): Promise<boolean> {
    const result = await this.#db.prepare(`
      INSERT INTO spaces_smoke_resources (run_id, root_id, absolute_path, created_at)
      SELECT r.run_id, f.root_id, ?, ?
      FROM spaces_smoke_runs r
      JOIN spaces_file_system_roots f ON f.principal_id = r.principal_id
      WHERE r.run_id = ? AND r.principal_id = ?
        AND r.cleanup_state = 'active' AND r.expires_at > ?
      ON CONFLICT (run_id, absolute_path) DO NOTHING
    `).bind(input.absolutePath, this.#now(), input.runId, input.principalId, this.#now()).run();
    if (result.meta.changes === 1) return true;
    const existing = await this.#db.prepare(`
      SELECT 1 AS found
      FROM spaces_smoke_resources x
      JOIN spaces_smoke_runs r ON r.run_id = x.run_id
      WHERE x.run_id = ? AND x.absolute_path = ? AND r.principal_id = ?
        AND r.cleanup_state = 'active' AND r.expires_at > ?
    `).bind(input.runId, input.absolutePath, input.principalId, this.#now()).first();
    return existing !== null;
  }

  async prepareSmokeCleanup(runId: string, principalId: string): Promise<SmokeCleanupPlan | null> {
    const run = await this.#db.prepare(`
      SELECT r.cleanup_state, f.root_id
      FROM spaces_smoke_runs r
      LEFT JOIN spaces_file_system_roots f ON f.principal_id = r.principal_id
      WHERE r.run_id = ? AND r.principal_id = ?
    `).bind(runId, principalId).first<{ cleanup_state: string; root_id: string | null }>();
    if (!run) return null;
    if (run.cleanup_state === "complete") {
      return { runId, principalId, rootId: null, state: "complete", paths: [] };
    }
    await this.#db.prepare(`
      UPDATE spaces_smoke_runs SET cleanup_state = 'pending', updated_at = ?
      WHERE run_id = ? AND principal_id = ?
    `).bind(this.#now(), runId, principalId).run();
    const resources = await this.#db.prepare(`
      SELECT absolute_path FROM spaces_smoke_resources
      WHERE run_id = ? ORDER BY length(absolute_path), absolute_path
    `).bind(runId).all<{ absolute_path: string }>();
    return {
      runId,
      principalId,
      rootId: run.root_id,
      state: "pending",
      paths: resources.results.map((resource) => resource.absolute_path),
    };
  }

  async completeSmokeCleanup(runId: string, principalId: string): Promise<void> {
    const results = await this.#db.batch([
      this.#db.prepare(`
        UPDATE spaces_smoke_runs SET cleanup_state = 'complete', updated_at = ?
        WHERE run_id = ? AND principal_id = ?
      `).bind(this.#now(), runId, principalId),
      this.#db.prepare("DELETE FROM spaces_smoke_resources WHERE run_id = ?").bind(runId),
    ]);
    if (results[0].meta.changes !== 1) throw new Error("Smoke run not found");
  }

  async failSmokeCleanup(runId: string, principalId: string): Promise<void> {
    await this.#db.prepare(`
      UPDATE spaces_smoke_runs SET cleanup_state = 'failed', updated_at = ?
      WHERE run_id = ? AND principal_id = ? AND cleanup_state <> 'complete'
    `).bind(this.#now(), runId, principalId).run();
  }

  async listExpiredSmokeRuns(limit: number): Promise<readonly { runId: string; principalId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Smoke cleanup limit must be between 1 and 100");
    }
    const result = await this.#db.prepare(`
      SELECT run_id, principal_id FROM spaces_smoke_runs
      WHERE cleanup_state IN ('active', 'pending', 'failed') AND expires_at <= ?
      ORDER BY expires_at, run_id LIMIT ?
    `).bind(this.#now(), limit).all<{ run_id: string; principal_id: string }>();
    return result.results.map((row) => ({ runId: row.run_id, principalId: row.principal_id }));
  }

  async listRecoverableSmokeRuns(
    principalId: string,
    limit = 10,
  ): Promise<readonly { runId: string; principalId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
      throw new RangeError("Recoverable smoke run limit must be between 1 and 10");
    }
    const result = await this.#db.prepare(`
      SELECT run_id, principal_id FROM spaces_smoke_runs
      WHERE principal_id = ? AND cleanup_state <> 'complete'
        AND (cleanup_state IN ('pending', 'failed') OR expires_at <= ?)
      ORDER BY expires_at, run_id LIMIT ?
    `).bind(principalId, this.#now(), limit).all<{ run_id: string; principal_id: string }>();
    return result.results.map((row) => ({ runId: row.run_id, principalId: row.principal_id }));
  }

  async hasActiveSmokeRun(principalId: string): Promise<boolean> {
    return await this.#db.prepare(`
      SELECT 1 AS found FROM spaces_smoke_runs
      WHERE principal_id = ? AND cleanup_state = 'active' AND expires_at > ?
    `).bind(principalId, this.#now()).first() !== null;
  }

  async isActiveSmokeRun(runId: string, principalId: string): Promise<boolean> {
    return await this.#db.prepare(`
      SELECT 1 AS found FROM spaces_smoke_runs
      WHERE run_id = ? AND principal_id = ? AND cleanup_state = 'active' AND expires_at > ?
    `).bind(runId, principalId, this.#now()).first() !== null;
  }

  async listPendingReleasePrincipals(limit: number): Promise<readonly PrincipalContext[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Pending release Principal limit must be between 1 and 100");
    }
    const result = await this.#db.prepare(`
      SELECT p.principal_id, p.status, p.display_name,
             (SELECT i.provider FROM spaces_external_identities i
              WHERE i.principal_id = p.principal_id
              ORDER BY CASE i.provider WHEN 'google' THEN 0 WHEN 'microsoft' THEN 1 ELSE 2 END
              LIMIT 1) AS provider,
             m.app_id, m.space_id, m.ref_domain
      FROM spaces_principals p
      JOIN spaces_principal_spaces m ON m.principal_id = p.principal_id
      WHERE EXISTS (
        SELECT 1 FROM spaces_pending_root_releases r
        WHERE r.principal_id = p.principal_id
      )
      ORDER BY p.principal_id LIMIT ?
    `).bind(limit).all<PrincipalRow>();
    return result.results.map(toPrincipalContext);
  }

  async pruneExpired(): Promise<number> {
    const now = this.#now();
    const results = await this.#db.batch([
      this.#db.prepare("DELETE FROM spaces_sessions WHERE expires_at <= ?").bind(now),
      this.#db.prepare("DELETE FROM spaces_oauth_attempts WHERE expires_at <= ?").bind(now),
    ]);
    return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
  }
}

function toPrincipalContext(row: PrincipalRow): PrincipalContext {
  return {
    principalId: row.principal_id,
    status: row.status,
    displayName: row.display_name,
    provider: row.provider ?? "smoke",
    appId: row.app_id,
    spaceId: row.space_id,
    refDomain: row.ref_domain,
  };
}
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { SpacesRepository } from "../src/repository.js";

let runtime: Miniflare | undefined;

afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

async function fixture(now = 1_000) {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "spaces-repository-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { SPACES_DB: "spaces-repository-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("SPACES_DB", "spaces-repository-test");
  const migration = await readFile(new URL("../../../stacks/unicas/spaces/migrations/0001_initial.sql", import.meta.url), "utf8");
  await db.exec(migration.replace(/\r?\n/g, " "));
  await db.prepare(`
    INSERT INTO spaces_principals (principal_id, status, display_name, created_at, updated_at)
    VALUES ('principal-a', 'active', 'Ada', 1, 1)
  `).run();
  await db.prepare(`
    INSERT INTO spaces_external_identities (
      provider, provider_subject, principal_id, display_email, created_at, updated_at
    ) VALUES ('google', 'google-subject', 'principal-a', 'ada@example.test', 1, 1)
  `).run();
  await db.prepare(`
    INSERT INTO spaces_principal_spaces (
      principal_id, app_id, space_id, ref_domain, created_at, updated_at
    ) VALUES ('principal-a', 'app-a', 'space-a', 'spaces', 1, 1)
  `).run();
  return { db, repository: new SpacesRepository(db, () => now) };
}

describe("SpacesRepository", () => {
  test("resolves only explicitly admitted external identities", async () => {
    const { repository } = await fixture();
    await expect(repository.resolveExternalIdentity("google", "google-subject")).resolves.toEqual({
      principalId: "principal-a",
      status: "active",
      displayName: "Ada",
      provider: "google",
      appId: "app-a",
      spaceId: "space-a",
      refDomain: "spaces",
    });
    await expect(repository.resolveExternalIdentity("google", "unknown")).resolves.toBeNull();
    await expect(repository.resolveExternalIdentity("github", "google-subject")).resolves.toBeNull();
  });

  test("stores only session and CSRF digests and expires sessions", async () => {
    const { db, repository } = await fixture();
    const issued = await repository.createSession("principal-a", 500);
    const stored = await db.prepare(`
      SELECT session_id_hash, csrf_token_hash FROM spaces_sessions
    `).first<{ session_id_hash: string; csrf_token_hash: string }>();

    expect(stored?.session_id_hash).not.toContain(issued.sessionId);
    expect(stored?.csrf_token_hash).not.toContain(issued.csrfToken);
    const session = await repository.readSession(issued.sessionId);
    expect(session?.context.principalId).toBe("principal-a");
    await expect(repository.verifyCsrf(session!, issued.csrfToken)).resolves.toBe(true);
    await expect(repository.verifyCsrf(session!, `${issued.csrfToken}x`)).resolves.toBe(false);

    const expiredRepository = new SpacesRepository(db, () => 1_501);
    await expect(expiredRepository.readSession(issued.sessionId)).resolves.toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS count FROM spaces_sessions").first()).toEqual({ count: 0 });
  });

  test("consumes OAuth state exactly once", async () => {
    const { repository } = await fixture();
    await repository.createOAuthAttempt({
      state: "opaque-state",
      nonce: "nonce",
      codeVerifier: "verifier",
      lifetimeMs: 500,
    });
    await expect(repository.consumeOAuthAttempt("opaque-state"))
      .resolves.toEqual({ nonce: "nonce", codeVerifier: "verifier" });
    await expect(repository.consumeOAuthAttempt("opaque-state")).resolves.toBeNull();
  });

  test("tracks smoke resources before mutation and completes cleanup idempotently", async () => {
    const { db, repository } = await fixture();
    await db.prepare(`
      INSERT INTO spaces_file_system_roots (
        root_id, principal_id, name, manifest_hash, revision, created_at, updated_at
      ) VALUES ('root-a', 'principal-a', 'Files', 'manifest-a', 1, 1, 1)
    `).run();
    const run = await repository.createSmokeRun("principal-a", 500);

    await expect(repository.trackSmokeResource({
      runId: run.runId,
      principalId: "principal-a",
      absolutePath: "/smoke-run",
    })).resolves.toBe(true);
    await expect(repository.trackSmokeResource({
      runId: run.runId,
      principalId: "principal-a",
      absolutePath: "/smoke-run",
    })).resolves.toBe(true);
    await expect(repository.trackSmokeResource({
      runId: run.runId,
      principalId: "other-principal",
      absolutePath: "/smoke-run",
    })).resolves.toBe(false);

    await expect(repository.prepareSmokeCleanup(run.runId, "principal-a")).resolves.toEqual({
      runId: run.runId,
      principalId: "principal-a",
      rootId: "root-a",
      state: "pending",
      paths: ["/smoke-run"],
    });
    await repository.completeSmokeCleanup(run.runId, "principal-a");
    await expect(repository.prepareSmokeCleanup(run.runId, "principal-a")).resolves.toEqual({
      runId: run.runId,
      principalId: "principal-a",
      rootId: null,
      state: "complete",
      paths: [],
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM spaces_smoke_resources").first())
      .toEqual({ count: 0 });
    await expect(new SpacesRepository(db, () => 1_501).listExpiredSmokeRuns(10)).resolves.toEqual([]);
  });

  test("creates a session for a dedicated smoke Principal without an external identity", async () => {
    const { db, repository } = await fixture();
    await db.prepare(`
      INSERT INTO spaces_principals (principal_id, status, display_name, created_at, updated_at)
      VALUES ('smoke-principal', 'active', 'Release smoke', 1, 1)
    `).run();
    await db.prepare(`
      INSERT INTO spaces_principal_spaces (
        principal_id, app_id, space_id, ref_domain, created_at, updated_at
      ) VALUES ('smoke-principal', 'app-a', 'smoke-space', 'spaces-smoke', 1, 1)
    `).run();

    await expect(repository.readPrincipal("smoke-principal")).resolves.toMatchObject({
      principalId: "smoke-principal",
      provider: "smoke",
      spaceId: "smoke-space",
    });
    const issued = await repository.createSession("smoke-principal", 500);
    await expect(repository.readSession(issued.sessionId)).resolves.toMatchObject({
      context: { principalId: "smoke-principal", provider: "smoke" },
    });
  });
});
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { SpacesEnv } from "../src/config.js";
import { CsrfCookieName, SessionCookieName } from "../src/http.js";
import { SpacesRepository, type PrincipalContext } from "../src/repository.js";
import { createSpacesWorker } from "../src/worker.js";

let runtime: Miniflare | undefined;

afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

async function fixture() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "spaces-worker-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { SPACES_DB: "spaces-worker-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("SPACES_DB", "spaces-worker-test");
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
  const assets = { fetch: vi.fn(async () => new Response("spaces asset")) };
  const env: SpacesEnv = {
    ASSETS: assets,
    SPACES_DB: db,
    PUBLIC_ORIGIN: "https://spaces.example.test",
    UNICAS_BASE_URL: "https://api.example.test",
    UNICAS_AUDIENCE: "https://api.example.test",
    SPACES_ISSUER: "https://spaces.example.test",
    SPACES_SIGNING_KID: "spaces-key",
    SPACES_SIGNING_PRIVATE_KEY: "private pem",
    SPACES_SIGNING_PUBLIC_JWKS: JSON.stringify({
      keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y", kid: "spaces-key" }],
    }),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  };
  const principal: PrincipalContext = {
    principalId: "principal-a",
    status: "active",
    displayName: "Ada",
    provider: "google",
    appId: "app-a",
    spaceId: "space-a",
    refDomain: "spaces",
  };
  return { assets, db, env, principal };
}

describe("Spaces Worker", () => {
  test("serves static assets while reserved paths never fall back to the SPA", async () => {
    const { assets, env } = await fixture();
    const worker = createSpacesWorker();
    const assetResponse = await worker.fetch(new Request("https://spaces.example.test/files"), env);
    expect(await assetResponse.text()).toBe("spaces asset");
    expect(assets.fetch).toHaveBeenCalledOnce();

    const apiResponse = await worker.fetch(new Request("https://spaces.example.test/api/unknown"), env);
    expect(apiResponse.status).toBe(401);
    expect(await apiResponse.json()).toMatchObject({ error: { code: "session_required" } });
    expect(assets.fetch).toHaveBeenCalledOnce();
  });

  test("publishes issuer metadata and a public-only JWKS", async () => {
    const { env } = await fixture();
    const worker = createSpacesWorker();
    const metadata = await worker.fetch(
      new Request("https://spaces.example.test/.well-known/openid-configuration"),
      env,
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      issuer: "https://spaces.example.test",
      jwks_uri: "https://spaces.example.test/.well-known/jwks.json",
    });
    const jwks = await worker.fetch(new Request("https://spaces.example.test/.well-known/jwks.json"), env);
    expect(jwks.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(JSON.stringify(await jwks.json())).not.toContain('"d"');
  });

  test("returns a safe session view and enforces CSRF before file mutations", async () => {
    const { env } = await fixture();
    const repository = new SpacesRepository(env.SPACES_DB);
    const issued = await repository.createSession("principal-a", 60_000);
    const createFolder = vi.fn(async () => ({
      rootId: "internal-root",
      revision: 2,
      rootRetained: true as const,
      entry: { path: "/docs", name: "docs", type: "directory" as const },
    }));
    const createFileService = vi.fn(async () => ({
      list: vi.fn(async () => ({ path: "/", revision: 1, entries: [] })),
      createFolder,
      uploadFile: vi.fn(),
      renameFile: vi.fn(),
      deleteFile: vi.fn(),
      download: vi.fn(),
      cleanupPaths: vi.fn(),
      ensureSmokeRoot: vi.fn(),
      releaseSmokeRoot: vi.fn(),
      reconcilePendingReleases: vi.fn(),
    }));
    const worker = createSpacesWorker({
      createFileService,
    });
    const cookie = `${SessionCookieName}=${issued.sessionId}; ${CsrfCookieName}=${issued.csrfToken}`;
    const sessionResponse = await worker.fetch(new Request("https://spaces.example.test/api/session", {
      headers: { Cookie: cookie },
    }), env);
    expect(await sessionResponse.json()).toEqual({
      principal: { id: "principal-a", displayName: "Ada", provider: "google" },
    });

    const rejected = await worker.fetch(new Request("https://spaces.example.test/api/folders", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://other.example.test" },
      body: JSON.stringify({ parentPath: "/", name: "docs", revision: 1 }),
    }), env);
    expect(rejected.status).toBe(403);
    expect(createFolder).not.toHaveBeenCalled();
    expect(createFileService).not.toHaveBeenCalled();

    const listed = await worker.fetch(new Request("https://spaces.example.test/api/entries?path=%2F", {
      headers: { Cookie: cookie },
    }), env);
    expect(listed.status).toBe(200);
    expect(createFileService).toHaveBeenLastCalledWith(expect.objectContaining({ access: ["read"] }));

    const created = await worker.fetch(new Request("https://spaces.example.test/api/folders", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "https://spaces.example.test",
        "X-CSRF-Token": issued.csrfToken,
      },
      body: JSON.stringify({ parentPath: "/", name: "docs", revision: 1 }),
    }), env);
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({ revision: 2, rootRetained: true, entry: { path: "/docs" } });
    expect(body).not.toHaveProperty("rootId");
    expect(createFileService).toHaveBeenLastCalledWith(expect.objectContaining({ access: ["read", "write"] }));
  });

  test("completes Google login only with an admitted Principal", async () => {
    const { env, principal } = await fixture();
    const google = {
      begin: vi.fn(),
      complete: vi.fn(async () => principal),
    };
    const worker = createSpacesWorker({ createGoogleClient: () => google });
    const response = await worker.fetch(new Request(
      "https://spaces.example.test/auth/google/callback?state=state&code=code",
      { headers: { Cookie: "__Host-spaces-oauth-state=state" } },
    ), env);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://spaces.example.test/files");
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SessionCookieName}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("google-subject");
  });

  test("cleans a smoke run once and treats repeated cleanup as success", async () => {
    const { db, env } = await fixture();
    await db.prepare(`
      INSERT INTO spaces_file_system_roots (
        root_id, principal_id, name, manifest_hash, revision, created_at, updated_at
      ) VALUES ('root-a', 'principal-a', 'Files', 'manifest-a', 1, 1, 1)
    `).run();
    const repository = new SpacesRepository(db);
    const session = await repository.createSession("principal-a", 60_000);
    const run = await repository.createSmokeRun("principal-a", 60_000);
    await repository.trackSmokeResource({
      runId: run.runId,
      principalId: "principal-a",
      absolutePath: "/smoke-run",
    });
    const cleanupPaths = vi.fn(async () => ({
      rootId: "root-a",
      revision: 2,
      rootRetained: true as const,
    }));
    const releaseSmokeRoot = vi.fn();
    const worker = createSpacesWorker({
      createFileService: async () => ({
        list: vi.fn(),
        createFolder: vi.fn(),
        uploadFile: vi.fn(),
        renameFile: vi.fn(),
        deleteFile: vi.fn(),
        download: vi.fn(),
        cleanupPaths,
        ensureSmokeRoot: vi.fn(),
        releaseSmokeRoot,
        reconcilePendingReleases: vi.fn(),
      }),
    });
    const request = () => new Request("https://spaces.example.test/api/smoke/cleanup", {
      method: "POST",
      headers: {
        Cookie: `${SessionCookieName}=${session.sessionId}; ${CsrfCookieName}=${session.csrfToken}`,
        "Content-Type": "application/json",
        Origin: "https://spaces.example.test",
        "X-CSRF-Token": session.csrfToken,
      },
      body: JSON.stringify({ runId: run.runId }),
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await worker.fetch(request(), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ runId: run.runId, cleanupState: "complete" });
    }
    expect(cleanupPaths).toHaveBeenCalledOnce();
    expect(cleanupPaths).toHaveBeenCalledWith(["/smoke-run"]);
    expect(releaseSmokeRoot).toHaveBeenCalledOnce();
    expect(releaseSmokeRoot).toHaveBeenCalledWith(run.runId);
  });

  test("runs isolation probes only for an active smoke run", async () => {
    const { env } = await fixture();
    const repository = new SpacesRepository(env.SPACES_DB);
    const session = await repository.createSession("principal-a", 60_000);
    const run = await repository.createSmokeRun("principal-a", 60_000);
    const verifyIsolation = vi.fn(async () => ({
      authority: { status: 403 as const, code: "insufficient_permission" as const },
      space: { status: 403 as const, code: "resource_scope_mismatch" as const },
    }));
    const worker = createSpacesWorker({
      verifyIsolation,
      createFileService: async () => ({
        list: vi.fn(),
        createFolder: vi.fn(),
        uploadFile: vi.fn(),
        renameFile: vi.fn(),
        deleteFile: vi.fn(),
        download: vi.fn(),
        cleanupPaths: vi.fn(),
        ensureSmokeRoot: vi.fn(),
        releaseSmokeRoot: vi.fn(),
        reconcilePendingReleases: vi.fn(),
      }),
    });
    const response = await worker.fetch(new Request("https://spaces.example.test/api/smoke/isolation", {
      method: "POST",
      headers: {
        Cookie: `${SessionCookieName}=${session.sessionId}; ${CsrfCookieName}=${session.csrfToken}`,
        Origin: "https://spaces.example.test",
        "X-CSRF-Token": session.csrfToken,
        "X-Spaces-Smoke-Run": run.runId,
      },
    }), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authority: { status: 403, code: "insufficient_permission" },
      space: { status: 403, code: "resource_scope_mismatch" },
    });
    expect(verifyIsolation).toHaveBeenCalledOnce();
  });

  test("creates an ephemeral Root before issuing a smoke session", async () => {
    const { db, env } = await fixture();
    await db.prepare(`
      INSERT INTO spaces_principals (principal_id, status, display_name, created_at, updated_at)
      VALUES ('smoke-principal', 'active', 'Release smoke', 1, 1)
    `).run();
    await db.prepare(`
      INSERT INTO spaces_principal_spaces (
        principal_id, app_id, space_id, ref_domain, created_at, updated_at
      ) VALUES ('smoke-principal', 'app-a', 'smoke-space', 'spaces:smoke', 1, 1)
    `).run();
    const smokeEnv = {
      ...env,
      SPACES_SMOKE_ENABLED: "true",
      SPACES_SMOKE_CREDENTIAL: "smoke-secret",
      SPACES_SMOKE_PRINCIPAL_ID: "smoke-principal",
    };
    const ensureSmokeRoot = vi.fn();
    const fetchImpl = vi.fn(function(this: unknown) {
      expect(this).toBeUndefined();
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const worker = createSpacesWorker({
      fetchImpl,
      createFileService: async ({ fetcher }) => {
        await fetcher?.fetch("https://upload.example.test");
        return {
        list: vi.fn(),
        createFolder: vi.fn(),
        uploadFile: vi.fn(),
        renameFile: vi.fn(),
        deleteFile: vi.fn(),
        download: vi.fn(),
        cleanupPaths: vi.fn(),
        ensureSmokeRoot,
        releaseSmokeRoot: vi.fn(),
        reconcilePendingReleases: vi.fn(),
        };
      },
    });
    const response = await worker.fetch(new Request("https://spaces.example.test/api/smoke/session", {
      method: "POST",
      headers: { Authorization: "Bearer smoke-secret" },
    }), smokeEnv);

    expect(response.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(ensureSmokeRoot).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ runId: expect.stringMatching(/^smoke-/) });
    expect(response.headers.get("Set-Cookie")).toContain(SessionCookieName);
  });

  test("rejects an identity-linked smoke Principal at runtime", async () => {
    const { db, env } = await fixture();
    const createFileService = vi.fn();
    const worker = createSpacesWorker({ createFileService });
    const response = await worker.fetch(new Request("https://spaces.example.test/api/smoke/session", {
      method: "POST",
      headers: { Authorization: "Bearer smoke-secret" },
    }), {
      ...env,
      SPACES_SMOKE_ENABLED: "true",
      SPACES_SMOKE_CREDENTIAL: "smoke-secret",
      SPACES_SMOKE_PRINCIPAL_ID: "principal-a",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "smoke_principal_invalid" } });
    expect(createFileService).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT COUNT(*) AS count FROM spaces_smoke_runs").first()).toEqual({ count: 0 });
  });

  test("recovers a failed smoke run before creating the next run", async () => {
    const { db, env } = await fixture();
    await db.prepare(`
      INSERT INTO spaces_principals (principal_id, status, display_name, created_at, updated_at)
      VALUES ('smoke-principal', 'active', 'Release smoke', 1, 1)
    `).run();
    await db.prepare(`
      INSERT INTO spaces_principal_spaces (
        principal_id, app_id, space_id, ref_domain, created_at, updated_at
      ) VALUES ('smoke-principal', 'app-a', 'smoke-space', 'spaces:smoke', 1, 1)
    `).run();
    await db.prepare(`
      INSERT INTO spaces_file_system_roots (
        root_id, principal_id, name, manifest_hash, revision, created_at, updated_at
      ) VALUES ('stale-root', 'smoke-principal', 'Release smoke', 'manifest-a', 1, 1, 1)
    `).run();
    const repository = new SpacesRepository(db);
    const failed = await repository.createSmokeRun("smoke-principal", 60_000);
    await repository.failSmokeCleanup(failed.runId, "smoke-principal");
    const cleanupPaths = vi.fn(async () => ({ rootId: "stale-root", revision: 2, rootRetained: true as const }));
    const releaseSmokeRoot = vi.fn();
    const ensureSmokeRoot = vi.fn();
    const worker = createSpacesWorker({
      createFileService: async () => ({
        list: vi.fn(),
        createFolder: vi.fn(),
        uploadFile: vi.fn(),
        renameFile: vi.fn(),
        deleteFile: vi.fn(),
        download: vi.fn(),
        cleanupPaths,
        ensureSmokeRoot,
        releaseSmokeRoot,
        reconcilePendingReleases: vi.fn(),
      }),
    });
    const response = await worker.fetch(new Request("https://spaces.example.test/api/smoke/session", {
      method: "POST",
      headers: { Authorization: "Bearer smoke-secret" },
    }), {
      ...env,
      SPACES_SMOKE_ENABLED: "true",
      SPACES_SMOKE_CREDENTIAL: "smoke-secret",
      SPACES_SMOKE_PRINCIPAL_ID: "smoke-principal",
    });

    expect(response.status).toBe(201);
    expect(cleanupPaths).toHaveBeenCalledBefore(releaseSmokeRoot);
    expect(releaseSmokeRoot).toHaveBeenCalledBefore(ensureSmokeRoot);
    expect(await db.prepare(`
      SELECT COUNT(*) AS count FROM spaces_smoke_runs WHERE cleanup_state <> 'complete'
    `).first()).toEqual({ count: 1 });
  });

  test("rejects unbounded multipart uploads before parsing them and returns 204 for delete", async () => {
    const { env } = await fixture();
    const repository = new SpacesRepository(env.SPACES_DB);
    const session = await repository.createSession("principal-a", 60_000);
    const uploadFile = vi.fn();
    const deleteFile = vi.fn(async () => ({ rootId: "root-a", revision: 2, rootRetained: true as const }));
    const worker = createSpacesWorker({
      createFileService: async () => ({
        list: vi.fn(),
        createFolder: vi.fn(),
        uploadFile,
        renameFile: vi.fn(),
        deleteFile,
        download: vi.fn(),
        cleanupPaths: vi.fn(),
        ensureSmokeRoot: vi.fn(),
        releaseSmokeRoot: vi.fn(),
        reconcilePendingReleases: vi.fn(),
      }),
    });
    const headers = {
      Cookie: `${SessionCookieName}=${session.sessionId}; ${CsrfCookieName}=${session.csrfToken}`,
      Origin: "https://spaces.example.test",
      "X-CSRF-Token": session.csrfToken,
    };
    const upload = await worker.fetch(new Request("https://spaces.example.test/api/files", {
      method: "POST",
      headers: { ...headers, "Content-Type": "multipart/form-data; boundary=test" },
      body: "--test--",
    }), env);
    expect(upload.status).toBe(411);
    expect(await upload.json()).toMatchObject({ error: { code: "upload_length_required" } });
    expect(uploadFile).not.toHaveBeenCalled();

    const deleted = await worker.fetch(new Request(
      "https://spaces.example.test/api/files?path=%2Fnotes.txt&revision=1",
      { method: "DELETE", headers },
    ), env);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(deleteFile).toHaveBeenCalledWith({ path: "/notes.txt", revision: 1 });
  });

  test("reconciles pending manifest releases during a bounded scheduled pass", async () => {
    const { db, env } = await fixture();
    await db.prepare(`
      INSERT INTO spaces_pending_root_releases (
        request_id, principal_id, root_id, manifest_hash, created_at
      ) VALUES ('release-a', 'principal-a', 'root-a', 'manifest-old', 1)
    `).run();
    const reconcilePendingReleases = vi.fn(async () => 1);
    const worker = createSpacesWorker({
      createFileService: async () => ({
        list: vi.fn(),
        createFolder: vi.fn(),
        uploadFile: vi.fn(),
        renameFile: vi.fn(),
        deleteFile: vi.fn(),
        download: vi.fn(),
        cleanupPaths: vi.fn(),
        ensureSmokeRoot: vi.fn(),
        releaseSmokeRoot: vi.fn(),
        reconcilePendingReleases,
      }),
    });
    let scheduled: Promise<unknown> | undefined;
    await worker.scheduled({}, env, { waitUntil(promise) { scheduled = promise; } });
    await scheduled;

    expect(reconcilePendingReleases).toHaveBeenCalledWith(20);
  });
});
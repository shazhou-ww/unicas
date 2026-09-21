import { describe, expect, test, vi } from "vitest";
import {
  parseSmokeArgs,
  SpacesSmokeError,
  normalizeSpacesSmokeBaseUrl,
  runSpacesSmoke,
} from "../scripts/smoke.mjs";

describe("Spaces smoke command", () => {
  test("accepts the deploy script's base URL arguments without a pnpm separator", () => {
    expect(parseSmokeArgs(["--base-url", "https://spaces.unicas.work"]))
      .toEqual({ baseUrl: "https://spaces.unicas.work" });
    expect(() => parseSmokeArgs(["--", "--base-url", "https://spaces.unicas.work"]))
      .toThrow("invalid_arguments");
  });

  test("runs upload, reuse, readback, isolation, and repeated cleanup without exposing data", async () => {
    const runId = "smoke-100-test-run";
    let uploadCount = 0;
    let cleanupCount = 0;
    let uploadedBytes;
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/smoke/session") {
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer smoke-secret");
        const headers = new Headers();
        headers.append("Set-Cookie", "__Host-spaces-session=session-id; Path=/; Secure; HttpOnly");
        headers.append("Set-Cookie", "__Host-spaces-csrf=csrf-token; Path=/; Secure");
        return Response.json({ runId, expiresAt: Date.now() + 60_000 }, { status: 201, headers });
      }
      const headers = new Headers(init.headers);
      expect(headers.get("Cookie")).toContain("__Host-spaces-session=session-id");
      if (init.method && init.method !== "GET") {
        expect(headers.get("Origin")).toBe("https://spaces.unicas.work");
        expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
      }
      if (url.pathname === "/api/entries" && url.searchParams.get("path") === "/") {
        return Response.json({ path: "/", revision: 1, entries: [] });
      }
      if (url.pathname === "/api/folders") {
        expect(headers.get("X-Spaces-Smoke-Run")).toBe(runId);
        return Response.json({ revision: 2, rootRetained: true, entry: { type: "directory" } }, { status: 201 });
      }
      if (url.pathname === "/api/entries") {
        return Response.json({ path: url.searchParams.get("path"), revision: 2, entries: [] });
      }
      if (url.pathname === "/api/files" && init.method === "POST") {
        uploadCount += 1;
        const body = init.body;
        expect(body).toBeInstanceOf(FormData);
        const file = body.get("file");
        uploadedBytes ??= Buffer.from(await file.arrayBuffer());
        return Response.json({
          revision: uploadCount === 1 ? 3 : 5,
          rootRetained: true,
          entry: { type: "file", path: `/uploaded-${uploadCount}` },
          uploadEvidence: uploadCount === 1
            ? { leaseRequests: 8, nodeCount: 4, readyNodes: 4, uploadRequiredNodes: 4 }
            : { leaseRequests: 4, nodeCount: 4, readyNodes: 4, uploadRequiredNodes: 0 },
        }, { status: 201 });
      }
      if (url.pathname === "/api/files" && init.method === "PATCH") {
        return Response.json({ revision: 4, rootRetained: true, entry: { type: "file" } });
      }
      if (url.pathname === "/api/files/content") {
        if (url.searchParams.get("path")?.includes("payload-")) {
          return Response.json({ error: { code: "path_not_found" } }, { status: 404 });
        }
        return new Response(uploadedBytes);
      }
      if (url.pathname === "/api/smoke/isolation") {
        return Response.json({
          authority: { status: 403, code: "insufficient_permission" },
          space: { status: 403, code: "resource_scope_mismatch" },
        });
      }
      if (url.pathname === "/api/smoke/cleanup") {
        cleanupCount += 1;
        if (cleanupCount === 1) {
          return Response.json({ error: { code: "cleanup_temporarily_unavailable" } }, { status: 503 });
        }
        return Response.json({ runId, cleanupState: "complete" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await runSpacesSmoke({
      baseUrl: "https://spaces.unicas.work",
      credential: "smoke-secret",
      fetchImpl,
    });

    expect(result).toEqual({
      runId,
      completedStages: ["authenticate", "hash", "lease", "upload", "commit", "verify", "cleanup"],
    });
    expect(uploadCount).toBe(2);
    expect(cleanupCount).toBe(3);
    expect(uploadedBytes).toHaveLength(2 * 1024 * 1024 + 257);
    expect(JSON.stringify(result)).not.toContain("smoke-secret");
  });

  test("attempts bounded cleanup after a workflow failure", async () => {
    let cleanupCount = 0;
    const headers = new Headers();
    headers.append("Set-Cookie", "__Host-spaces-session=session-id; Path=/; Secure; HttpOnly");
    headers.append("Set-Cookie", "__Host-spaces-csrf=csrf-token; Path=/; Secure");
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/smoke/session") {
        return Response.json({ runId: "smoke-failed", expiresAt: Date.now() + 60_000 }, { status: 201, headers });
      }
      if (url.pathname === "/api/entries" && url.searchParams.get("path") === "/") {
        return Response.json({ path: "/", revision: 1, entries: [] });
      }
      if (url.pathname === "/api/folders") {
        return Response.json({ revision: 2, rootRetained: true, entry: { type: "directory" } }, { status: 201 });
      }
      if (url.pathname === "/api/entries") {
        return Response.json({ path: "/folder", revision: 2, entries: [] });
      }
      if (url.pathname === "/api/files") {
        return Response.json({ error: { code: "upload_failed" } }, { status: 502 });
      }
      if (url.pathname === "/api/smoke/cleanup") {
        cleanupCount += 1;
        return Response.json({ runId: "smoke-failed", cleanupState: "complete" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(runSpacesSmoke({
      baseUrl: "https://spaces.unicas.work",
      credential: "smoke-secret",
      fetchImpl,
      payloadBytes: 1024 * 1024 + 1,
    })).rejects.toMatchObject({
      runId: "smoke-failed",
      stage: "lease",
      code: "upload_failed",
      status: 502,
    });
    expect(cleanupCount).toBe(2);
  });

  test("allows only production Spaces or an explicit local target by default", () => {
    expect(normalizeSpacesSmokeBaseUrl("https://spaces.unicas.work")).toBe("https://spaces.unicas.work");
    expect(normalizeSpacesSmokeBaseUrl("http://127.0.0.1:8788")).toBe("http://127.0.0.1:8788");
    expect(() => normalizeSpacesSmokeBaseUrl("https://other.example.test"))
      .toThrow(SpacesSmokeError);
  });
});
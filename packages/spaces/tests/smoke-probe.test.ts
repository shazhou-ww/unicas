import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, test, vi } from "vitest";
import { verifySmokeIsolation } from "../src/smoke-probe.js";

describe("verifySmokeIsolation", () => {
  test("requires exact public API denials for missing authority and cross-Space access", async () => {
    const keys = await generateKeyPair("ES256", { extractable: true });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      const claims = decodeJwt(authorization.slice("Bearer ".length));
      if (url.pathname.endsWith("/lease")) {
        expect(claims.spaceId).toBe("space-a");
        expect(claims.permissions).toEqual(["spaces:space-a:cas:read"]);
        return Response.json({ error: "insufficient_permission" }, { status: 403 });
      }
      expect(url.pathname).toContain("/spaces/space-a/");
      expect(claims.spaceId).toBe("space-a-isolation");
      return Response.json({ error: "resource_scope_mismatch" }, { status: 403 });
    });

    await expect(verifySmokeIsolation({
      capability: {
        issuer: "https://spaces.example.test",
        audience: "https://api.example.test",
        keyId: "spaces-key",
        privateKeyPem: await exportPKCS8(keys.privateKey),
        unicasBaseUrl: "https://api.example.test",
      },
      principal: {
        principalId: "principal-a",
        status: "active",
        displayName: "Ada",
        provider: "google",
        appId: "app-a",
        spaceId: "space-a",
        refDomain: "spaces",
      },
      fetchImpl,
    })).resolves.toEqual({
      authority: { status: 403, code: "insufficient_permission" },
      space: { status: 403, code: "resource_scope_mismatch" },
    });
  });

  test("fails when the service does not return the exact denial contract", async () => {
    const keys = await generateKeyPair("ES256", { extractable: true });
    await expect(verifySmokeIsolation({
      capability: {
        issuer: "https://spaces.example.test",
        audience: "https://api.example.test",
        keyId: "spaces-key",
        privateKeyPem: await exportPKCS8(keys.privateKey),
        unicasBaseUrl: "https://api.example.test",
      },
      principal: {
        principalId: "principal-a",
        status: "active",
        displayName: "Ada",
        provider: "google",
        appId: "app-a",
        spaceId: "space-a",
        refDomain: "spaces",
      },
      fetchImpl: vi.fn(async () => Response.json({ error: "invalid_token" }, { status: 401 })),
    })).rejects.toThrow("expected 403 insufficient_permission");
  });
});
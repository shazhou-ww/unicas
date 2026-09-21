import { compactVerify, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, test } from "vitest";
import {
  appSpaceV1Audience,
  cutOverAppSpaceV1Issuers,
} from "../stacks/unicas/deploy/cut-over-app-space-v1-issuers.mjs";

describe("App/Space v1 production issuer cutover", () => {
  test("inspects, proves, activates, and verifies an old audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const calls = [];
    let activated = false;
    const fetchImpl = async (url, init = {}) => {
      const request = new Request(url, init);
      calls.push(request);
      if (request.method === "POST") {
        return Response.json({
          inspectionId: "inspection-1",
          challenge: "prove-app-space-v1",
          audience: "https://api.unicas.work/v1/apps/app%2F1",
        });
      }
      if (request.method === "PUT") {
        const body = await request.json();
        const verified = await compactVerify(body.activationProof, publicKey);
        expect(new TextDecoder().decode(verified.payload)).toBe("prove-app-space-v1");
        expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: "key-1" });
        activated = true;
        return new Response(null, { status: 204 });
      }
      return Response.json({
        issuer: "https://issuer.example",
        audience: activated
          ? "https://api.unicas.work/v1/apps/app%2F1"
          : "https://api.unicas.work/v2/apps/app%2F1",
        status: "active",
      }, { headers: { ETag: activated ? '"2"' : '"1"' } });
    };

    await expect(cutOverAppSpaceV1Issuers({
      adminOrigin: "https://console.unicas.work",
      publicOrigin: "https://api.unicas.work",
      session: { cookie: "cas_admin_session=session", csrfToken: "csrf" },
      issuers: [{
        appId: "app/1",
        issuer: "https://issuer.example",
        keyId: "key-1",
        privateKeyPem: await exportPKCS8(privateKey),
      }],
      fetchImpl,
    })).resolves.toEqual([{
      appId: "app/1",
      audience: "https://api.unicas.work/v1/apps/app%2F1",
      status: "updated",
    }]);

    expect(calls.map((request) => request.method)).toEqual(["GET", "POST", "PUT", "GET"]);
    expect(calls[1].headers.get("Cookie")).toBe("cas_admin_session=session");
    expect(calls[1].headers.get("Origin")).toBe("https://console.unicas.work");
    expect(calls[1].headers.get("X-CSRF-Token")).toBe("csrf");
    expect(calls[2].headers.get("If-Match")).toBe('"1"');
  });

  test("skips an issuer that already has the released audience", async () => {
    const fetchImpl = async () => Response.json({
      issuer: "https://issuer.example",
      audience: "https://api.unicas.work/v1/apps/app-1",
      status: "active",
    }, { headers: { ETag: '"2"' } });
    await expect(cutOverAppSpaceV1Issuers({
      adminOrigin: "https://console.unicas.work",
      publicOrigin: "https://api.unicas.work",
      session: { cookie: "cookie=value", csrfToken: "csrf" },
      issuers: [{ appId: "app-1", issuer: "https://issuer.example", keyId: "key", privateKeyPem: "unused" }],
      fetchImpl,
    })).resolves.toEqual([{
      appId: "app-1",
      audience: appSpaceV1Audience("https://api.unicas.work/path", "app-1"),
      status: "current",
    }]);
  });
});
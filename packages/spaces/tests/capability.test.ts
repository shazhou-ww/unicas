import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  jwtVerify,
} from "jose";
import { describe, expect, test } from "vitest";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
} from "@unicas/tenant-protocol";
import { issueSpaceCapability } from "../src/capability.js";

describe("issueSpaceCapability", () => {
  test("issues a short-lived capability scoped to one App Principal and Space", async () => {
    const pair = await generateKeyPair(CapabilityAlgorithm, { extractable: true });
    const token = await issueSpaceCapability({
      issuer: "https://spaces.example.test",
      audience: "https://api.example.test",
      keyId: "spaces-2026-09",
      privateKeyPem: await exportPKCS8(pair.privateKey),
      unicasBaseUrl: "https://api.example.test",
    }, {
      principalId: "principal-a",
      status: "active",
      displayName: "Ada",
      provider: "google",
      appId: "app-a",
      spaceId: "space-a",
      refDomain: "spaces",
    }, ["read", "write"], () => 1_000_000);
    const publicKey = await importJWK(await exportJWK(pair.publicKey), CapabilityAlgorithm);
    const verified = await jwtVerify(token, publicKey, {
      algorithms: [CapabilityAlgorithm],
      issuer: "https://spaces.example.test",
      audience: "https://api.example.test",
      typ: CapabilityTokenType,
      currentDate: new Date(1_000_000),
    });

    expect(verified.payload).toMatchObject({
      ver: SpaceCapabilityVersion,
      sub: "principal-a",
      spaceId: "space-a",
      refDomain: "spaces",
      permissions: [
        "cas:nodes:read",
        "cas:nodes:lease",
        "cas:root-refs:read",
        "cas:root-refs:update",
      ],
      iat: 1000,
      exp: 1300,
    });
  });

  test("rejects an empty permission set", async () => {
    const pair = await generateKeyPair(CapabilityAlgorithm, { extractable: true });
    await expect(issueSpaceCapability({
      issuer: "https://spaces.example.test",
      audience: "https://api.example.test",
      keyId: "spaces-2026-09",
      privateKeyPem: await exportPKCS8(pair.privateKey),
      unicasBaseUrl: "https://api.example.test",
    }, {
      principalId: "principal-a",
      status: "active",
      displayName: "Ada",
      provider: "google",
      appId: "app-a",
      spaceId: "space-a",
      refDomain: "spaces",
    }, [])).rejects.toThrow("At least one Space access permission is required");
  });
});
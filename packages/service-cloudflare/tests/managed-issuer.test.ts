import { describe, expect, test } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { CloudflareManagedIssuer } from "../src/managed-issuer.js";

async function fixture() {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return new CloudflareManagedIssuer({
    publicOrigin: "https://cas.example",
    privateKeyPkcs8: await exportPKCS8(privateKey),
    keyId: "managed-test",
  });
}

describe("CloudflareManagedIssuer", () => {
  test("serves verification-only metadata and JWKS during the token drain", async () => {
    const authority = await fixture();
    await expect(authority.metadata("cas_first")).resolves.toMatchObject({
      issuer: "https://cas.example/managed-issuers/cas_first",
      jwks_uri: "https://cas.example/managed-issuers/cas_first/jwks.json",
    });
    expect((await authority.jwks()).keys).toHaveLength(1);
    expect(authority.ownsJwksUri("https://cas.example/managed-issuers/cas_first/jwks.json")).toBe(true);
    expect(authority.ownsJwksUri("https://other.example/managed-issuers/cas_first/jwks.json")).toBe(false);
    expect(authority.ownsJwksUri("https://cas.example/managed-issuers/cas_first/jwks.json?redirect=1")).toBe(false);
  });

  test("does not expose provisioning or capability issuance", async () => {
    const authority = await fixture();
    expect("provision" in authority).toBe(false);
    expect("issueAccountSpace" in authority).toBe(false);
  });
});
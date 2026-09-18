import { describe, expect, test } from "vitest";
import { exportPKCS8, generateKeyPair, importJWK, jwtVerify } from "jose";
import { CloudflareManagedIssuer } from "../src/managed-issuer.js";

async function fixture() {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return new CloudflareManagedIssuer({
    publicOrigin: "https://cas.example",
    privateKeyPkcs8: await exportPKCS8(privateKey),
    keyId: "managed-test",
    now: () => 1_700_000_000_000,
  });
}

describe("CloudflareManagedIssuer", () => {
  test("provisions a distinct active issuer for each App", async () => {
    const authority = await fixture();
    const first = await authority.provision("cas_first", 1000);
    const second = await authority.provision("cas_second", 1000);

    expect(first).toMatchObject({
      mode: "managed",
      status: "active",
      issuer: "https://cas.example/managed-issuers/cas_first",
      audience: "https://cas.example/v2/apps/cas_first",
      capabilityMaxLifetimeSeconds: 3600,
    });
    expect(second.issuer).not.toBe(first.issuer);
    expect((await authority.jwks()).keys).toHaveLength(1);
    expect(authority.ownsJwksUri("https://cas.example/managed-issuers/cas_first/jwks.json")).toBe(true);
    expect(authority.ownsJwksUri("https://other.example/managed-issuers/cas_first/jwks.json")).toBe(false);
    expect(authority.ownsJwksUri("https://cas.example/managed-issuers/cas_first/jwks.json?redirect=1")).toBe(false);
  });

  test("issues the same Space identity for one Account across login providers", async () => {
    const authority = await fixture();
    const app = {
      appId: "cas_first",
      displayName: "First",
      description: "",
      status: "active" as const,
      createdAt: 1000,
      revision: 1,
    };
    const issuer = await authority.provision(app.appId, 1000);
    const accountId = `acct_${"a".repeat(22)}`;
    const first = await authority.issueAccountSpace({ app, issuer, accountId });
    const second = await authority.issueAccountSpace({ app, issuer, accountId });
    const other = await authority.issueAccountSpace({
      app,
      issuer,
      accountId: `acct_${"b".repeat(22)}`,
    });

    expect(second.spaceId).toBe(first.spaceId);
    expect(other.spaceId).not.toBe(first.spaceId);
    const jwks = await authority.jwks() as { keys: Array<Record<string, unknown>> };
    const publicKey = await importJWK(jwks.keys[0]!, "ES256");
    const verified = await jwtVerify(first.accessToken, publicKey, {
      issuer: first.issuer,
      audience: first.audience,
      currentDate: new Date(1_700_000_000_000),
    });
    expect(verified.payload).toMatchObject({
      ver: 2,
      spaceId: first.spaceId,
      refDomain: expect.stringMatching(/^account:[0-9a-f]{16}$/),
      sub: expect.stringMatching(/^account:[0-9a-f]{64}$/),
    });
  });
});
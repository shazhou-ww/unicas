import { describe, expect, test } from "vitest";
import { issuerJwks, issuerMetadata, readSpacesConfig, type SpacesEnv } from "../src/config.js";

function environment(overrides: Partial<SpacesEnv> = {}): SpacesEnv {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    SPACES_DB: {} as SpacesEnv["SPACES_DB"],
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
    ...overrides,
  };
}

describe("Spaces configuration", () => {
  test("publishes issuer metadata and a verification-only ES256 key", () => {
    const config = readSpacesConfig(environment());
    expect(issuerMetadata(config)).toEqual({
      issuer: "https://spaces.example.test",
      authorization_endpoint: "https://spaces.example.test/oauth/authorize",
      token_endpoint: "https://spaces.example.test/oauth/token",
      jwks_uri: "https://spaces.example.test/.well-known/jwks.json",
      scopes_supported: [],
      code_challenge_methods_supported: ["S256"],
    });
    expect(issuerJwks(config)).toEqual({
      keys: [{
        kty: "EC",
        crv: "P-256",
        x: "x",
        y: "y",
        kid: "spaces-key",
        alg: "ES256",
        use: "sig",
        key_ops: ["verify"],
      }]
    });
  });

  test("rejects private JWK material and non-local HTTP origins", () => {
    expect(() => readSpacesConfig(environment({
      SPACES_SIGNING_PUBLIC_JWKS: JSON.stringify({
        keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y", kid: "spaces-key", d: "private" }],
      }),
    }))).toThrow("must not contain private key material");
    expect(() => readSpacesConfig(environment({ PUBLIC_ORIGIN: "http://spaces.example.test" })))
      .toThrow("HTTPS origin");
    expect(() => readSpacesConfig(environment({ PUBLIC_ORIGIN: "http://localhost:8788" }))).not.toThrow();
  });
});
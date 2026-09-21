import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, test, vi } from "vitest";
import { GoogleAuthError, GoogleOidcClient } from "../src/google-oidc.js";
import type { PrincipalContext, SpacesRepository } from "../src/repository.js";

describe("GoogleOidcClient", () => {
  test("uses PKCE and verifies issuer, audience, nonce, and admitted subject", async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = { ...await exportJWK(pair.publicKey), alg: "RS256", kid: "google-key", use: "sig" };
    let attempt: { state: string; nonce: string; codeVerifier: string } | undefined;
    let idToken = "";
    const principal: PrincipalContext = {
      principalId: "principal-a",
      status: "active",
      displayName: "Ada",
      provider: "google",
      appId: "app-a",
      spaceId: "space-a",
      refDomain: "spaces",
    };
    const repository = {
      createOAuthAttempt: vi.fn(async (input: typeof attempt extends infer _ ? {
        state: string;
        nonce: string;
        codeVerifier: string;
        lifetimeMs: number;
      } : never) => {
        attempt = input;
      }),
      consumeOAuthAttempt: vi.fn(async (state: string) => {
        if (!attempt || state !== attempt.state) return null;
        const result = { nonce: attempt.nonce, codeVerifier: attempt.codeVerifier };
        attempt = undefined;
        return result;
      }),
      resolveExternalIdentity: vi.fn(async () => principal),
    } satisfies Pick<SpacesRepository, "createOAuthAttempt" | "consumeOAuthAttempt" | "resolveExternalIdentity">;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer: "https://accounts.google.test",
          authorization_endpoint: "https://accounts.google.test/authorize",
          token_endpoint: "https://accounts.google.test/token",
          jwks_uri: "https://accounts.google.test/jwks",
        });
      }
      if (url.endsWith("/token")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBeTruthy();
        expect(body.get("client_secret")).toBe("google-secret");
        return Response.json({ id_token: idToken });
      }
      if (url.endsWith("/jwks")) return Response.json({ keys: [publicJwk] });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new GoogleOidcClient({
      issuer: "https://accounts.google.test",
      discoveryUrl: "https://accounts.google.test/.well-known/openid-configuration",
      clientId: "spaces-client",
      clientSecret: "google-secret",
      redirectUri: "https://spaces.example.test/auth/google/callback",
    }, fetchImpl);

    const authorization = await client.begin(repository);
    const url = new URL(authorization.redirectUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe(attempt?.codeVerifier);
    expect(url.searchParams.get("nonce")).toBe(attempt?.nonce);
    idToken = await new SignJWT({ nonce: attempt?.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "google-key" })
      .setIssuer("https://accounts.google.test")
      .setAudience("spaces-client")
      .setSubject("google-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(pair.privateKey);

    await expect(client.complete({
      repository,
      state: authorization.state,
      stateCookie: authorization.state,
      code: "authorization-code",
    })).resolves.toEqual(principal);
    expect(repository.resolveExternalIdentity).toHaveBeenCalledWith("google", "google-subject");
    await expect(client.complete({
      repository,
      state: authorization.state,
      stateCookie: authorization.state,
      code: "replayed-code",
    })).rejects.toMatchObject({ code: "auth_invalid" });
  });

  test("rejects a callback before token exchange when state cookies differ", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new GoogleOidcClient({
      issuer: "https://accounts.google.test",
      discoveryUrl: "https://accounts.google.test/.well-known/openid-configuration",
      clientId: "spaces-client",
      clientSecret: "google-secret",
      redirectUri: "https://spaces.example.test/auth/google/callback",
    }, fetchImpl);
    const repository = {
      createOAuthAttempt: vi.fn(),
      consumeOAuthAttempt: vi.fn(),
      resolveExternalIdentity: vi.fn(),
    } as unknown as Pick<SpacesRepository, "createOAuthAttempt" | "consumeOAuthAttempt" | "resolveExternalIdentity">;

    await expect(client.complete({ repository, state: "one", stateCookie: "two", code: "code" }))
      .rejects.toBeInstanceOf(GoogleAuthError);
    expect(repository.consumeOAuthAttempt).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("refreshes JWKS once when Google rotates to an unknown signing key", async () => {
    const oldPair = await generateKeyPair("RS256", { extractable: true });
    const newPair = await generateKeyPair("RS256", { extractable: true });
    const oldJwk = { ...await exportJWK(oldPair.publicKey), alg: "RS256", kid: "old-key", use: "sig" };
    const newJwk = { ...await exportJWK(newPair.publicKey), alg: "RS256", kid: "new-key", use: "sig" };
    const token = await new SignJWT({ nonce: "nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "new-key" })
      .setIssuer("https://accounts.google.test")
      .setAudience("spaces-client")
      .setSubject("google-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(newPair.privateKey);
    let jwksReads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer: "https://accounts.google.test",
          authorization_endpoint: "https://accounts.google.test/authorize",
          token_endpoint: "https://accounts.google.test/token",
          jwks_uri: "https://accounts.google.test/jwks",
        });
      }
      if (url.endsWith("/token")) return Response.json({ id_token: token });
      if (url.endsWith("/jwks")) return Response.json({ keys: [jwksReads++ === 0 ? oldJwk : newJwk] });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const principal = {
      principalId: "principal-a",
      status: "active" as const,
      displayName: "Ada",
      provider: "google" as const,
      appId: "app-a",
      spaceId: "space-a",
      refDomain: "spaces",
    };
    const client = new GoogleOidcClient({
      issuer: "https://accounts.google.test",
      discoveryUrl: "https://accounts.google.test/.well-known/openid-configuration",
      clientId: "spaces-client",
      clientSecret: "google-secret",
      redirectUri: "https://spaces.example.test/auth/google/callback",
    }, fetchImpl);
    const repository = {
      consumeOAuthAttempt: vi.fn(async () => ({ nonce: "nonce", codeVerifier: "verifier" })),
      resolveExternalIdentity: vi.fn(async () => principal),
    } as unknown as Pick<SpacesRepository, "createOAuthAttempt" | "consumeOAuthAttempt" | "resolveExternalIdentity">;

    await expect(client.complete({ repository, state: "state", stateCookie: "state", code: "code" }))
      .resolves.toEqual(principal);
    expect(jwksReads).toBe(2);
  });
});
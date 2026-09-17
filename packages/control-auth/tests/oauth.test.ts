import { describe, expect, test, vi } from "vitest";
import { OAuthAuthorizationCodeClient } from "../src/index.js";

describe("shared control OAuth", () => {
  test("builds authorization URLs only from pinned configuration", () => {
    const client = new OAuthAuthorizationCodeClient({
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: "client-id",
      redirectUri: "https://console.example/admin/auth/callback/github",
      scopes: ["read:user", "user:email"],
    });
    const url = new URL(client.authorizationUrl({ state: "state", codeChallenge: "challenge" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-id",
      redirect_uri: "https://console.example/admin/auth/callback/github",
      scope: "read:user user:email",
      state: "state",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    });
  });

  test("exchanges a code with PKCE at the pinned token endpoint", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      access_token: "provider-secret",
      token_type: "bearer",
      scope: "read:user,user:email",
    }));
    const client = new OAuthAuthorizationCodeClient({
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://console.example/admin/auth/callback/github",
      scopes: ["read:user", "user:email"],
    }, { fetchImpl });

    await expect(client.exchangeCode({ code: "code", codeVerifier: "verifier" })).resolves.toEqual({
      accessToken: "provider-secret",
      tokenType: "bearer",
      scope: "read:user,user:email",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://github.com/login/oauth/access_token");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      code: "code",
      code_verifier: "verifier",
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });

  test("rejects non-HTTPS provider endpoints and redacts token failures", async () => {
    expect(() => new OAuthAuthorizationCodeClient({
      authorizationEndpoint: "http://provider.example/authorize",
      tokenEndpoint: "https://provider.example/token",
      clientId: "client-id",
      redirectUri: "https://console.example/callback",
      scopes: ["profile"],
    })).toThrow("HTTPS");

    const client = new OAuthAuthorizationCodeClient({
      authorizationEndpoint: "https://provider.example/authorize",
      tokenEndpoint: "https://provider.example/token",
      clientId: "client-id",
      redirectUri: "https://console.example/callback",
      scopes: ["profile"],
    }, { fetchImpl: vi.fn(async () => Response.json({ error: "bad", access_token: "must-not-leak" }, { status: 401 })) });
    await expect(client.exchangeCode({ code: "secret-code", codeVerifier: "secret-verifier" }))
      .rejects.toMatchObject({ code: "token_exchange_failed" });
    await expect(client.exchangeCode({ code: "secret-code", codeVerifier: "secret-verifier" }))
      .rejects.not.toThrow(/secret-code|secret-verifier|must-not-leak/);
  });
});
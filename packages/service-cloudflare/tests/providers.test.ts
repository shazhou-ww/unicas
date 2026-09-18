import { describe, expect, test, vi } from "vitest";
import { OAuthAuthorizationCodeClient, type VerifiedOidcIdentity } from "@unicas/control-auth";
import type { ProviderCallbackInput, ProviderFlowContext } from "@unicas/service";
import {
  GitHubProviderAdapter,
  GoogleProviderAdapter,
  MicrosoftPersonalProviderAdapter,
  MICROSOFT_CONSUMERS_TENANT_ID,
} from "../src/admin-bff/providers.js";

const flow: ProviderFlowContext = {
  purpose: "login",
  state: "state",
  codeChallenge: "challenge",
  nonce: "nonce",
};
const callback: ProviderCallbackInput = {
  code: "code",
  state: "state",
  codeVerifier: "verifier",
  nonce: "nonce",
  authenticationEventId: "event-1",
};

function oidcIdentity(overrides: Partial<VerifiedOidcIdentity> = {}): VerifiedOidcIdentity {
  return {
    sub: "subject",
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice",
    picture: "https://lh3.googleusercontent.com/avatar",
    preferredUsername: null,
    tenantId: null,
    version: null,
    ...overrides,
  };
}

function oidcClient(identity: VerifiedOidcIdentity) {
  return {
    authorizationUrl: vi.fn(async () => "https://provider.example/authorize"),
    exchangeCode: vi.fn(async () => ({ idToken: "id-token", accessToken: "provider-token" })),
    verifyIdToken: vi.fn(async () => identity),
  };
}

describe("OIDC provider adapters", () => {
  test("Google emits evidence only for a verified token email", async () => {
    const verified = new GoogleProviderAdapter(oidcClient(oidcIdentity()), undefined, () => 1000);
    await expect(verified.begin(flow)).resolves.toBe("https://provider.example/authorize");
    await expect(verified.complete(callback)).resolves.toMatchObject({
      provider: "google",
      subject: "subject",
      verifiedEmailEvidence: [{
        normalizedEmail: "alice@example.com",
        source: "google-oidc",
        authenticationEventId: "event-1",
      }],
    });

    const unverified = new GoogleProviderAdapter(oidcClient(oidcIdentity({ emailVerified: false })), undefined, () => 1000);
    await expect(unverified.complete(callback)).resolves.toMatchObject({ verifiedEmailEvidence: [] });
  });

  test("Microsoft validates consumers v2 and never emits token-email evidence", async () => {
    const valid = new MicrosoftPersonalProviderAdapter(oidcClient(oidcIdentity({
      tenantId: MICROSOFT_CONSUMERS_TENANT_ID,
      version: "2.0",
      emailVerified: true,
      preferredUsername: "alice@outlook.com",
    })), () => 1000);
    await expect(valid.complete(callback)).resolves.toMatchObject({
      provider: "microsoft",
      accountHint: "alice@example.com",
      verifiedEmailEvidence: [],
    });
    const wrongTenant = new MicrosoftPersonalProviderAdapter(oidcClient(oidcIdentity({
      tenantId: "other",
      version: "2.0",
    })));
    await expect(wrongTenant.complete(callback)).rejects.toMatchObject({ code: "provider_response_invalid" });
  });
});

describe("GitHub provider adapter", () => {
  test("uses numeric /user id and only verified Emails API entries", async () => {
    const oauthFetch = vi.fn(async () => Response.json({ access_token: "github-secret", token_type: "bearer" }));
    const apiFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer github-secret" });
      if (String(input).endsWith("/user")) return Response.json({
        id: 9482173,
        login: "alice-login",
        name: "Alice",
        avatar_url: "https://avatars.githubusercontent.com/u/9482173",
        email: "public-unverified@example.com",
      });
      return Response.json([
        { email: "private@example.com", verified: true, visibility: null },
        { email: "unverified@example.com", verified: false, visibility: null },
      ]);
    });
    const client = new OAuthAuthorizationCodeClient({
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://console.example/admin/auth/callback/github",
      scopes: ["read:user", "user:email"],
    }, { fetchImpl: oauthFetch });
    const adapter = new GitHubProviderAdapter(client, { fetchImpl: apiFetch, now: () => 1000 });
    const result = await adapter.complete({ ...callback, nonce: null });
    expect(result).toMatchObject({
      provider: "github",
      subject: "9482173",
      accountHint: "alice-login",
      verifiedEmailEvidence: [{ normalizedEmail: "private@example.com", source: "github-emails-api" }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("github-secret");
    expect(serialized).not.toContain("unverified@example.com");
    expect(serialized).not.toContain("public-unverified@example.com");
  });

  test("fails closed for nonnumeric GitHub identities", async () => {
    const client = new OAuthAuthorizationCodeClient({
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: "client",
      redirectUri: "https://console.example/callback",
      scopes: ["read:user", "user:email"],
    }, { fetchImpl: vi.fn(async () => Response.json({ access_token: "token" })) });
    const adapter = new GitHubProviderAdapter(client, {
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/user")
        ? Response.json({ id: "not-numeric", login: "alice" })
        : Response.json([])),
    });
    await expect(adapter.complete({ ...callback, nonce: null }))
      .rejects.toMatchObject({ code: "provider_response_invalid" });
  });
});
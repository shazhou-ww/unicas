import { describe, expect, test, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { migrateControlSchema } from "../src/control-schema.js";
import { ControlSessionStore } from "../src/control-sessions.js";
import type {
  AuthRequest,
  CompleteAuthorizationOptions,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { OidcClient } from "@unicas/control-auth";
import { AccountServiceError, ProviderRegistry, type AccountResolution, type ProviderAdapter } from "@unicas/service";
import {
  createOAuthAuthorizationHandler as createHandler,
  type OAuthAuthorizationHandlerOptions,
  type OAuthAuthorizationEnv,
} from "../src/mcp/auth.js";

const oauthRequest: AuthRequest = {
  responseType: "code",
  clientId: "https://copilot.example/client-metadata.json",
  redirectUri: "https://vscode.dev/redirect",
  scope: ["control:read", "control:security"],
  state: "client-state",
  codeChallenge: "client-pkce-challenge",
  codeChallengeMethod: "S256",
  resource: "https://cas.example/mcp",
  issuer: "https://cas.example",
};

const accountResolution = {
  account: { accountId: `acct_${"a".repeat(22)}`, credentialVersion: 1 },
  authenticatedIdentity: { externalIdentityId: "external-1", issuer: "https://accounts.example", subject: "alice-sub" },
  platformAuthorities: ["apps.create"], hasAppMembership: false,
} as AccountResolution;

function createOAuthAuthorizationHandler(options: Partial<OAuthAuthorizationHandlerOptions>) {
  return createHandler({
    accountServiceFactory: () => ({
      resolveExternalIdentity: async () => accountResolution,
      authorizeCredential: async () => accountResolution,
    }),
    ...options,
  });
}

describe("control-plane MCP OAuth authorization", () => {
  test("atomically consumes production D1 callback transactions once", async () => {
    const runtime = new Miniflare(convertV4MiniflareOptions({
      workers: [{ name: "mcp-flow", modules: true, script: "export default { fetch() { return new Response('ok'); } };", compatibilityDate: "2025-08-17", d1Databases: { DB: "mcp-flow" } }],
    }));
    try {
      const database = await runtime.getD1Database("DB", "mcp-flow");
      await migrateControlSchema(database);
      const fixture = createFixture();
      fixture.env.CAS_CONTROL_DB = database;
      const handler = createOAuthAuthorizationHandler({ oidcFactory: () => fixture.oidc });
      const start = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
      expect(fixture.kv.size).toBe(0);
      const state = new URL(start.headers.get("Location")!).searchParams.get("state");
      const callback = () => handler.fetch(new Request(`https://cas.example/oauth/google/callback?code=code&state=${state}`, { headers: { Cookie: cookieFrom(start) } }), fixture.env);
      const responses = await Promise.all([callback(), callback()]);
      expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
      const accountId = `acct_${"a".repeat(22)}`;
      const sessions = new ControlSessionStore(database, () => 1000);
      await sessions.create("new-browser", "encrypted", 500, { accountId, externalIdentityId: "current-ext", credentialVersion: 1 });
      expect(await database.prepare("SELECT account_id, external_identity_id, credential_version FROM cas_admin_sessions WHERE session_id = 'new-browser'").first()).toEqual({ account_id: accountId, external_identity_id: "current-ext", credential_version: 1 });
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

  test.each(["microsoft", "github"] as const)("authenticates %s with shared adapters and Account binding", async kind => {
    const fixture = createFixture();
    const adapter = (provider: "microsoft" | "github"): ProviderAdapter => ({
      kind: provider,
      displayName: provider === "github" ? "GitHub" : "Microsoft",
      begin: async input => `https://${provider}.example/authorize?state=${input.state}`,
      complete: async input => ({
        provider, issuer: `https://${provider}.example`, subject: "provider-subject",
        displayName: "Example", avatarUrl: null, accountHint: "private-hint",
        verifiedEmailEvidence: [], authenticatedAt: 1000, authenticationEventId: input.authenticationEventId,
      }),
    });
    const resolution = {
      account: { accountId: `acct_${"a".repeat(22)}`, credentialVersion: 2 },
      authenticatedIdentity: { issuer: `https://${kind}.example`, subject: "provider-subject", externalIdentityId: `external-${kind}` },
      platformAuthorities: ["apps.create"], hasAppMembership: false,
    } as AccountResolution;
    const accounts = {
      resolveExternalIdentity: vi.fn(async () => resolution),
      authorizeCredential: vi.fn(async () => resolution),
    };
    const handler = createOAuthAuthorizationHandler({
      providerRegistryFactory: () => new ProviderRegistry([adapter("microsoft"), adapter("github")]),
      accountServiceFactory: () => accounts,
    });
    const selector = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
    expect(selector.status).toBe(200);
    expect(await selector.text()).toContain("Continue with Microsoft");
    const start = await handler.fetch(new Request(`https://cas.example/oauth/authorize?provider=${kind}`), fixture.env);
    const state = new URL(start.headers.get("Location")!).searchParams.get("state");
    const callback = await handler.fetch(new Request(`https://cas.example/oauth/${kind}/callback?state=${state}&code=code`, {
      headers: { Cookie: cookieFrom(start) },
    }), fixture.env);
    expect(callback.status).toBe(200);
    const html = await callback.text();
    expect(html).not.toContain("private-hint");
    expect(html).not.toContain("provider-subject");
    expect(accounts.resolveExternalIdentity).toHaveBeenCalledWith(`https://${kind}.example`, "provider-subject");
    const accepted = await handler.fetch(new Request("https://cas.example/oauth/authorize", {
      method: "POST", headers: { Cookie: cookieFrom(callback), Origin: "https://cas.example" },
      body: new URLSearchParams({ consent_id: hiddenValue(html, "consent_id"), csrf_token: hiddenValue(html, "csrf_token"), decision: "approve" }),
    }), fixture.env);
    expect(accepted.status).toBe(302);
    expect(fixture.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      userId: resolution.account.accountId,
      props: expect.objectContaining({ accountId: resolution.account.accountId, authProvider: kind, credentialVersion: 2 }),
    }));
    const second = await handler.fetch(new Request(`https://cas.example/oauth/authorize?provider=${kind}`), fixture.env);
    const wrongState = new URL(second.headers.get("Location")!).searchParams.get("state");
    const wrong = await handler.fetch(new Request(`https://cas.example/oauth/google/callback?state=${wrongState}&code=code`, {
      headers: { Cookie: cookieFrom(second) },
    }), fixture.env);
    expect(wrong.status).toBe(400);
  });

  test.each([false, true])("binds grants to Accounts and rechecks consent credential version (revoked=%s)", async revoked => {
    const fixture = createFixture();
    const resolution = {
      account: { accountId: `acct_${"a".repeat(22)}`, credentialVersion: 1 },
      authenticatedIdentity: { issuer: "https://accounts.example", subject: "alice-sub", externalIdentityId: "external-1" },
      platformAuthorities: ["apps.create"], hasAppMembership: false,
    } as AccountResolution;
    const accounts = {
      resolveExternalIdentity: vi.fn(async () => resolution),
      authorizeCredential: vi.fn(async () => resolution),
    };
    const handler = createOAuthAuthorizationHandler({ oidcFactory: () => fixture.oidc, accountServiceFactory: () => accounts });
    const started = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
    const state = new URL(started.headers.get("Location")!).searchParams.get("state");
    const callback = await handler.fetch(new Request(`https://cas.example/oauth/google/callback?code=code&state=${state}`, {
      headers: { Cookie: cookieFrom(started) },
    }), fixture.env);
    expect(callback.status).toBe(200);
    const html = await callback.text();
    if (revoked) accounts.authorizeCredential.mockRejectedValue(new AccountServiceError("CREDENTIAL_VERSION_MISMATCH"));
    const accepted = await handler.fetch(new Request("https://cas.example/oauth/authorize", {
      method: "POST",
      headers: { Cookie: cookieFrom(callback), Origin: "https://cas.example" },
      body: new URLSearchParams({ consent_id: hiddenValue(html, "consent_id"), csrf_token: hiddenValue(html, "csrf_token"), decision: "approve" }),
    }), fixture.env);
    expect(accepted.status).toBe(revoked ? 403 : 302);
    if (revoked) expect(fixture.completeAuthorization).not.toHaveBeenCalled();
    else expect(fixture.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      userId: resolution.account.accountId,
      props: expect.objectContaining({ accountId: resolution.account.accountId, externalIdentityId: "external-1", credentialVersion: 1 }),
    }));
  });

  test("authenticates with Google, requires consent, and completes a scoped grant", async () => {
    const fixture = createFixture();
    const resolveExternalIdentity = vi.fn(async () => accountResolution);
    const handler = createOAuthAuthorizationHandler({
      oidcFactory: () => fixture.oidc,
      accountServiceFactory: () => ({ resolveExternalIdentity, authorizeCredential: async () => accountResolution }),
    });

    const started = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
    expect(started.status).toBe(302);
    const googleLocation = new URL(started.headers.get("Location")!);
    const transactionId = googleLocation.searchParams.get("state")!;
    expect(googleLocation.origin).toBe("https://accounts.example");
    expect(googleLocation.searchParams.get("code_challenge_method")).toBe("S256");
    const authCookie = cookieFrom(started);
    expect(authCookie).toBe(`unicas_mcp_oauth=${transactionId}`);
    const encrypted = [...fixture.kv.values()][0]!;
    expect(encrypted).not.toContain(oauthRequest.clientId);
    expect(encrypted).not.toContain("client-state");

    const callback = await handler.fetch(new Request(
      `https://cas.example/oauth/google/callback?code=google-code&state=${transactionId}`,
      { headers: { Cookie: authCookie } },
    ), fixture.env);
    expect(callback.status).toBe(200);
    expect(callback.headers.get("Content-Type")).toContain("text/html");
    const consentHtml = await callback.text();
    expect(consentHtml).toContain("GitHub Copilot");
    expect(consentHtml).toContain("control:security");
    expect(consentHtml).toContain("Manage security settings");
    expect(consentHtml).toContain("class=\"panel\"");
    expect(consentHtml).toContain("@media (max-width: 520px)");
    expect(consentHtml).toContain('action="https://cas.example/oauth/authorize"');
    expect(callback.headers.get("Content-Security-Policy"))
      .toContain("form-action https://cas.example https://vscode.dev");
    expect(callback.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(resolveExternalIdentity).toHaveBeenCalledWith("https://accounts.example", "alice-sub");
    const consentId = hiddenValue(consentHtml, "consent_id");
    const csrfToken = hiddenValue(consentHtml, "csrf_token");
    const consentCookie = cookieFrom(callback);

    const replay = await handler.fetch(new Request(
      `https://cas.example/oauth/google/callback?code=google-code&state=${transactionId}`,
      { headers: { Cookie: authCookie } },
    ), fixture.env);
    expect(replay.status).toBe(400);

    const approved = await handler.fetch(new Request("https://cas.example/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: consentCookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://cas.example",
      },
      body: new URLSearchParams({
        consent_id: consentId,
        csrf_token: csrfToken,
        decision: "approve",
      }),
    }), fixture.env);
    expect(approved.status).toBe(302);
    expect(approved.headers.get("Location")).toBe("https://vscode.dev/redirect?code=unicas-code");
    expect(fixture.completeAuthorization).toHaveBeenCalledTimes(1);
    const completed = fixture.completeAuthorization.mock.calls[0]![0];
    expect(completed.scope).toEqual(["control:read", "control:security"]);
    expect(completed.userId).not.toContain("alice-sub");
    expect(completed.metadata).not.toMatchObject({ clientId: oauthRequest.clientId });
    expect(completed.props).toEqual({
      accountId: accountResolution.account.accountId,
      externalIdentityId: "external-1",
      credentialVersion: 1,
      authProvider: "google",
      authenticatedAt: expect.any(Number),
      identityIssuer: "https://accounts.example",
      subject: "alice-sub",
      displayName: "Alice",
      emailForDisplay: "alice@example.com",
      verifiedEmailEvidence: [{
        normalizedEmail: "alice@example.com",
        source: "google-oidc",
        verifiedAt: expect.any(Number),
        expiresAt: expect.any(Number),
        authenticationEventId: expect.any(String),
      }],
      scopes: ["control:read", "control:security"],
      oauthClientId: oauthRequest.clientId,
      oauthClientHandle: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(completed.props.verifiedEmailEvidence[0].expiresAt)
      .toBeGreaterThan(completed.props.verifiedEmailEvidence[0].verifiedAt);
    expect(JSON.stringify(completed.props)).not.toContain("google-access-token");
  });

  test("rejects a verified Google identity without an Account", async () => {
    const fixture = createFixture();
    const handler = createOAuthAuthorizationHandler({
      oidcFactory: () => fixture.oidc,
      accountServiceFactory: () => ({ resolveExternalIdentity: async () => null, authorizeCredential: async () => accountResolution }),
    });
    const started = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
    const transactionId = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const callback = await handler.fetch(new Request(
      `https://cas.example/oauth/google/callback?code=google-code&state=${transactionId}`,
      { headers: { Cookie: cookieFrom(started) } },
    ), fixture.env);

    expect(callback.status).toBe(403);
    expect(fixture.completeAuthorization).not.toHaveBeenCalled();
  });

  test("current Account admission permits MCP consent", async () => {
    const fixture = createFixture();
    const handler = createOAuthAuthorizationHandler({
      oidcFactory: () => fixture.oidc,
    });
    const started = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
    const transactionId = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const callback = await handler.fetch(new Request(
      `https://cas.example/oauth/google/callback?code=google-code&state=${transactionId}`,
      { headers: { Cookie: cookieFrom(started) } },
    ), fixture.env);

    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("GitHub Copilot");
  });

  test("denies consent when current platform admission is absent or unavailable", async () => {
    for (const [authorization, expectedStatus] of [
      ["denied", 403],
      ["unavailable", 503],
    ] as const) {
      const fixture = createFixture();
      const handler = createOAuthAuthorizationHandler({
        oidcFactory: () => fixture.oidc,
        accountServiceFactory: () => ({
          resolveExternalIdentity: async () => {
            if (authorization === "unavailable") throw new Error("offline");
            return { ...accountResolution, platformAuthorities: [] };
          },
          authorizeCredential: async () => accountResolution,
        }),
      });
      const started = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
      const transactionId = new URL(started.headers.get("Location")!).searchParams.get("state")!;
      const callback = await handler.fetch(new Request(
        `https://cas.example/oauth/google/callback?code=google-code&state=${transactionId}`,
        { headers: { Cookie: cookieFrom(started) } },
      ), fixture.env);

      expect(callback.status).toBe(expectedStatus);
      expect(fixture.completeAuthorization).not.toHaveBeenCalled();
    }
  });

  test("rejects unsupported scopes before starting Google authentication", async () => {
    const fixture = createFixture({ request: { ...oauthRequest, scope: ["control:read", "unknown"] } });
    const handler = createOAuthAuthorizationHandler({ oidcFactory: () => fixture.oidc });
    const response = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("invalid_scope");
    expect(fixture.kv.size).toBe(0);
  });

  test.each([
    ["same-origin fetch metadata", { "Sec-Fetch-Site": "same-origin" }, 302],
    ["same-origin referer", { Referer: "https://cas.example/oauth/authorize" }, 302],
    ["cross-origin request", { Origin: "https://attacker.example" }, 403],
    ["cross-site fetch metadata", { "Sec-Fetch-Site": "cross-site" }, 403],
    ["opaque cross-site origin", { Origin: "null", "Sec-Fetch-Site": "cross-site" }, 403],
    ["client without optional origin metadata", {}, 302],
  ])("handles consent origin evidence: %s", async (_name, originHeaders, expectedStatus) => {
    const fixture = createFixture();
    const handler = createOAuthAuthorizationHandler({ oidcFactory: () => fixture.oidc });
    const started = await handler.fetch(new Request("https://cas.example/oauth/authorize"), fixture.env);
    const transactionId = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    const callback = await handler.fetch(new Request(
      `https://cas.example/oauth/google/callback?code=google-code&state=${transactionId}`,
      { headers: { Cookie: cookieFrom(started) } },
    ), fixture.env);
    const consentHtml = await callback.text();
    const headers = new Headers({
      Cookie: cookieFrom(callback),
      "Content-Type": "application/x-www-form-urlencoded",
      ...originHeaders,
    });
    const response = await handler.fetch(new Request("https://cas.example/oauth/authorize", {
      method: "POST",
      headers,
      body: new URLSearchParams({
        consent_id: hiddenValue(consentHtml, "consent_id"),
        csrf_token: hiddenValue(consentHtml, "csrf_token"),
        decision: "approve",
      }),
    }), fixture.env);

    expect(response.status).toBe(expectedStatus);
  });
});

function createFixture(options: { request?: AuthRequest } = {}) {
  const kv = new Map<string, string>();
  const completeAuthorization = vi.fn(async (_options: CompleteAuthorizationOptions) => ({
    redirectTo: "https://vscode.dev/redirect?code=unicas-code",
  }));
  const oauth = {
    parseAuthRequest: vi.fn(async () => options.request ?? oauthRequest),
    lookupClient: vi.fn(async () => ({
      clientId: oauthRequest.clientId,
      clientName: "GitHub Copilot",
      redirectUris: [oauthRequest.redirectUri],
      tokenEndpointAuthMethod: "none",
    })),
    completeAuthorization,
  } as unknown as OAuthHelpers;
  const oidc = {
    authorizationUrl: vi.fn(async (input: { state: string; nonce: string; codeChallenge: string }) => {
      const url = new URL("https://accounts.example/authorize");
      url.searchParams.set("state", input.state);
      url.searchParams.set("nonce", input.nonce);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    }),
    exchangeCode: vi.fn(async () => ({
      idToken: "google-id-token",
      accessToken: "google-access-token",
    })),
    verifyIdToken: vi.fn(async () => ({
      sub: "alice-sub",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
    })),
  } as unknown as OidcClient;
  const stateKey = new Uint8Array(32);
  crypto.getRandomValues(stateKey);
  let binary = "";
  for (const byte of stateKey) binary += String.fromCharCode(byte);
  const env: OAuthAuthorizationEnv = {
    OAUTH_KV: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string | ArrayBuffer | ArrayBufferView) => {
        kv.set(key, String(value));
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
    } as unknown as KVNamespace,
    OAUTH_PROVIDER: oauth,
    MCP_PUBLIC_ORIGIN: "https://cas.example",
    PUBLIC_ORIGIN: "https://legacy.example",
    OAUTH_STATE_ENCRYPTION_KEY: btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    OIDC_ISSUER: "https://accounts.example",
  };
  return { env, kv, oidc, completeAuthorization };
}

function cookieFrom(response: Response): string {
  return response.headers.get("Set-Cookie")!.split(";", 1)[0]!;
}

function hiddenValue(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  if (!match) throw new Error(`hidden field ${name} not found`);
  return match[1]!;
}
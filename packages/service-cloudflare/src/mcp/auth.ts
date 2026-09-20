import type {
  AuthorizationError,
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import {
  generateOidcNonce,
  generatePkceVerifier,
  OidcClient,
  s256Challenge,
} from "@unicas/control-auth";
import { CONTROL_PLANE_MCP_SCOPES } from "./config.js";
import type { ControlPlaneMcpGrantProps } from "./server.js";
import { AccountServiceError, ProviderRegistry, type AccountService, type ProviderAdapter, type VerifiedEmailEvidence } from "@unicas/service";
import type { ProviderKind } from "@unicas/admin-protocol";
import { checkMcpAccountAccess, type McpAccountCredential } from "./platform-access.js";
import { GoogleProviderAdapter, createGitHubProvider, createMicrosoftPersonalProvider } from "../admin-bff/providers.js";
import { ControlSessionStore } from "../control-sessions.js";

const AUTH_COOKIE = "unicas_mcp_oauth";
const CONSENT_COOKIE = "unicas_mcp_consent";
const TRANSACTION_TTL_SECONDS = 10 * 60;

export interface OAuthAuthorizationEnv {
  OAUTH_KV: KVNamespace;
  CAS_CONTROL_DB?: D1Database;
  OAUTH_PROVIDER?: OAuthHelpers;
  MCP_PUBLIC_ORIGIN?: string;
  PUBLIC_ORIGIN?: string;
  OAUTH_GOOGLE_CLIENT_ID?: string;
  OAUTH_GOOGLE_CLIENT_SECRET?: string;
  OAUTH_MICROSOFT_CLIENT_ID?: string;
  OAUTH_MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_OIDC_DISCOVERY_URL?: string;
  OAUTH_GITHUB_CLIENT_ID?: string;
  OAUTH_GITHUB_CLIENT_SECRET?: string;
  OAUTH_STATE_ENCRYPTION_KEY?: string;
  OIDC_ISSUER?: string;
  OIDC_DISCOVERY_URL?: string;
}

interface PendingProviderAuthorization {
  readonly kind: "provider";
  readonly provider: ProviderKind;
  readonly oauthRequest: AuthRequest;
  readonly oidcNonce: string;
  readonly oidcCodeVerifier: string;
}

interface PendingConsent {
  readonly kind: "consent";
  readonly oauthRequest: AuthRequest;
  readonly identity: Required<McpAccountCredential> & {
    readonly authProvider?: ProviderKind;
    readonly authenticatedAt?: number;
    readonly identityIssuer: string;
    readonly subject: string;
    readonly displayName: string | null;
    readonly emailForDisplay: string | null;
    readonly verifiedEmailEvidence: readonly VerifiedEmailEvidence[];
  };
  readonly clientName: string;
  readonly csrfToken: string;
}

type PendingAuthorization = PendingProviderAuthorization | PendingConsent;

export interface OAuthAuthorizationHandlerOptions {
  readonly oidcFactory?: (env: OAuthAuthorizationEnv) => OidcClient;
  readonly providerRegistryFactory?: (env: OAuthAuthorizationEnv) => ProviderRegistry;
  readonly accountServiceFactory: (env: OAuthAuthorizationEnv) => Pick<AccountService, "resolveExternalIdentity" | "authorizeCredential">;
}

export function createOAuthAuthorizationHandler(options: OAuthAuthorizationHandlerOptions) {
  return {
    async fetch(request: Request, env: OAuthAuthorizationEnv): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/oauth/authorize" && request.method === "GET") {
        return startAuthorization(request, env, options);
      }
      const callback = /^\/oauth\/callback\/(google|microsoft|github)$/.exec(url.pathname);
      if (callback && request.method === "GET") {
        return finishProviderAuthentication(request, env, options, callback[1] as ProviderKind);
      }
      if (url.pathname === "/oauth/authorize" && request.method === "POST") {
        return finishConsent(request, env, options);
      }
      return authFailure("This authorization page is not available.", 404);
    },
  };
}

async function startAuthorization(
  request: Request,
  env: OAuthAuthorizationEnv,
  options: OAuthAuthorizationHandlerOptions,
): Promise<Response> {
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await oauthProvider(env).parseAuthRequest(request);
  } catch (error) {
    return authorizationError(error);
  }
  const unsupportedScopes = oauthRequest.scope.filter(
    (scope) => !CONTROL_PLANE_MCP_SCOPES.includes(scope as (typeof CONTROL_PLANE_MCP_SCOPES)[number]),
  );
  if (unsupportedScopes.length > 0) {
    return oauthErrorRedirect(oauthRequest, "invalid_scope", "The request contains an unsupported scope");
  }
  const registry = providerRegistry(env, options);
  const requestedProvider = new URL(request.url).searchParams.get("provider");
  if (requestedProvider === null && registry.list().length > 1) {
    return new Response(renderProviderSelection(new URL(request.url), registry.list()), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const selected = requestedProvider ?? registry.list()[0]?.kind;
  if (selected !== "google" && selected !== "microsoft" && selected !== "github") return authFailure("Authentication could not be started");
  const adapter = registry.get(selected);
  if (!adapter) return authFailure("Authentication could not be started");
  const transactionId = randomToken();
  const oidcNonce = generateOidcNonce();
  const oidcCodeVerifier = generatePkceVerifier();
  await writeTransaction(env, transactionId, {
    kind: "provider",
    provider: selected,
    oauthRequest,
    oidcNonce,
    oidcCodeVerifier,
  });
  const location = await adapter.begin({
    purpose: "mcp",
    state: transactionId,
    nonce: oidcNonce,
    codeChallenge: await s256Challenge(oidcCodeVerifier),
  });
  return redirectWithCookie(location, AUTH_COOKIE, transactionId);
}

async function finishProviderAuthentication(
  request: Request,
  env: OAuthAuthorizationEnv,
  options: OAuthAuthorizationHandlerOptions,
  provider: ProviderKind,
): Promise<Response> {
  const url = new URL(request.url);
  const transactionId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !transactionId || !code || readCookie(request, AUTH_COOKIE) !== transactionId) {
    return authFailure("Invalid or expired authorization state");
  }
  const transaction = await takeTransaction(env, transactionId);
  if (!transaction || transaction.kind !== "provider" || transaction.provider !== provider) {
    return authFailure("Invalid or expired authorization state");
  }
  try {
    const adapter = providerRegistry(env, options).get(provider);
    if (!adapter) return authFailure("Authentication could not be completed");
    const identity = await adapter.complete({
      code,
      state: transactionId,
      codeVerifier: transaction.oidcCodeVerifier,
      nonce: transaction.oidcNonce,
      authenticationEventId: randomToken(),
    });
    const account = await options.accountServiceFactory(env).resolveExternalIdentity(identity.issuer, identity.subject);
    if (!account || (!account.hasAppMembership && account.platformAuthorities.length === 0)) {
      return authFailure("This account is not allowed to access the UniCAS control plane", 403);
    }
    const accountBinding = {
      accountId: account.account.accountId,
      externalIdentityId: account.authenticatedIdentity.externalIdentityId,
      credentialVersion: account.account.credentialVersion,
    };
    const client = await oauthProvider(env).lookupClient(transaction.oauthRequest.clientId);
    if (!client) return authFailure("OAuth client is no longer registered");
    const consentId = randomToken();
    const csrfToken = randomToken();
    const pending: PendingConsent = {
      kind: "consent",
      oauthRequest: transaction.oauthRequest,
      identity: {
        ...accountBinding,
        authProvider: identity.provider,
        authenticatedAt: identity.authenticatedAt,
        identityIssuer: identity.issuer,
        subject: identity.subject,
        displayName: identity.displayName,
        emailForDisplay: identity.verifiedEmailEvidence[0]?.normalizedEmail ?? null,
        verifiedEmailEvidence: identity.verifiedEmailEvidence,
      },
      clientName: client.clientName ?? "MCP client",
      csrfToken,
    };
    await writeTransaction(env, consentId, pending);
    const publicOrigin = normalizePublicOrigin(mcpPublicOrigin(env));
    const clientRedirectOrigin = new URL(pending.oauthRequest.redirectUri).origin;
    return htmlWithCookie(
      renderConsent(pending, consentId, publicOrigin),
      CONSENT_COOKIE,
      consentId,
      publicOrigin,
      clientRedirectOrigin,
    );
  } catch (error) {
    return authFailure("Authentication could not be completed", error instanceof AccountServiceError ? 403 : 503);
  }
}

async function finishConsent(request: Request, env: OAuthAuthorizationEnv, options: OAuthAuthorizationHandlerOptions): Promise<Response> {
  const publicOrigin = mcpPublicOrigin(env);
  if (!isSameOriginConsent(request, publicOrigin)) {
    return authFailure("Consent must be submitted from the authorization server origin", 403);
  }
  const form = await request.formData().catch(() => null);
  const consentId = form?.get("consent_id");
  const csrfToken = form?.get("csrf_token");
  const decision = form?.get("decision");
  if (
    typeof consentId !== "string"
    || readCookie(request, CONSENT_COOKIE) !== consentId
    || typeof csrfToken !== "string"
  ) {
    return authFailure("Invalid or expired consent transaction");
  }
  const pending = await takeTransaction(env, consentId);
  if (!pending || pending.kind !== "consent" || !(await secureEqual(csrfToken, pending.csrfToken))) {
    return authFailure("Invalid or expired consent transaction");
  }
  if (decision !== "approve") {
    return oauthDeniedRedirect(pending.oauthRequest);
  }
  const error = await checkMcpAccountAccess(options.accountServiceFactory(env), pending.identity);
  if (error) return error;
  const grantedScopes = pending.oauthRequest.scope.filter(
    (scope): scope is (typeof CONTROL_PLANE_MCP_SCOPES)[number] =>
      CONTROL_PLANE_MCP_SCOPES.includes(scope as (typeof CONTROL_PLANE_MCP_SCOPES)[number]),
  );
  const oauthClientId = pending.oauthRequest.clientId;
  const oauthClientHandle = await sha256Hex(oauthClientId);
  const props: ControlPlaneMcpGrantProps = {
    ...pending.identity,
    scopes: grantedScopes,
    oauthClientId,
    oauthClientHandle,
  };
  const { redirectTo } = await oauthProvider(env).completeAuthorization({
    request: pending.oauthRequest,
    userId: pending.identity.accountId,
    metadata: {
      clientHandle: oauthClientHandle,
      clientName: pending.clientName,
    },
    scope: grantedScopes,
    props,
  });
  return clearCookieRedirect(redirectTo, CONSENT_COOKIE);
}

function isSameOriginConsent(request: Request, publicOrigin: string): boolean {
  const expected = new URL(publicOrigin).origin;
  const origin = request.headers.get("Origin");
  if (origin && origin !== "null") return parseOrigin(origin) === expected;
  const referer = request.headers.get("Referer");
  if (referer) return parseOrigin(referer) === expected;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite) return fetchSite === "same-origin";
  // Legacy and privacy-focused clients may omit all optional origin metadata.
  // The one-time CSRF token and SameSite consent cookie remain mandatory.
  return true;
}

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function oidcClient(env: OAuthAuthorizationEnv, options: OAuthAuthorizationHandlerOptions): OidcClient {
  if (options.oidcFactory) return options.oidcFactory(env);
  const clientId = requireEnv(env.OAUTH_GOOGLE_CLIENT_ID, "OAUTH_GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv(env.OAUTH_GOOGLE_CLIENT_SECRET, "OAUTH_GOOGLE_CLIENT_SECRET");
  const publicOrigin = mcpPublicOrigin(env);
  return new OidcClient({
    issuer: env.OIDC_ISSUER ?? "https://accounts.google.com",
    discoveryUrl: env.OIDC_DISCOVERY_URL,
    clientId,
    clientSecret,
    redirectUri: `${publicOrigin}/oauth/callback/google`,
  });
}

function providerRegistry(env: OAuthAuthorizationEnv, options: OAuthAuthorizationHandlerOptions): ProviderRegistry {
  if (options.providerRegistryFactory) return options.providerRegistryFactory(env);
  const origin = mcpPublicOrigin(env);
  const adapters: ProviderAdapter[] = [];
  if (options.oidcFactory || env.OAUTH_GOOGLE_CLIENT_ID && env.OAUTH_GOOGLE_CLIENT_SECRET) {
    adapters.push(new GoogleProviderAdapter(oidcClient(env, options), env.OIDC_ISSUER ?? "https://accounts.google.com"));
  }
  if (env.OAUTH_MICROSOFT_CLIENT_ID && env.OAUTH_MICROSOFT_CLIENT_SECRET) {
    adapters.push(createMicrosoftPersonalProvider({
      clientId: env.OAUTH_MICROSOFT_CLIENT_ID, clientSecret: env.OAUTH_MICROSOFT_CLIENT_SECRET,
      discoveryUrl: env.MICROSOFT_OIDC_DISCOVERY_URL, redirectUri: `${origin}/oauth/callback/microsoft`,
    }));
  }
  if (env.OAUTH_GITHUB_CLIENT_ID && env.OAUTH_GITHUB_CLIENT_SECRET) {
    adapters.push(createGitHubProvider({
      clientId: env.OAUTH_GITHUB_CLIENT_ID, clientSecret: env.OAUTH_GITHUB_CLIENT_SECRET,
      redirectUri: `${origin}/oauth/callback/github`,
    }));
  }
  return new ProviderRegistry(adapters);
}

function mcpPublicOrigin(env: OAuthAuthorizationEnv): string {
  return requireEnv(env.MCP_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN, "MCP_PUBLIC_ORIGIN");
}

async function writeTransaction(
  env: OAuthAuthorizationEnv,
  id: string,
  value: PendingAuthorization,
): Promise<void> {
  const encrypted = await encryptJson(value, requireEnv(env.OAUTH_STATE_ENCRYPTION_KEY, "OAUTH_STATE_ENCRYPTION_KEY"));
  if (env.CAS_CONTROL_DB) {
    await new ControlSessionStore(env.CAS_CONTROL_DB).create(transactionKey(id), encrypted, TRANSACTION_TTL_SECONDS * 1000);
    return;
  }
  await env.OAUTH_KV.put(transactionKey(id), encrypted, { expirationTtl: TRANSACTION_TTL_SECONDS });
}

async function takeTransaction(env: OAuthAuthorizationEnv, id: string): Promise<PendingAuthorization | null> {
  const key = transactionKey(id);
  if (env.CAS_CONTROL_DB) {
    const consumed = await new ControlSessionStore(env.CAS_CONTROL_DB).take(key);
    if (!consumed) return null;
    try {
      return await decryptJson(consumed.encryptedPayload, requireEnv(env.OAUTH_STATE_ENCRYPTION_KEY, "OAUTH_STATE_ENCRYPTION_KEY"));
    } catch {
      return null;
    }
  }
  const encrypted = await env.OAUTH_KV.get(key);
  if (!encrypted) return null;
  await env.OAUTH_KV.delete(key);
  try {
    return await decryptJson(encrypted, requireEnv(env.OAUTH_STATE_ENCRYPTION_KEY, "OAUTH_STATE_ENCRYPTION_KEY"));
  } catch {
    return null;
  }
}

function transactionKey(id: string): string {
  return `unicas:oauth-transaction:${id}`;
}

async function encryptJson(value: PendingAuthorization, encodedKey: string): Promise<string> {
  const key = await importAesKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

async function decryptJson(value: string, encodedKey: string): Promise<PendingAuthorization> {
  const [ivPart, ciphertextPart] = value.split(".");
  if (!ivPart || !ciphertextPart) throw new Error("invalid encrypted transaction");
  const key = await importAesKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(ivPart) },
    key,
    base64UrlDecode(ciphertextPart),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as PendingAuthorization;
}

async function importAesKey(value: string): Promise<CryptoKey> {
  const bytes = base64UrlDecode(value);
  if (bytes.byteLength !== 32) throw new Error("OAUTH_STATE_ENCRYPTION_KEY must encode 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function renderConsent(pending: PendingConsent, consentId: string, publicOrigin: string): string {
  const scopes = pending.oauthRequest.scope
    .map((scope) => {
      const detail = scopeDetail(scope);
      return `<li class="scope-row${detail.sensitive ? " scope-row-sensitive" : ""}">
        <span class="scope-icon" aria-hidden="true">${detail.icon}</span>
        <span class="scope-copy"><strong>${escapeHtml(detail.title)}</strong><span>${escapeHtml(detail.description)}</span></span>
        <code>${escapeHtml(scope)}</code>
      </li>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Authorize ${escapeHtml(pending.clientName)} · UniCAS</title>
  <style>
    :root { color-scheme: light; font-family: "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #18181b; background: #f8f8f9; font-synthesis: none; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; background-color: #f8f8f9; background-image: linear-gradient(rgba(24,24,27,.022) 1px,transparent 1px),linear-gradient(90deg,rgba(24,24,27,.022) 1px,transparent 1px); background-size: 28px 28px; font-size: 14px; line-height: 1.5; letter-spacing: 0; }
    .topbar { display: flex; height: 52px; align-items: center; padding: 0 20px; background: rgba(255,255,255,.94); border-bottom: 1px solid #e1e1e4; }
    .brand { display: inline-flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 650; }
    .brand-mark { display: grid; width: 26px; height: 26px; place-items: center; color: #fafafa; background: #27272a; border-radius: 6px; font-size: 12px; font-weight: 750; }
    main { display: grid; min-height: calc(100vh - 52px); place-items: center; padding: 32px 16px 12vh; }
    .panel { width: min(480px,100%); padding: 24px; background: #fff; border: 1px solid #e1e1e4; border-radius: 7px; box-shadow: 0 8px 30px rgba(24,24,27,.06); animation: enter 180ms ease-out both; }
    .eyebrow { margin: 0 0 6px; color: #71717a; font-size: 12px; font-weight: 650; text-transform: uppercase; }
    h1 { margin: 0; font-size: 23px; line-height: 1.25; }
    .intro { margin: 9px 0 20px; color: #52525b; }
    .identity { display: flex; align-items: center; gap: 10px; padding: 11px 0 18px; border-bottom: 1px solid #e1e1e4; }
    .avatar { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; color: #3f3f46; background: #f4f4f5; border: 1px solid #e1e1e4; border-radius: 50%; font-weight: 700; }
    .identity-copy { min-width: 0; }
    .identity-copy span { display: block; color: #71717a; font-size: 12px; }
    .identity-copy strong { display: block; overflow-wrap: anywhere; font-weight: 600; }
    .section-title { margin: 18px 0 7px; font-size: 13px; font-weight: 650; }
    .resource { margin: 0 0 8px; color: #71717a; font-size: 12px; overflow-wrap: anywhere; }
    .scope-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid #e1e1e4; }
    .scope-row { display: grid; grid-template-columns: 30px minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 13px 0; border-bottom: 1px solid #e1e1e4; }
    .scope-icon { display: grid; width: 28px; height: 28px; place-items: center; color: #52525b; background: #f4f4f5; border: 1px solid #e1e1e4; border-radius: 6px; font-weight: 750; }
    .scope-row-sensitive .scope-icon { color: #b42318; background: #fff1f0; border-color: #ffd5d2; }
    .scope-copy strong, .scope-copy span { display: block; }
    .scope-copy strong { font-size: 13px; font-weight: 650; }
    .scope-copy span { margin-top: 1px; color: #71717a; font-size: 12px; }
    code { padding: 3px 6px; color: #52525b; background: #f4f4f5; border-radius: 4px; font: 11px/1.35 "Cascadia Code","SFMono-Regular",Consolas,monospace; white-space: nowrap; }
    form { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 20px; }
    button { min-height: 40px; padding: 0 15px; border: 1px solid #c9c9ce; border-radius: 6px; font: inherit; font-weight: 650; cursor: pointer; }
    .deny { color: #27272a; background: #fff; }
    .deny:hover { background: #f4f4f5; }
    .approve { color: #fafafa; background: #27272a; border-color: #27272a; }
    .approve:hover { background: #09090b; }
    button:focus-visible { outline: 2px solid #52525b; outline-offset: 2px; }
    .footnote { margin: 14px 0 0; color: #71717a; font-size: 11px; text-align: center; }
    @keyframes enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 520px) { main { place-items: start center; padding-top: 22px; } .panel { padding: 20px; } .scope-row { grid-template-columns: 30px minmax(0,1fr); } code { grid-column: 2; justify-self: start; } }
  </style>
</head>
<body>
  <header class="topbar"><span class="brand"><span class="brand-mark">U</span>UniCAS</span></header>
  <main>
    <section class="panel" aria-labelledby="consent-title">
      <p class="eyebrow">Authorization request</p>
      <h1 id="consent-title">Allow ${escapeHtml(pending.clientName)}?</h1>
      <p class="intro">This application is requesting access to your UniCAS control plane.</p>
      <div class="identity">
        <span class="avatar" aria-hidden="true">${escapeHtml(identityInitial(pending))}</span>
        <span class="identity-copy"><span>Signed in as</span><strong>${escapeHtml(pending.identity.emailForDisplay ?? pending.identity.displayName ?? pending.identity.accountId ?? "UniCAS Account")}</strong></span>
      </div>
      <p class="section-title">Requested permissions</p>
      <p class="resource">${escapeHtml(String(pending.oauthRequest.resource ?? "UniCAS control plane"))}</p>
      <ul class="scope-list">${scopes}</ul>
      <form method="post" action="${escapeHtml(publicOrigin)}/oauth/authorize">
        <input type="hidden" name="consent_id" value="${escapeHtml(consentId)}">
        <input type="hidden" name="csrf_token" value="${escapeHtml(pending.csrfToken)}">
        <button class="deny" type="submit" name="decision" value="deny">Deny</button>
        <button class="approve" type="submit" name="decision" value="approve">Authorize</button>
      </form>
      <p class="footnote">You can revoke this access at any time.</p>
    </section>
  </main>
</body>
</html>`;
}

function renderProviderSelection(
  requestUrl: URL,
  providers: readonly Pick<ProviderAdapter, "kind" | "displayName">[],
): string {
  const links = providers.map(provider => {
    const target = new URL(requestUrl);
    target.searchParams.set("provider", provider.kind);
    return `<a class="provider" href="${escapeHtml(target.pathname + target.search)}"><span class="provider-icon provider-icon-${provider.kind}" aria-hidden="true">${mcpProviderMark(provider.kind)}</span><span class="provider-label">Continue with ${escapeHtml(provider.displayName)}</span></a>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Sign in - UniCAS</title>
  <style>
    :root { color-scheme: light; font-family: "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #18181b; font-synthesis: none; }
    * { box-sizing: border-box; }
    body { min-width: 320px; min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background-color: #f6f6f7; background-image: linear-gradient(rgba(24,24,27,.024) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,.024) 1px, transparent 1px); background-size: 28px 28px; font-size: 14px; line-height: 1.5; }
    main { width: min(380px, 100%); padding: 24px; background: #fff; border: 1px solid #dddde0; border-radius: 8px; box-shadow: 0 14px 38px rgba(24,24,27,.09); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; }
    .brand-mark { display: grid; width: 30px; height: 30px; place-items: center; color: #fff; background: #263746; border-radius: 6px; font-size: 11px; font-weight: 800; }
    .eyebrow { margin: 0; color: #66666f; font-size: 11px; font-weight: 750; line-height: 1.3; text-transform: uppercase; white-space: nowrap; }
    h1 { margin: 0 0 7px; font-size: 21px; line-height: 1.25; }
    .intro { margin: 0 0 16px; color: #66666f; }
    .providers { display: grid; gap: 8px; }
    .provider { position: relative; display: flex; min-height: 44px; align-items: center; justify-content: center; padding: 8px 44px; color: inherit; background: #fff; border: 1px solid #cfcfd4; border-radius: 6px; font-weight: 650; text-decoration: none; }
    .provider:hover { background: #f1f1f3; border-color: #b9b9c0; }
    .provider:focus-visible { outline: 2px solid #52525b; outline-offset: 2px; }
    .provider-icon { position: absolute; left: 13px; width: 18px; height: 18px; }
    .provider-icon svg { display: block; width: 100%; height: 100%; }
    .provider-label { min-width: 0; text-align: center; }
    .footnote { margin: 16px 0 0; padding-top: 14px; color: #66666f; border-top: 1px solid #dddde0; font-size: 12px; }
    @media (max-width: 420px) { body { padding: 16px; } main { padding: 20px; } }
  </style>
</head>
<body>
  <main aria-labelledby="sign-in-title">
    <header><span class="brand"><span class="brand-mark">U</span><span>UniCAS</span></span><p class="eyebrow">Restricted console</p></header>
    <h1 id="sign-in-title">Sign in to UniCAS</h1>
    <p class="intro">Choose a sign-in method.</p>
    <div class="providers">${links}</div>
    <p class="footnote">Access is checked after authentication. No provider credential is shared with UniCAS.</p>
  </main>
</body>
</html>`;
}

function mcpProviderMark(kind: ProviderKind): string {
  if (kind === "google") return `<svg viewBox="0 0 18 18" focusable="false"><path fill="#4285f4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.877 2.684-6.614z"/><path fill="#34a853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.91-2.259c-.805.54-1.835.86-3.046.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18z"/><path fill="#fbbc05" d="M3.963 10.707A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332z"/><path fill="#ea4335" d="M9 3.58c1.322 0 2.508.455 3.441 1.346l2.582-2.582C13.463.892 11.425 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58z"/></svg>`;
  if (kind === "microsoft") return `<svg viewBox="0 0 23 23" focusable="false"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>`;
  return `<svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;
}

function scopeDetail(scope: string): {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly sensitive: boolean;
} {
  switch (scope) {
    case "control:read":
      return { title: "View control-plane data", description: "Read stacks, members, issuer configuration, and audit records.", icon: "R", sensitive: false };
    case "control:write":
      return { title: "Manage stack configuration", description: "Create stacks and update non-security settings.", icon: "W", sensitive: false };
    case "control:security":
      return { title: "Manage security settings", description: "Invite or remove members and manage the Stack OAuth issuer.", icon: "!", sensitive: true };
    default:
      return { title: scope, description: "Access requested by this application.", icon: "·", sensitive: false };
  }
}

function identityInitial(pending: PendingConsent): string {
  const identity = pending.identity.emailForDisplay ?? pending.identity.displayName ?? pending.identity.accountId ?? "UniCAS Account";
  return identity.trim().charAt(0).toUpperCase() || "U";
}

function authorizationError(error: unknown): Response {
  if (!isAuthorizationError(error)) return authFailure("OAuth authorization request failed");
  if (!error.redirectUri) return authFailure(error.description, 400);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

function oauthDeniedRedirect(request: AuthRequest): Response {
  return oauthErrorRedirect(request, "access_denied");
}

function oauthErrorRedirect(request: AuthRequest, code: string, description?: string): Response {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", code);
  if (description) redirect.searchParams.set("error_description", description);
  redirect.searchParams.set("state", request.state);
  if (request.issuer) redirect.searchParams.set("iss", request.issuer);
  return clearCookieRedirect(redirect.toString(), CONSENT_COOKIE);
}

function authFailure(message: string, status = 400): Response {
  const notFound = status === 404;
  const title = notFound ? "Page not found" : "Authorization failed";
  const statusLabel = notFound ? "Not found" : "Failed";
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${title} - UniCAS</title>
  <style>
    :root { color-scheme: light; font-family: "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #18181b; font-synthesis: none; }
    * { box-sizing: border-box; }
    body { min-width: 320px; min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background-color: #f6f6f7; background-image: linear-gradient(rgba(24,24,27,.024) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,.024) 1px, transparent 1px); background-size: 28px 28px; font-size: 14px; line-height: 1.5; }
    main { width: min(380px, 100%); padding: 24px; background: #fff; border: 1px solid #dddde0; border-radius: 8px; box-shadow: 0 14px 38px rgba(24,24,27,.09); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; }
    .brand-mark { display: grid; width: 30px; height: 30px; place-items: center; color: #fff; background: #263746; border-radius: 6px; font-size: 11px; font-weight: 800; }
    .status { padding-top: 1px; color: #b42318; font-size: 11px; font-weight: 750; text-transform: uppercase; white-space: nowrap; }
    h1 { margin: 0 0 8px; font-size: 21px; line-height: 1.25; }
    p { margin: 0; color: #66666f; }
    .next-step { display: flex; width: fit-content; min-height: 22px; align-items: center; margin: 18px auto 0; padding: 2px 8px; color: #7f1d1d; background: #fff1f0; border: 1px solid #f1b8b2; border-radius: 999px; font-size: 11px; font-weight: 650; white-space: nowrap; }
    @media (max-width: 420px) { body { padding: 16px; } main { padding: 20px; } }
  </style>
</head>
<body>
  <main aria-labelledby="result-title">
    <header><span class="brand"><span class="brand-mark">U</span><span>UniCAS</span></span><span class="status">${statusLabel}</span></header>
    <div role="alert"><h1 id="result-title">${title}</h1><p>${escapeHtml(message)}</p><p class="next-step">Return to your AI tool and start authorization again</p></div>
  </main>
</body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function redirectWithCookie(location: string, name: string, value: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": cookieHeader(name, value),
      "Cache-Control": "no-store",
    },
  });
}

function htmlWithCookie(
  html: string,
  name: string,
  value: string,
  publicOrigin: string,
  clientRedirectOrigin: string,
): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": cookieHeader(name, value),
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${publicOrigin} ${clientRedirectOrigin}; base-uri 'none'; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clearCookieRedirect(location: string, name: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": `${name}=; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      "Cache-Control": "no-store",
    },
  });
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${value}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRANSACTION_TTL_SECONDS}`;
}

function readCookie(request: Request, name: string): string | null {
  for (const item of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return null;
}

function randomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < Math.min(leftHash.length, rightHash.length); index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function normalizePublicOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MCP_PUBLIC_ORIGIN must contain only scheme, host, and optional port");
  }
  return url.origin;
}

function oauthProvider(env: OAuthAuthorizationEnv): OAuthHelpers {
  if (!env.OAUTH_PROVIDER) throw new Error("OAUTH_PROVIDER is unavailable");
  return env.OAUTH_PROVIDER;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isAuthorizationError(error: unknown): error is AuthorizationError {
  if (!(error instanceof Error) || error.name !== "AuthorizationError") return false;
  const candidate = error as Error & Record<string, unknown>;
  const codes = new Set([
    "invalid_request",
    "invalid_target",
    "unauthorized_client",
    "access_denied",
    "unsupported_response_type",
    "invalid_scope",
    "server_error",
    "temporarily_unavailable",
  ]);
  return typeof candidate.code === "string"
    && codes.has(candidate.code)
    && typeof candidate.description === "string"
    && (candidate.redirectUri === undefined || typeof candidate.redirectUri === "string")
    && (candidate.state === undefined || typeof candidate.state === "string")
    && (candidate.issuer === undefined || typeof candidate.issuer === "string");
}
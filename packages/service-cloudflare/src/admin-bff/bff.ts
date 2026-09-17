/**
 * `/admin` BFF dispatcher (testable, no Worker globals).
 *
 * Owns: Google OIDC login/callback/logout, encrypted session cookies, CSRF
 * and origin checks, the frozen control-plane API routes, the invitation
 * accept page redirect, and SPA shell serving. Persistence and control
 * operations are injected by the deployment.
 */

import {
  CasAdminErrorCodes,
  AccountIdSchema,
  casAdminErrorHttpStatus,
  formatCasAdminETag,
  matchAppAdminRoute,
  matchCasAdminRoute,
  matchPlatformAdminRoute,
  PatchAppRequestSchema,
  PatchAccountProfileSchema,
  PatchPlatformAccessSchema,
  AppInvitationQuerySchema,
  InspectAppIssuerRequestSchema,
  ActivateAppIssuerRequestSchema,
} from "@unicas/admin-protocol";
import type {
  AppAdminRoute,
  CasAdminErrorResponse,
  CasAdminRoute,
  ProviderKind,
} from "@unicas/admin-protocol";
import type {
  ControlPlaneCallContext,
  ControlPlaneOperations,
  ControlSessionRepository,
  AccountRepository,
  ManagedOAuthIssuerProvisioner,
  EmailChallengeRepository,
  PlatformAccessRepository,
  PlatformAuditRepository,
  PlatformInvitationRepository,
} from "@unicas/service";
import { AccountService, AccountServiceError, EMAIL_CHALLENGE_TTL_MS, EmailChallengeError, EmailChallengeService, PlatformAccessError, PlatformAccessService, PlatformAuditService, PlatformInvitationService, ProviderRegistry, sha256Hex } from "@unicas/service";
import type { AccountResolution, AuthenticatedProviderResult, ProviderAdapter } from "@unicas/service";
import { requireInvitationEmailEvidence } from "@unicas/service";
import type { AdminBffConfig } from "./config.js";
const ADMIN_ASSET_CACHE_BUSTER = "issuer-discovery-v1";

import {
  generateOidcNonce,
  generateOidcState,
  generatePkceVerifier,
  OidcClient,
  OidcError,
  s256Challenge,
} from "./oidc.js";
import {
  clearSessionCookie,
  generateCsrfToken,
  generateSessionId,
  parseCookies,
  SessionCrypto,
  sessionCookieHeader,
} from "./session.js";
import type {
  AdminSessionPayload,
  CliOneTimeCodePayload,
  IdentityMutationContinuation,
} from "./session.js";
import { checkCsrfToken, checkSameOrigin } from "./csrf.js";
import { transformAppAdminError } from "../app-admin-adapter.js";
import { InvitationTokenCrypto } from "../invitation-token-crypto.js";
import { PeopleService, type PeopleRepository } from "@unicas/service";
import {
  createGitHubProvider,
  createMicrosoftPersonalProvider,
  GoogleProviderAdapter,
  ProviderAdapterError,
} from "./providers.js";

export interface CreateAdminBffOptions {
  readonly config: AdminBffConfig;
  readonly controlPlane: ControlPlaneOperations;
  readonly sessionStore: ControlSessionRepository;
  /** Inject a client for tests; defaults to a real Google client. */
  readonly oidc?: OidcClient;
  /** SPA static asset fetcher (Phase C wires the built console). */
  readonly assets?: (pathname: string) => Promise<Response | null>;
  /**
   * Private tenant audit-reader RPC fetcher (CAS_TENANT_AUDIT_READER service
   * binding). When absent, Root Ref audit routes report not available.
   */
  readonly auditReader?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  /**
   * Platform access repository. When present, login and authenticated requests
   * are gated by the deny-by-default admission guard.
   */
  readonly platformAccessRepository?: PlatformAccessRepository;
  readonly platformInvitationRepository?: PlatformInvitationRepository;
  readonly platformAuditRepository?: PlatformAuditRepository;
  readonly peopleRepository?: PeopleRepository;
  readonly providerRegistry?: ProviderRegistry;
  readonly accountRepository?: AccountRepository;
  readonly managedOAuthIssuer?: ManagedOAuthIssuerProvisioner;
  readonly emailChallengeRepository?: EmailChallengeRepository;
  readonly emailChallengeSender?: EmailChallengeSender;
}

export interface EmailChallengeSender {
  send(input: {
    readonly to: string;
    readonly code: string;
    readonly expiresAt: number;
  }): Promise<void>;
}

const NOT_AVAILABLE_MESSAGE = "Root Ref audit reads are not yet available from the admin plane";
/** Fixed public client id the admin CLI uses against the BFF login endpoints. */
const CLI_CLIENT_ID = "unicas-cli";
/** Lifetime of the one-time code handed to the CLI after Google sign-in. */
const CLI_CODE_TTL_MS = 2 * 60 * 1000;
const REVISION_CACHE_CONTROL = "no-store, no-transform";

function isLoopbackRedirect(value: string | null): value is string {
  if (value === null) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}
const TEST_ACCOUNT_ISSUER = "urn:unicas:manage:test-account";

/** Read-side refDomain validation; reserved migration domains are readable. */
function validateAuditRefDomain(value: string): string | null {
  if (value.length === 0) return "refDomain must not be empty";
  if (value.length > 64) return "refDomain is too long";
  if (!/^[a-z0-9_][a-z0-9_:.-]*$/.test(value)) return "refDomain is malformed";
  return null;
}

export function createAdminBff(options: CreateAdminBffOptions): (request: Request) => Promise<Response> {
  const { config } = options;
  const now = config.now ?? (() => Date.now());
  const controlPlane = options.controlPlane;
  const sessionStore = options.sessionStore;
  const sessionCrypto = new SessionCrypto(config.sessionEncryptionKeys);
  const accountService = options.accountRepository
    ? new AccountService(options.accountRepository, now, options.managedOAuthIssuer ?? null)
    : null;
  const emailChallenges = options.emailChallengeRepository
    ? new EmailChallengeService(options.emailChallengeRepository, { now })
    : null;
  const platformAccess = options.platformAccessRepository
    ? new PlatformAccessService(options.platformAccessRepository, now)
    : null;
  const platformInvitations = platformAccess && options.platformInvitationRepository
    ? new PlatformInvitationService(
      options.platformInvitationRepository,
      platformAccess,
      new InvitationTokenCrypto(config.sessionEncryptionKeys),
      { now },
    )
    : null;
  const platformAudit = platformAccess && options.platformAuditRepository
    ? new PlatformAuditService(options.platformAuditRepository, platformAccess)
    : null;
  const oidc = options.oidc
    ?? new OidcClient({
      issuer: config.oidcIssuer ?? "https://accounts.google.com",
      discoveryUrl: config.oidcDiscoveryUrl,
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: `${config.publicOrigin}/admin/auth/callback/google`,
    });
  const providerRegistry = options.providerRegistry ?? new ProviderRegistry(configuredProviderAdapters());
  const assets = options.assets ?? (async () => null);
  const sessionTtlMs = config.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const cookieName = config.sessionCookieName ?? "cas_admin_session";
  const cookieOptions = {
    name: cookieName,
    secure: config.sessionCookieSecure ?? true,
    sameSite: config.sessionCookieSameSite ?? "Lax",
    maxAgeSeconds: Math.ceil(sessionTtlMs / 1000),
  };
  const absolutize = (path: string): string => `${config.publicOrigin}${path}`;
  const emailAllowlist = config.emailAllowlist
    ? new Set(config.emailAllowlist.map((email) => email.toLowerCase()))
    : null;

  function configuredProviderAdapters(): readonly ProviderAdapter[] {
    const adapters: ProviderAdapter[] = [
      new GoogleProviderAdapter(oidc, config.oidcIssuer ?? "https://accounts.google.com", now),
    ];
    if (config.microsoftClientId && config.microsoftClientSecret) {
      adapters.push(createMicrosoftPersonalProvider({
        clientId: config.microsoftClientId,
        clientSecret: config.microsoftClientSecret,
        discoveryUrl: config.microsoftDiscoveryUrl,
        redirectUri: `${config.publicOrigin}/admin/auth/callback/microsoft`,
        now,
      }));
    }
    if (config.githubClientId && config.githubClientSecret) {
      adapters.push(createGitHubProvider({
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        redirectUri: `${config.publicOrigin}/admin/auth/callback/github`,
        now,
      }));
    }
    return adapters;
  }

  return async function adminFetch(request: Request): Promise<Response> {
    try {
      return await dispatch(request);
    } catch (error) {
      // Unexpected failure: keep the response structured and observable.
      console.error("cas-admin BFF unhandled error", error);
      return json({ error: "SERVICE_UNAVAILABLE", message: "admin request failed" }, 500);
    }
  };

  async function dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (pathname === "/admin/auth/login" && method === "GET") {
      return handleLoginPage(request, url);
    }
    const providerStart = /^\/admin\/auth\/start\/(google|microsoft|github)$/.exec(pathname);
    if (providerStart && method === "GET") {
      return handleProviderLogin(providerStart[1] as ProviderKind, url);
    }
    const providerCallback = /^\/admin\/auth\/callback\/(google|microsoft|github)$/.exec(pathname);
    if (providerCallback && method === "GET") {
      return handleCallback(request, url, providerCallback[1] as ProviderKind);
    }
    if (pathname === "/admin/auth/logout" && method === "POST") {
      return handleLogout(request);
    }
    if (pathname === "/admin/auth/cli/authorize" && method === "GET") {
      return handleCliAuthorize(url);
    }
    if (pathname === "/admin/auth/cli/exchange" && method === "POST") {
      return handleCliExchange(request);
    }
    if (pathname === "/admin/auth/email-challenge" && method === "GET") {
      return handleEmailChallengePage(request);
    }
    if (pathname === "/admin/auth/email-challenge/verify" && method === "POST") {
      return handleEmailChallengeVerification(request);
    }
    if (pathname === "/admin/auth/email-challenge/resend" && method === "POST") {
      return handleEmailChallengeResend(request);
    }
    const linkStart = /^\/admin\/auth\/link\/(google|microsoft|github)$/.exec(pathname);
    if (linkStart && method === "POST") {
      return handleLinkStart(request, linkStart[1] as ProviderKind);
    }
    const unlinkStart = /^\/admin\/auth\/unlink\/([^/]+)$/.exec(pathname);
    if (unlinkStart && method === "POST") {
      return handleUnlinkStart(request, decodeURIComponent(unlinkStart[1]!));
    }

    const inviteMatch = /^\/admin\/invitations\/([^/]+)$/.exec(pathname);
    if (inviteMatch && method === "GET") {
      return handleInvitationPage(request, inviteMatch[1]!);
    }
    const platformInviteMatch = /^\/admin\/platform-invitations\/([^/]+)$/.exec(pathname);
    if (platformInviteMatch && method === "GET") {
      return handlePlatformInvitationPage(request, platformInviteMatch[1]!);
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      return handleShell(request);
    }
    if (pathname.startsWith("/admin/assets/")) {
      const asset = await assets(pathname.slice("/admin".length));
      return asset ?? new Response("Not Found", { status: 404 });
    }

    const platformRoute = matchPlatformAdminRoute(method, pathname);
    if (platformRoute) {
      if (platformRoute.operation === "listPlatformPeople") return handlePeople(request);
      return handlePlatformAdminApi(request, url, platformRoute);
    }

    const route = matchCasAdminRoute(method, pathname);
    if (route) {
      return handleAdminApi(request, url, route);
    }
    const appRoute = matchAppAdminRoute(method, pathname);
    if (appRoute?.operation === "getAccount"
      || appRoute?.operation === "listAccountIdentities"
      || appRoute?.operation === "patchAccountProfile") {
      return handleAccountApi(request, appRoute.operation);
    }
    if (appRoute?.operation === "listApps" || appRoute?.operation === "createApp") {
      return handleAccountApps(request, url, appRoute.operation);
    }
    if (appRoute?.operation === "getApp" || appRoute?.operation === "patchApp") {
      return handleAccountApps(request, url, appRoute.operation, appRoute.appId);
    }
    if (appRoute?.operation === "listMembers" || appRoute?.operation === "deleteMember") {
      return handleAccountAppMembers(request, url, appRoute.appId, appRoute.operation);
    }
    if (appRoute?.operation === "listControlAuditEvents") {
      return handleAccountAppAudit(request, url, appRoute.appId);
    }
    if (appRoute?.operation === "listPeople") return handlePeople(request, appRoute.appId);
    if (appRoute?.operation === "mintManagedCapability") {
      return handleManagedSpaceCapability(request, appRoute.appId);
    }
    if (appRoute?.operation === "inspectOAuthIssuer" || appRoute?.operation === "activateOAuthIssuer") {
      return handleAppIssuerMutation(request, appRoute.appId, appRoute.operation);
    }
    if (appRoute?.operation === "listMemberInvitations" || appRoute?.operation === "revokeMemberInvitation") {
      return handleAppInvitations(request, appRoute.appId, appRoute.operation === "revokeMemberInvitation" ? appRoute.invitationId : undefined);
    }
    return json({ error: "Not Found" }, 404);
  };

  // ------------------------------------------------------------------
  // OIDC flow
  // ------------------------------------------------------------------

  async function handleLoginPage(request: Request, url: URL): Promise<Response> {
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo")) ?? undefined;
    if (url.searchParams.get("test-account") === "1") {
      return handleTestAccountLogin(request, returnTo);
    }
    const sessionId = readSessionId(request);
    const session = sessionId ? await readSession(sessionId) : null;
    if (session?.authenticated) {
      return new Response(null, {
        status: 302,
        headers: { Location: returnTo ?? "/admin/" },
      });
    }
    const configuredProviders = providerRegistry.list();
    const googleOnly = configuredProviders.length === 1 && configuredProviders[0]?.kind === "google";
    const providerButtons = configuredProviders.map(provider => {
      const path = `/admin/auth/start/${provider.kind}`;
      const providerUrl = new URL(path, config.publicOrigin);
      if (returnTo) providerUrl.searchParams.set("returnTo", returnTo);
      return `<a class="btn${configuredProviders.length === 1 ? " btn-primary" : ""}" href="${providerUrl.pathname}${providerUrl.search}">Continue with ${escapeHtml(provider.displayName)}</a>`;
    }).join("\n          ");
    const retryUrl = new URL(
      googleOnly ? "/admin/auth/start/google" : "/admin/auth/login",
      config.publicOrigin,
    );
    if (returnTo) retryUrl.searchParams.set("returnTo", returnTo);
    const error = url.searchParams.get("error");
    const accessRestricted = error === "not-allowed" || error === "access-denied";
    const errorMessage = error === "oidc-failed"
      ? `${googleOnly ? "Google" : "Provider"} sign-in could not be completed. Please try again.`
      : null;
    const testAccountLink = config.testAccount
      ? `<a class="btn" href="/admin/auth/login?test-account=1${returnTo ? `&amp;returnTo=${encodeURIComponent(returnTo)}` : ""}">Use test account</a>`
      : "";
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in - CAS Admin</title>
  <link rel="stylesheet" href="/admin/assets/index.css?v=${ADMIN_ASSET_CACHE_BUSTER}" />
</head>
<body>
  <header class="app-header">
    <span class="brand"><span class="brand-mark">U</span><span>UniCAS</span></span>
  </header>
  <main class="login-shell">
    <section class="login-panel${accessRestricted ? " login-panel-restricted" : ""}">
      ${accessRestricted ? `
        <div class="login-status-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <p class="login-eyebrow">UniCAS Admin</p>
        <h1>No management access</h1>
        <p class="login-copy" role="alert">This ${googleOnly ? "Google account" : "login"} does not have management access to UniCAS. Sign in with another ${googleOnly ? "Google account" : "method"} or contact the UniCAS team.</p>
        <div class="login-actions">
          <a class="btn" href="${retryUrl.pathname}${retryUrl.search}">Sign in with another ${googleOnly ? "Google account" : "method"}</a>
          ${testAccountLink}
        </div>` : `
        <p class="login-eyebrow">Restricted console</p>
        <h1>Sign in to UniCAS</h1>
        <p class="login-copy">${googleOnly ? "Use an approved Google account" : "Choose a configured login method"} to continue.</p>
        ${errorMessage ? `<div class="state error" role="alert">${errorMessage}</div>` : ""}
        <div class="login-actions">
          ${providerButtons}
          ${testAccountLink}
        </div>`}
    </section>
  </main>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  async function handleProviderLogin(provider: ProviderKind, url: URL): Promise<Response> {
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo")) ?? undefined;
    return startProviderLogin(provider, returnTo);
  }

  async function startOidcLogin(
    returnTo?: string,
    invitationContinuation?: AdminSessionPayload["invitationContinuation"],
  ): Promise<Response> {
    return startProviderLogin("google", returnTo, invitationContinuation);
  }

  async function startProviderLogin(
    providerKind: ProviderKind,
    returnTo?: string,
    invitationContinuation?: AdminSessionPayload["invitationContinuation"],
    cli?: {
      readonly clientId: string;
      readonly state: string;
      readonly codeChallenge: string;
      readonly redirectUri: string;
    },
    identityMutationContinuation?: IdentityMutationContinuation,
  ): Promise<Response> {
    const provider = providerRegistry.get(providerKind);
    if (!provider) return new Response("Not Found", { status: 404 });
    const oidcState = generateOidcState();
    const oidcNonce = generateOidcNonce();
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = await s256Challenge(codeVerifier);
    const sessionId = generateSessionId();
    const payload: AdminSessionPayload = {
      v: 1,
      authenticated: false,
      identityIssuer: "",
      subject: "",
      displayName: null,
      emailForDisplay: null,
      csrfToken: "",
      authProvider: providerKind,
      oidcState,
      oidcNonce,
      codeVerifier,
      returnTo,
      invitationContinuation,
      identityMutationContinuation,
      cliClientId: cli?.clientId,
      cliState: cli?.state,
      cliCodeChallenge: cli?.codeChallenge,
      cliRedirectUri: cli?.redirectUri,
    };
    await sessionStore.create(sessionId, await sessionCrypto.encrypt(payload), sessionTtlMs);
    const authorizationUrl = await provider.begin({
      purpose: cli ? "cli" : "login",
      state: oidcState,
      nonce: oidcNonce,
      codeChallenge,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizationUrl,
        "Set-Cookie": sessionCookieHeader(cookieOptions, sessionId),
      },
    });
  }

  async function handleTestAccountLogin(request: Request, returnTo?: string): Promise<Response> {
    const account = config.testAccount;
    if (!account) return new Response("Not Found", { status: 404 });
    const credentials = readBasicCredentials(request);
    const emailMatches = credentials
      ? await secureEqual(credentials.email.toLowerCase(), account.email.toLowerCase())
      : false;
    const passwordMatches = credentials
      ? await secureEqual(credentials.password, account.password)
      : false;
    if (!emailMatches || !passwordMatches) {
      await auditLoginFailure("test-account");
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="UniCAS test account", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      });
    }
    if (!isEmailAllowed(account.email, true)) {
      await auditLoginFailure("test-account-email-not-allowed");
      return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const authenticatedPayload: AdminSessionPayload = {
      v: 1,
      authenticated: true,
      identityIssuer: TEST_ACCOUNT_ISSUER,
      subject: account.email.toLowerCase(),
      displayName: account.email,
      emailForDisplay: account.email,
      csrfToken: generateCsrfToken(),
    };
    return createAuthenticatedSession(
      request,
      authenticatedPayload,
      returnTo ?? "/admin/",
      readSessionId(request),
    );
  }

  async function handleCallback(
    request: Request,
    callbackUrl: URL,
    callbackProvider: ProviderKind,
  ): Promise<Response> {
    const error = callbackUrl.searchParams.get("error");
    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    const sessionId = readSessionId(request);
    const preLogin = sessionId ? await readSession(sessionId) : null;

    const expectedProvider = preLogin?.authProvider ?? "google";
    if (error || !code || !state || !preLogin || preLogin.oidcState !== state
      || expectedProvider !== callbackProvider || !providerRegistry.get(callbackProvider)) {
      if (sessionId && preLogin) await sessionStore.delete(sessionId);
      const reason = error
        ? "provider_error"
        : !code
          ? "missing_code"
          : !state
            ? "missing_state"
            : !preLogin
              ? "missing_prelogin_session"
              : preLogin.oidcState !== state
                ? "state_mismatch"
                : "provider_mismatch";
      console.error(JSON.stringify({ event: "admin_oidc_callback_failed", reason }));
      await auditLoginFailure(reason);
      return oidcCallbackFailure(preLogin, reason);
    }
    let identity: AuthenticatedProviderResult;
    try {
      identity = await providerRegistry.get(callbackProvider)!.complete({
        code,
        state,
        codeVerifier: preLogin.codeVerifier!,
        nonce: preLogin.oidcNonce ?? null,
        authenticationEventId: generateRequestId(),
      });
    } catch (caught) {
      if (sessionId) await sessionStore.delete(sessionId);
      const reason = caught instanceof ProviderAdapterError
        ? caught.code
        : caught instanceof OidcError
          ? caught.code
          : "unexpected_provider_error";
      console.error(JSON.stringify({
        event: "admin_oidc_callback_failed",
        reason,
        ...(caught instanceof Error ? { message: caught.message } : {}),
      }));
      await auditLoginFailure(reason);
      return oidcCallbackFailure(preLogin, reason);
    }

    if (preLogin.identityMutationContinuation) {
      return completeIdentityMutation(request, sessionId!, preLogin, identity);
    }

    const invitationContinuation = preLogin.invitationContinuation;
    if (platformAccess === null
      && !invitationContinuation
      && !isEvidenceAllowed(identity.verifiedEmailEvidence)) {
      if (sessionId) await sessionStore.delete(sessionId);
      await auditLoginFailure("email-not-allowed");
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin/auth/login?error=not-allowed" },
      });
    }

    const loginPrincipal = {
      issuer: identity.issuer,
      subject: identity.subject,
    };
    const authenticatedAt = identity.authenticatedAt;
    const verifiedEmailEvidence = identity.verifiedEmailEvidence;
    const emailForDisplay = verifiedEmailEvidence[0]?.normalizedEmail ?? null;
    let invitationAccess: AdminSessionPayload["invitationAccess"];
    let accountResolution: AccountResolution | null = null;
    try {
      if (accountService) {
        const authorization = await authorizeAccountLogin(identity, invitationContinuation);
        if (authorization.mode === "email-challenge") {
          return await beginEmailChallenge(request, sessionId!, preLogin, identity, authorization);
        }
        accountResolution = authorization.account;
        invitationAccess = authorization.invitationAccess;
      } else if (platformAccess !== null) {
        if (invitationContinuation?.kind === "app") {
          const authorization = await platformAccess.authorizeAppInvitationLogin(
            loginPrincipal,
            verifiedEmailEvidence,
            invitationContinuation.token,
          );
          if (authorization.mode === "invitation") {
            invitationAccess = {
              kind: "app",
              invitationId: authorization.invitation.invitationId,
              appId: authorization.invitation.appId,
              tokenHash: authorization.invitation.tokenHash,
            };
          }
        } else if (invitationContinuation?.kind === "platform") {
          if (!platformInvitations) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
          const invitation = await platformInvitations.authorizeLogin(
            loginPrincipal,
            verifiedEmailEvidence,
            invitationContinuation.token,
          );
          invitationAccess = {
            kind: "platform",
            invitationId: invitation.invitationId,
            tokenHash: invitation.tokenHash,
          };
        } else {
          await platformAccess.requireAccess(loginPrincipal);
        }
      } else if (invitationContinuation) {
        throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
      }
    } catch (error) {
      if (error instanceof AccountServiceError || error instanceof EmailChallengeError
        || error instanceof PlatformAccessError && error.code === "PLATFORM_ACCESS_REQUIRED") {
        if (sessionId) await sessionStore.delete(sessionId);
        await auditLoginFailure("platform-access-denied");
        if (preLogin.cliClientId !== undefined && preLogin.cliRedirectUri && preLogin.cliState) {
          const redirect = new URL(preLogin.cliRedirectUri);
          redirect.searchParams.set("error", "access_denied");
          redirect.searchParams.set("error_description", "platform access denied");
          redirect.searchParams.set("state", preLogin.cliState);
          return new Response(null, {
            status: 302,
            headers: { Location: redirect.toString() },
          });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: "/admin/auth/login?error=access-denied" },
        });
      }
      throw error;
    }

    if (preLogin.cliClientId !== undefined) {
      // CLI login: hand the verified identity to the CLI as a short-lived
      // one-time code bound to its PKCE challenge; the browser is redirected
      // to the CLI's loopback with the code.
      const oneTimeCode = generateSessionId();
      const cliPayload: CliOneTimeCodePayload = {
        v: 1,
        kind: "cli-code",
        identityIssuer: identity.issuer,
        subject: identity.subject,
        displayName: identity.displayName,
        emailForDisplay,
        authProvider: identity.provider,
        authenticatedAt,
        verifiedEmailEvidence,
        accountId: accountResolution?.account.accountId,
        externalIdentityId: accountResolution?.authenticatedIdentity.externalIdentityId,
        credentialVersion: accountResolution?.account.credentialVersion,
        codeChallenge: preLogin.cliCodeChallenge!,
        cliState: preLogin.cliState!,
        cliRedirectUri: preLogin.cliRedirectUri!,
      };
      await persistSession(oneTimeCode, cliPayload, CLI_CODE_TTL_MS);
      if (sessionId) await sessionStore.delete(sessionId);
      const redirect = new URL(cliPayload.cliRedirectUri);
      redirect.searchParams.set("code", oneTimeCode);
      redirect.searchParams.set("state", cliPayload.cliState);
      return new Response(null, {
        status: 302,
        headers: { Location: redirect.toString() },
      });
    }

    // Session rotation on privilege change: new id + fresh CSRF token.
    const authenticatedPayload: AdminSessionPayload = {
      v: 1,
      authenticated: true,
      identityIssuer: identity.issuer,
      subject: identity.subject,
      displayName: identity.displayName,
      emailForDisplay,
      csrfToken: generateCsrfToken(),
      authProvider: identity.provider,
      authenticatedAt,
      verifiedEmailEvidence,
      accountId: accountResolution?.account.accountId,
      externalIdentityId: accountResolution?.authenticatedIdentity.externalIdentityId,
      credentialVersion: accountResolution?.account.credentialVersion,
      invitationAccess,
      admittedViaInvitation: invitationContinuation ? true : undefined,
    };
    return createAuthenticatedSession(
      request,
      authenticatedPayload,
      invitationContinuation
        ? invitationContinuation.kind === "app"
          ? `/admin/#/invitations/${encodeURIComponent(invitationContinuation.token)}`
          : `/admin/#/platform-invitations/${encodeURIComponent(invitationContinuation.token)}`
        : preLogin.returnTo ?? "/admin/",
      sessionId,
    );
  }

  async function authorizeAccountLogin(
    identity: AuthenticatedProviderResult,
    invitation: AdminSessionPayload["invitationContinuation"],
  ): Promise<
    | {
      readonly mode: "authorized";
      readonly account: AccountResolution;
      readonly invitationAccess?: AdminSessionPayload["invitationAccess"];
    }
    | {
      readonly mode: "email-challenge";
      readonly invitationKind: "app" | "platform";
      readonly invitationId: string;
      readonly invitationTokenHash: string;
      readonly email: string;
    }
  > {
    if (!accountService) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
    let account = await accountService.resolveExternalIdentity(identity.issuer, identity.subject);
    const admitted = account !== null
      && (account.platformAuthorities.length > 0 || account.hasAppMembership);
    if (!invitation) {
      if (!account || !admitted) throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
      return { mode: "authorized", account };
    }

    let invitationAccess: AdminSessionPayload["invitationAccess"];
    if (invitation.kind === "app") {
      if (!platformAccess) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
      const resolved = await platformAccess.resolveAppInvitation(invitation.token);
      if (resolved.invitationId !== invitation.invitationId || resolved.appId !== invitation.appId) {
        throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
      }
      if (resolved.emailConstraint !== null) {
        try {
          requireInvitationEmailEvidence(identity.verifiedEmailEvidence, resolved.emailConstraint, now());
        } catch {
          if (identity.provider === "microsoft") {
            return {
              mode: "email-challenge",
              invitationKind: "app",
              invitationId: resolved.invitationId,
              invitationTokenHash: resolved.tokenHash,
              email: resolved.emailConstraint,
            };
          }
          throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
        }
      }
      invitationAccess = {
        kind: "app",
        invitationId: resolved.invitationId,
        appId: resolved.appId,
        tokenHash: resolved.tokenHash,
      };
    } else {
      if (!platformInvitations) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
      const resolved = await platformInvitations.resolve(invitation.token);
      if (resolved.invitationId !== invitation.invitationId) {
        throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
      }
      try {
        requireInvitationEmailEvidence(identity.verifiedEmailEvidence, resolved.emailConstraint, now());
      } catch {
        if (identity.provider === "microsoft") {
          return {
            mode: "email-challenge",
            invitationKind: "platform",
            invitationId: resolved.invitationId,
            invitationTokenHash: resolved.tokenHash,
            email: resolved.emailConstraint,
          };
        }
        throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
      }
      invitationAccess = {
        kind: "platform",
        invitationId: resolved.invitationId,
        tokenHash: resolved.tokenHash,
      };
    }

    account ??= await accountService.createForExternalIdentity({
      provider: identity.provider,
      issuer: identity.issuer,
      subject: identity.subject,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    });
    return { mode: "authorized", account, invitationAccess };
  }

  function oidcCallbackFailure(
    preLogin: AdminSessionPayload | null,
    reason: string,
  ): Response {
    if (preLogin?.cliRedirectUri && preLogin.cliState) {
      const redirect = new URL(preLogin.cliRedirectUri);
      redirect.searchParams.set("error", "oidc_failed");
      redirect.searchParams.set("error_description", `Google sign-in failed (${reason})`);
      redirect.searchParams.set("state", preLogin.cliState);
      return new Response(null, {
        status: 302,
        headers: { Location: redirect.href, "Cache-Control": "no-store" },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/auth/login?error=oidc-failed", "Cache-Control": "no-store" },
    });
  }

  async function createAuthenticatedSession(
    request: Request,
    authenticatedPayload: AdminSessionPayload,
    target: string,
    previousSessionId: string | null,
  ): Promise<Response> {
    const authenticatedId = await persistAuthenticatedSession(request, authenticatedPayload, previousSessionId);
    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        "Set-Cookie": sessionCookieHeader(cookieOptions, authenticatedId),
      },
    });
  }

  async function persistAuthenticatedSession(
    request: Request,
    authenticatedPayload: AdminSessionPayload,
    previousSessionId: string | null,
  ): Promise<string> {
    const authenticatedId = generateSessionId();
    await persistSession(authenticatedId, authenticatedPayload, sessionTtlMs);
    if (previousSessionId) await sessionStore.delete(previousSessionId);
    await controlPlane.recordSessionAudit(
      serviceContext(authenticatedPayload, request),
      "session.login",
      `${authenticatedPayload.identityIssuer}:${authenticatedPayload.subject}`,
      null,
    );
    return authenticatedId;
  }

  async function beginEmailChallenge(
    request: Request,
    previousSessionId: string,
    preLogin: AdminSessionPayload,
    identity: AuthenticatedProviderResult,
    required: {
      readonly invitationKind: "app" | "platform";
      readonly invitationId: string;
      readonly invitationTokenHash: string;
      readonly email: string;
    },
  ): Promise<Response> {
    if (!emailChallenges || !options.emailChallengeSender || !preLogin.invitationContinuation) {
      throw new PlatformAccessError("PLATFORM_ACCESS_REQUIRED", 403);
    }
    const challenge = await emailChallenges.create({
      invitationKind: required.invitationKind,
      invitationId: required.invitationId,
      invitationTokenHash: required.invitationTokenHash,
      issuer: identity.issuer,
      subject: identity.subject,
      authenticationEventId: identity.authenticationEventId,
      email: required.email,
    });
    const challengePayload: AdminSessionPayload = {
      v: 1,
      authenticated: false,
      identityIssuer: identity.issuer,
      subject: identity.subject,
      displayName: identity.displayName,
      emailForDisplay: null,
      csrfToken: generateCsrfToken(),
      authProvider: "microsoft",
      authenticatedAt: identity.authenticatedAt,
      invitationContinuation: preLogin.invitationContinuation,
      emailChallenge: {
        challengeId: challenge.challengeId,
        secret: challenge.secret,
        binding: challenge.binding,
        avatarUrl: identity.avatarUrl,
      },
    };
    const challengeSessionId = generateSessionId();
    try {
      await sessionStore.create(
        challengeSessionId,
        await sessionCrypto.encrypt(challengePayload),
        Math.min(sessionTtlMs, EMAIL_CHALLENGE_TTL_MS),
      );
      await sessionStore.delete(previousSessionId);
      await options.emailChallengeSender.send({
        to: challenge.binding.normalizedEmail,
        code: challenge.code,
        expiresAt: challenge.expiresAt,
      });
    } catch {
      await emailChallenges.invalidate(challenge);
      await Promise.allSettled([
        sessionStore.delete(challengeSessionId),
        sessionStore.delete(previousSessionId),
      ]);
      console.error(JSON.stringify({ event: "admin_email_challenge_delivery_failed" }));
      throw new EmailChallengeError();
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/admin/auth/email-challenge",
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookieHeader(cookieOptions, challengeSessionId),
      },
    });
  }

  async function handleEmailChallengePage(request: Request): Promise<Response> {
    const pending = await readEmailChallengeSession(request);
    if (!pending) return emailChallengePageFailure();
    try {
      const description = await emailChallenges!.describe(
        pending.payload.emailChallenge!.challengeId,
        pending.payload.emailChallenge!.binding,
      );
      return new Response(emailChallengePage(description.maskedEmail, pending.payload.csrfToken), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch {
      await sessionStore.delete(pending.sessionId);
      return emailChallengePageFailure();
    }
  }

  async function handleEmailChallengeVerification(request: Request): Promise<Response> {
    const pending = await readEmailChallengeSession(request);
    if (!pending || !(await passCsrf(request, pending.payload))) return emailChallengeFailure();
    const body = await readJsonBody<{ code?: unknown }>(request);
    if (typeof body?.code !== "string") return emailChallengeFailure();
    try {
      const challenge = pending.payload.emailChallenge!;
      const evidence = await emailChallenges!.verify({
        challengeId: challenge.challengeId,
        binding: challenge.binding,
        secret: challenge.secret,
        code: body.code,
      });
      const identity: AuthenticatedProviderResult = {
        provider: "microsoft",
        issuer: pending.payload.identityIssuer,
        subject: pending.payload.subject,
        displayName: pending.payload.displayName,
        avatarUrl: challenge.avatarUrl,
        accountHint: null,
        verifiedEmailEvidence: [evidence],
        authenticatedAt: pending.payload.authenticatedAt!,
        authenticationEventId: challenge.binding.authenticationEventId,
      };
      const authorization = await authorizeAccountLogin(identity, pending.payload.invitationContinuation);
      if (authorization.mode !== "authorized") throw new EmailChallengeError();
      const next = invitationTarget(pending.payload.invitationContinuation!);
      const authenticatedPayload: AdminSessionPayload = {
        v: 1,
        authenticated: true,
        identityIssuer: identity.issuer,
        subject: identity.subject,
        displayName: identity.displayName,
        emailForDisplay: evidence.normalizedEmail,
        csrfToken: generateCsrfToken(),
        authProvider: identity.provider,
        authenticatedAt: identity.authenticatedAt,
        verifiedEmailEvidence: [evidence],
        accountId: authorization.account.account.accountId,
        externalIdentityId: authorization.account.authenticatedIdentity.externalIdentityId,
        credentialVersion: authorization.account.account.credentialVersion,
        invitationAccess: authorization.invitationAccess,
        admittedViaInvitation: true,
      };
      const authenticatedId = await persistAuthenticatedSession(request, authenticatedPayload, pending.sessionId);
      const response = json({ next }, 200);
      response.headers.set("Set-Cookie", sessionCookieHeader(cookieOptions, authenticatedId));
      response.headers.set("X-CSRF-Token", authenticatedPayload.csrfToken);
      return response;
    } catch (error) {
      if (error instanceof EmailChallengeError || error instanceof AccountServiceError
        || error instanceof PlatformAccessError) {
        return emailChallengeFailure();
      }
      throw error;
    }
  }

  async function handleEmailChallengeResend(request: Request): Promise<Response> {
    const pending = await readEmailChallengeSession(request);
    if (!pending || !(await passCsrf(request, pending.payload))) return emailChallengeFailure();
    try {
      const current = pending.payload.emailChallenge!;
      const resent = await emailChallenges!.resend({
        challengeId: current.challengeId,
        binding: current.binding,
      });
      const nextPayload: AdminSessionPayload = {
        ...pending.payload,
        emailChallenge: { ...current, secret: resent.secret },
      };
      const nextSessionId = generateSessionId();
      try {
        await sessionStore.create(
          nextSessionId,
          await sessionCrypto.encrypt(nextPayload),
          Math.min(sessionTtlMs, Math.max(1, resent.expiresAt - now())),
        );
        await sessionStore.delete(pending.sessionId);
        await options.emailChallengeSender!.send({
          to: resent.binding.normalizedEmail,
          code: resent.code,
          expiresAt: resent.expiresAt,
        });
      } catch {
        await emailChallenges!.invalidate(resent);
        await Promise.allSettled([
          sessionStore.delete(nextSessionId),
          sessionStore.delete(pending.sessionId),
        ]);
        console.error(JSON.stringify({ event: "admin_email_challenge_delivery_failed" }));
        const response = emailChallengeFailure();
        response.headers.set("Set-Cookie", clearSessionCookie(cookieOptions));
        return response;
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookieHeader(cookieOptions, nextSessionId),
        },
      });
    } catch (error) {
      if (error instanceof EmailChallengeError) {
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
  }

  async function readEmailChallengeSession(request: Request): Promise<{
    readonly sessionId: string;
    readonly payload: AdminSessionPayload;
  } | null> {
    if (!emailChallenges || !options.emailChallengeSender) return null;
    const sessionId = readSessionId(request);
    if (!sessionId) return null;
    const payload = await readSession(sessionId);
    if (!payload || payload.authenticated || payload.authProvider !== "microsoft"
      || !payload.emailChallenge || !payload.invitationContinuation) return null;
    return { sessionId, payload };
  }

  function emailChallengePage(maskedEmail: string, csrfToken: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verify email - UniCAS</title>
  <link rel="stylesheet" href="/admin/assets/index.css?v=${ADMIN_ASSET_CACHE_BUSTER}" />
</head>
<body>
  <main class="login-shell">
    <section class="login-panel">
      <p class="login-eyebrow">Invitation verification</p>
      <h1>Check your email</h1>
      <p class="login-copy">Enter the six-digit code sent to <strong>${escapeHtml(maskedEmail)}</strong>.</p>
      <form id="email-challenge-form" class="login-actions">
        <label for="email-challenge-code">Verification code</label>
        <input id="email-challenge-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
        <button class="btn btn-primary" type="submit">Verify</button>
        <button class="btn" id="email-challenge-resend" type="button">Send another code</button>
      </form>
      <p id="email-challenge-status" class="state" role="status" aria-live="polite"></p>
    </section>
  </main>
  <script>
    const csrf = ${JSON.stringify(csrfToken)};
    const status = document.getElementById("email-challenge-status");
    document.getElementById("email-challenge-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = document.getElementById("email-challenge-code").value;
      const response = await fetch("/admin/auth/email-challenge/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        const result = await response.json();
        window.location.assign(result.next);
        return;
      }
      status.textContent = "The code could not be verified. Check it and try again.";
    });
    document.getElementById("email-challenge-resend").addEventListener("click", async () => {
      await fetch("/admin/auth/email-challenge/resend", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
      });
      status.textContent = "If delivery is available, a new code is on its way.";
    });
  </script>
</body>
</html>`;
  }

  function emailChallengePageFailure(): Response {
    return new Response("Email verification could not be completed.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  function emailChallengeFailure(): Response {
    return json({ error: "EMAIL_CHALLENGE_FAILED", message: "email verification failed" }, 400);
  }

  function invitationTarget(invitation: NonNullable<AdminSessionPayload["invitationContinuation"]>): string {
    return invitation.kind === "app"
      ? `/admin/#/invitations/${encodeURIComponent(invitation.token)}`
      : `/admin/#/platform-invitations/${encodeURIComponent(invitation.token)}`;
  }

  async function handleLogout(request: Request): Promise<Response> {
    const sessionId = readSessionId(request);
    if (sessionId) {
      const payload = await readSession(sessionId);
      if (payload) {
        await controlPlane.recordSessionAudit(
          serviceContext(payload, request),
          "session.logout",
          `${payload.identityIssuer}:${payload.subject}`,
          null,
        );
      }
      await sessionStore.delete(sessionId);
    }
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearSessionCookie(cookieOptions) },
    });
  }

  async function handleInvitationPage(request: Request, token: string): Promise<Response> {
    if (platformAccess === null) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "platform access service is not configured");
    }
    let invitation;
    try {
      invitation = await platformAccess.resolveAppInvitation(token);
    } catch (error) {
      if (error instanceof PlatformAccessError) {
        return adminErrorResponse(error.code as CasAdminErrorResponse["error"], "invitation is not available");
      }
      throw error;
    }
    const sessionId = readSessionId(request);
    const payload = sessionId ? await readSession(sessionId) : null;
    if (payload?.authenticated) {
      if (payload.invitationAccess?.tokenHash === invitation.tokenHash) {
        return new Response(null, {
          status: 302,
          headers: { Location: `/admin/#/invitations/${encodeURIComponent(token)}` },
        });
      }
      try {
        await platformAccess.requireAccess({ issuer: payload.identityIssuer, subject: payload.subject });
        return new Response(null, {
          status: 302,
          headers: { Location: `/admin/#/invitations/${encodeURIComponent(token)}` },
        });
      } catch (error) {
        if (!(error instanceof PlatformAccessError) || error.code !== "PLATFORM_ACCESS_REQUIRED") throw error;
        if (sessionId) await sessionStore.delete(sessionId);
      }
    }
    const provider = invitationProvider(request);
    if (provider instanceof Response) return provider;
    if (provider === null) {
      return providerSelectionPage(request, "Choose a login method to accept this App invitation.");
    }
    return startProviderLogin(provider, undefined, {
      kind: "app",
      invitationId: invitation.invitationId,
      appId: invitation.appId,
      tokenHash: invitation.tokenHash,
      token,
    });
  }

  async function handlePlatformInvitationPage(request: Request, token: string): Promise<Response> {
    if (!platformInvitations) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "platform invitation service is not configured");
    }
    let invitation;
    try {
      invitation = await platformInvitations.resolve(token);
    } catch (error) {
      if (error instanceof PlatformAccessError) {
        return adminErrorResponse(error.code as CasAdminErrorResponse["error"], "invitation is not available");
      }
      throw error;
    }
    const sessionId = readSessionId(request);
    const payload = sessionId ? await readSession(sessionId) : null;
    if (payload?.invitationAccess?.kind === "platform"
      && payload.invitationAccess.tokenHash === invitation.tokenHash) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/admin/#/platform-invitations/${encodeURIComponent(token)}` },
      });
    }
    if (sessionId) await sessionStore.delete(sessionId);
    const provider = invitationProvider(request);
    if (provider instanceof Response) return provider;
    if (provider === null) {
      return providerSelectionPage(request, "Choose a login method to accept this platform invitation.");
    }
    return startProviderLogin(provider, undefined, {
      kind: "platform",
      invitationId: invitation.invitationId,
      tokenHash: invitation.tokenHash,
      token,
    });
  }

  async function handleShell(request: Request): Promise<Response> {
    const sessionId = readSessionId(request);
    const payload = sessionId ? await readSession(sessionId) : null;
    if (!payload || !payload.authenticated) {
      const loginUrl = new URL("/admin/auth/login", request.url);
      loginUrl.searchParams.set("returnTo", "/admin/");
      return new Response(null, {
        status: 302,
        headers: { Location: `${loginUrl.pathname}${loginUrl.search}` },
      });
    }
    await sessionStore.touch(sessionId!, sessionTtlMs);
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-csrf-token" content="${payload.csrfToken}" />
  <title>CAS Admin</title>
  <link rel="stylesheet" href="/admin/assets/index.css?v=${ADMIN_ASSET_CACHE_BUSTER}" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/admin/assets/index.js?v=${ADMIN_ASSET_CACHE_BUSTER}"></script>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  function invitationProvider(request: Request): ProviderKind | null | Response {
    const configured = providerRegistry.list();
    const requested = new URL(request.url).searchParams.get("provider");
    if (requested !== null) {
      const provider = parseProviderKind(requested);
      return provider && providerRegistry.get(provider)
        ? provider
        : new Response("Not Found", { status: 404 });
    }
    return configured.length === 1 ? configured[0]!.kind : null;
  }

  function providerSelectionPage(request: Request, copy: string): Response {
    const url = new URL(request.url);
    const buttons = providerRegistry.list().map(provider => {
      const target = new URL(url);
      target.search = "";
      target.searchParams.set("provider", provider.kind);
      return `<a class="btn" href="${target.pathname}${target.search}">Continue with ${escapeHtml(provider.displayName)}</a>`;
    }).join("\n          ");
    return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Choose login - UniCAS</title>
  <link rel="stylesheet" href="/admin/assets/index.css?v=${ADMIN_ASSET_CACHE_BUSTER}" />
</head>
<body>
  <main class="login-shell">
    <section class="login-panel">
      <h1>Continue to UniCAS</h1>
      <p class="login-copy">${escapeHtml(copy)}</p>
      <div class="login-actions">${buttons}</div>
    </section>
  </main>
</body>
</html>`, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // ------------------------------------------------------------------
  // Frozen admin API
  // ------------------------------------------------------------------

  async function handleCliAuthorize(url: URL): Promise<Response> {
    const clientId = url.searchParams.get("client_id");
    const state = url.searchParams.get("state");
    const cliCodeChallenge = url.searchParams.get("code_challenge");
    const codeChallengeMethod = url.searchParams.get("code_challenge_method");
    const redirectUri = url.searchParams.get("redirect_uri");
    if (clientId !== CLI_CLIENT_ID) {
      return new Response("Unauthorized client", { status: 400 });
    }
    if (!state || !cliCodeChallenge || codeChallengeMethod !== "S256" || !isLoopbackRedirect(redirectUri)) {
      return new Response("Invalid CLI authorization request", { status: 400 });
    }
    const provider = parseProviderKind(url.searchParams.get("provider") ?? "google");
    if (!provider || !providerRegistry.get(provider)) {
      return new Response("Unsupported or disabled login provider", { status: 400 });
    }
    return startProviderLogin(provider, undefined, undefined, {
      clientId,
      state,
      codeChallenge: cliCodeChallenge,
      redirectUri,
    });
  }

  async function handleLinkStart(request: Request, targetProvider: ProviderKind): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!(await passCsrf(request, auth.payload))) return csrfRejected();
    if (!accountService || !auth.payload.accountId || !auth.payload.externalIdentityId
      || auth.payload.credentialVersion === undefined || !auth.payload.authProvider
      || !providerRegistry.get(targetProvider)) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Account linking is unavailable");
    }
    const response = await startProviderLogin(
      auth.payload.authProvider,
      "/admin/#/account",
      undefined,
      undefined,
      {
        kind: "link-current",
        accountId: auth.payload.accountId,
        expectedCredentialVersion: auth.payload.credentialVersion,
        targetProvider,
        currentExternalIdentityId: auth.payload.externalIdentityId,
        currentIssuer: auth.payload.identityIssuer,
        currentSubject: auth.payload.subject,
        currentProvider: auth.payload.authProvider,
        currentDisplayName: auth.payload.displayName,
        currentEmailForDisplay: auth.payload.emailForDisplay,
      },
    );
    await sessionStore.delete(auth.sessionId);
    return identityMutationStartResponse(request, response);
  }

  async function handleUnlinkStart(request: Request, targetExternalIdentityId: string): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!(await passCsrf(request, auth.payload))) return csrfRejected();
    if (!accountService || !auth.payload.accountId || auth.payload.credentialVersion === undefined) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Account unlinking is unavailable");
    }
    const body = await readJsonBody<{ remainingExternalIdentityId?: unknown }>(request);
    if (!body || typeof body.remainingExternalIdentityId !== "string") {
      return invalidRequest("remainingExternalIdentityId is required");
    }
    let remaining;
    try {
      remaining = await accountService.requireActiveIdentity(
        auth.payload.accountId,
        body.remainingExternalIdentityId,
      );
    } catch (error) {
      if (error instanceof AccountServiceError) {
        return json({ error: error.code }, error.code === "IDENTITY_ACCOUNT_MISMATCH" ? 409 : 404);
      }
      throw error;
    }
    if (!providerRegistry.get(remaining.provider)) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Remaining login provider is unavailable");
    }
    const response = await startProviderLogin(
      remaining.provider,
      "/admin/#/account",
      undefined,
      undefined,
      {
        kind: "unlink",
        accountId: auth.payload.accountId,
        expectedCredentialVersion: auth.payload.credentialVersion,
        targetExternalIdentityId,
        remainingExternalIdentityId: remaining.externalIdentityId,
        remainingIssuer: remaining.issuer,
        remainingSubject: remaining.subject,
        remainingProvider: remaining.provider,
      },
    );
    await sessionStore.delete(auth.sessionId);
    return identityMutationStartResponse(request, response);
  }

  async function completeIdentityMutation(
    request: Request,
    sessionId: string,
    preLogin: AdminSessionPayload,
    identity: AuthenticatedProviderResult,
  ): Promise<Response> {
    if (!accountService || !preLogin.identityMutationContinuation) {
      await sessionStore.delete(sessionId);
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE);
    }
    const mutation = preLogin.identityMutationContinuation;
    try {
      if (mutation.kind === "link-current") {
        if (identity.issuer !== mutation.currentIssuer || identity.subject !== mutation.currentSubject) {
          throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
        }
        const response = await startProviderLogin(
          mutation.targetProvider,
          "/admin/#/account",
          undefined,
          undefined,
          {
            ...mutation,
            kind: "link-target",
            currentAuthenticatedAt: identity.authenticatedAt,
            currentVerifiedEmailEvidence: identity.verifiedEmailEvidence,
          },
        );
        await sessionStore.delete(sessionId);
        return response;
      }

      if (mutation.kind === "link-target") {
        if (identity.provider !== mutation.targetProvider) {
          throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
        }
        const resolution = await accountService.linkExternalIdentity({
          accountId: mutation.accountId,
          currentExternalIdentityId: mutation.currentExternalIdentityId,
          credentialVersion: mutation.expectedCredentialVersion,
          currentAuthenticatedAt: mutation.currentAuthenticatedAt,
          target: identity,
        });
        return createAuthenticatedSession(request, {
          v: 1,
          authenticated: true,
          identityIssuer: mutation.currentIssuer,
          subject: mutation.currentSubject,
          displayName: mutation.currentDisplayName,
          emailForDisplay: mutation.currentEmailForDisplay,
          csrfToken: generateCsrfToken(),
          authProvider: mutation.currentProvider,
          authenticatedAt: mutation.currentAuthenticatedAt,
          verifiedEmailEvidence: mutation.currentVerifiedEmailEvidence,
          accountId: resolution.account.accountId,
          externalIdentityId: mutation.currentExternalIdentityId,
          credentialVersion: resolution.account.credentialVersion,
        }, "/admin/#/account", sessionId);
      }

      if (identity.issuer !== mutation.remainingIssuer || identity.subject !== mutation.remainingSubject) {
        throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
      }
      const resolution = await accountService.unlinkExternalIdentity({
        accountId: mutation.accountId,
        credentialVersion: mutation.expectedCredentialVersion,
        targetExternalIdentityId: mutation.targetExternalIdentityId,
        remainingExternalIdentityId: mutation.remainingExternalIdentityId,
        remainingAuthenticatedAt: identity.authenticatedAt,
      });
      return createAuthenticatedSession(request, {
        v: 1,
        authenticated: true,
        identityIssuer: identity.issuer,
        subject: identity.subject,
        displayName: identity.displayName,
        emailForDisplay: identity.verifiedEmailEvidence[0]?.normalizedEmail ?? null,
        csrfToken: generateCsrfToken(),
        authProvider: identity.provider,
        authenticatedAt: identity.authenticatedAt,
        verifiedEmailEvidence: identity.verifiedEmailEvidence,
        accountId: resolution.account.accountId,
        externalIdentityId: mutation.remainingExternalIdentityId,
        credentialVersion: resolution.account.credentialVersion,
      }, "/admin/#/account", sessionId);
    } catch (error) {
      await sessionStore.delete(sessionId);
      if (error instanceof AccountServiceError) {
        const code = error.code === "IDENTITY_LINK_CONFLICT"
          ? "link-conflict"
          : error.code === "FINAL_IDENTITY_CANNOT_BE_UNLINKED"
            ? "final-identity"
            : "authentication-state-changed";
        return new Response(null, {
          status: 302,
          headers: { Location: `/admin/#/account?identityError=${code}` },
        });
      }
      throw error;
    }
  }

  async function handleCliExchange(request: Request): Promise<Response> {
    const body = await readJsonBody<{ code?: unknown; codeVerifier?: unknown }>(request);
    if (!body || typeof body.code !== "string" || typeof body.codeVerifier !== "string") {
      return json({ error: "INVALID_REQUEST", message: "code and codeVerifier are required" }, 400);
    }
    const stored = await sessionStore.read(body.code);
    if (stored === null) {
      return json({ error: "ADMIN_AUTH_REQUIRED", message: "invalid or expired authorization code" }, 401);
    }
    let payload: CliOneTimeCodePayload;
    try {
      const decrypted = await sessionCrypto.decrypt(stored.encryptedPayload) as AdminSessionPayload | CliOneTimeCodePayload;
      if (!("kind" in decrypted) || decrypted.kind !== "cli-code") {
        return json({ error: "ADMIN_AUTH_REQUIRED", message: "invalid authorization code" }, 401);
      }
      payload = decrypted as CliOneTimeCodePayload;
    } catch {
      return json({ error: "ADMIN_AUTH_REQUIRED", message: "invalid authorization code" }, 401);
    }
    const challenge = await s256Challenge(body.codeVerifier);
    if (challenge !== payload.codeChallenge) {
      await sessionStore.delete(body.code);
      return json({ error: "ADMIN_AUTH_REQUIRED", message: "PKCE code verifier mismatch" }, 401);
    }
    await sessionStore.delete(body.code);
    const authenticatedPayload: AdminSessionPayload = {
      v: 1,
      authenticated: true,
      identityIssuer: payload.identityIssuer,
      subject: payload.subject,
      displayName: payload.displayName,
      emailForDisplay: payload.emailForDisplay,
      csrfToken: generateCsrfToken(),
      authProvider: payload.authProvider,
      authenticatedAt: payload.authenticatedAt,
      verifiedEmailEvidence: payload.verifiedEmailEvidence,
      accountId: payload.accountId,
      externalIdentityId: payload.externalIdentityId,
      credentialVersion: payload.credentialVersion,
    };
    const sessionId = generateSessionId();
    await persistSession(sessionId, authenticatedPayload, sessionTtlMs);
    await controlPlane.recordSessionAudit(
      serviceContext(authenticatedPayload, request),
      "session.login",
      `${authenticatedPayload.identityIssuer}:${authenticatedPayload.subject}`,
      null,
    );
    return Response.json(
      {
        csrfToken: authenticatedPayload.csrfToken,
        identity: {
          identityIssuer: authenticatedPayload.identityIssuer,
          subject: authenticatedPayload.subject,
          displayName: authenticatedPayload.displayName,
          emailForDisplay: authenticatedPayload.emailForDisplay,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookieHeader(cookieOptions, sessionId),
        },
      },
    );
  }

  async function handleAppIssuerMutation(request: Request, appId: string, operation: "inspectOAuthIssuer" | "activateOAuthIssuer"): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!(await passCsrf(request, auth.payload))) return csrfRejected();
    const context = serviceContext(auth.payload, request);
    const body = await readJsonBody(request);
    if (operation === "inspectOAuthIssuer") {
      const parsed = InspectAppIssuerRequestSchema.safeParse(body);
      if (!parsed.success) return invalidRequest("A valid issuer URL is required");
      const result = await controlPlane.inspectAppOAuthIssuer(context, appId, parsed.data.issuer);
      return "error" in result ? json(transformAppAdminError({ ...result }), casAdminErrorHttpStatus[result.error]) : json(result, 201);
    }
    const parsed = ActivateAppIssuerRequestSchema.safeParse(body);
    if (!parsed.success) return invalidRequest("A candidate inspection and activation proof are required");
    const result = await controlPlane.activateAppOAuthIssuer(context, appId, parsed.data, {
      ifMatch: request.headers.get("If-Match") ?? undefined,
      ifNoneMatch: request.headers.get("If-None-Match") ?? undefined,
    });
    return "error" in result ? json(transformAppAdminError({ ...result }), casAdminErrorHttpStatus[result.error])
      : new Response(null, { status: 204, headers: { ETag: formatCasAdminETag(result.revision), "Cache-Control": REVISION_CACHE_CONTROL } });
  }

  async function handleAccountApi(
    request: Request,
    operation: "getAccount" | "listAccountIdentities" | "patchAccountProfile",
  ): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!accountService || !auth.payload.accountId || !auth.payload.externalIdentityId) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Account service is unavailable");
    }
    try {
      if (operation === "patchAccountProfile") {
        if (!(await passCsrf(request, auth.payload))) return csrfRejected();
        const parsed = PatchAccountProfileSchema.safeParse(await readJsonBody(request));
        if (!parsed.success) return invalidRequest("A valid Account profile patch is required");
        await accountService.updateProfile({
          accountId: auth.payload.accountId,
          ...parsed.data,
        });
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      const account = await accountService.getSelf(
        auth.payload.accountId,
        auth.payload.externalIdentityId,
        providerRegistry.list().map(provider => provider.kind),
      );
      return json(operation === "getAccount" ? account : { identities: account.identities }, 200);
    } catch (error) {
      if (error instanceof AccountServiceError) {
        const status = error.code === "ACCOUNT_BLOCKED" ? 403
          : error.code === "IDENTITY_NOT_FOUND" ? 404
            : 409;
        return json({ error: error.code }, status);
      }
      throw error;
    }
  }

  async function handleAccountAppMembers(
    request: Request,
    url: URL,
    appId: string,
    operation: "listMembers" | "deleteMember",
  ): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!accountService || !auth.payload.accountId || !auth.payload.externalIdentityId) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Account service is unavailable");
    }
    try {
      if (operation === "listMembers") {
        return json(await accountService.listAppMembers({
          actorAccountId: auth.payload.accountId,
          appId,
          ...pageQuery(queryFromUrl(url)),
        }), 200);
      }
      if (!(await passCsrf(request, auth.payload))) return csrfRejected();
      const accountId = AccountIdSchema.safeParse(url.searchParams.get("accountId"));
      if (!accountId.success) return invalidRequest("A valid accountId is required");
      await accountService.removeAppMember({
        actorAccountId: auth.payload.accountId,
        actorExternalIdentityId: auth.payload.externalIdentityId,
        appId,
        targetAccountId: accountId.data,
        requestId: request.headers.get("X-Request-Id") ?? undefined,
        traceId: request.headers.get("X-Trace-Id") ?? undefined,
        callerChannel: "admin-webui",
      });
      return json({ ok: true }, 200);
    } catch (error) {
      if (error instanceof AccountServiceError) {
        const status = error.code === "APP_MEMBERSHIP_REQUIRED" || error.code === "ACCOUNT_BLOCKED" ? 403
          : error.code === "INVALID_CURSOR" || error.code === "INVALID_REQUEST" ? 400
            : error.code === "LAST_MEMBER" ? 409
              : 404;
        return json({ error: error.code }, status);
      }
      throw error;
    }
  }

  async function handleAccountApps(
    request: Request,
    url: URL,
    operation: "listApps" | "createApp" | "getApp" | "patchApp",
    appId?: string,
  ): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!accountService || !auth.payload.accountId) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Account service is unavailable");
    }
    try {
      if (operation === "createApp") {
        if (!auth.payload.externalIdentityId) return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED);
        if (!(await passCsrf(request, auth.payload))) return csrfRejected();
        const body = await readJsonBody<{ displayName?: unknown }>(request);
        if (!body || typeof body.displayName !== "string") return invalidRequest("A valid displayName is required");
        const app = await accountService.createApp({
          actorAccountId: auth.payload.accountId,
          actorExternalIdentityId: auth.payload.externalIdentityId,
          displayName: body.displayName,
          idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
          requestId: request.headers.get("X-Request-Id") ?? undefined,
          traceId: request.headers.get("X-Trace-Id") ?? undefined,
          callerChannel: "admin-webui",
        });
        return Response.json({ appId: app.appId }, {
          status: 201,
          headers: { ETag: formatCasAdminETag(app.revision), "Cache-Control": REVISION_CACHE_CONTROL },
        });
      }
      if (operation === "getApp") {
        if (!appId) return json({ error: "Not Found" }, 404);
        const app = await accountService.getApp(auth.payload.accountId, appId);
        return Response.json(app, {
          status: 200,
          headers: { ETag: formatCasAdminETag(app.revision), "Cache-Control": REVISION_CACHE_CONTROL },
        });
      }
      if (operation === "patchApp") {
        if (!auth.payload.externalIdentityId) return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED);
        if (!(await passCsrf(request, auth.payload))) return csrfRejected();
        const parsed = PatchAppRequestSchema.safeParse(await readJsonBody(request));
        if (!parsed.success) return invalidRequest("A valid App patch is required");
        if (!appId) return json({ error: "Not Found" }, 404);
        const revision = await accountService.patchApp({
          actorAccountId: auth.payload.accountId,
          actorExternalIdentityId: auth.payload.externalIdentityId,
          appId,
          patch: parsed.data,
          ifMatch: request.headers.get("If-Match") ?? undefined,
          requestId: request.headers.get("X-Request-Id") ?? undefined,
          traceId: request.headers.get("X-Trace-Id") ?? undefined,
          callerChannel: "admin-webui",
        });
        return new Response(null, {
          status: 204,
          headers: { ETag: formatCasAdminETag(revision), "Cache-Control": REVISION_CACHE_CONTROL },
        });
      }
      return json(await accountService.listApps({
        actorAccountId: auth.payload.accountId,
        ...pageQuery(queryFromUrl(url)),
      }), 200);
    } catch (error) {
      if (error instanceof AccountServiceError) {
        const status = error.code === "ACCOUNT_BLOCKED" || error.code === "APP_CREATION_AUTHORITY_REQUIRED"
          || error.code === "APP_MEMBERSHIP_REQUIRED" ? 403
          : error.code === "INVALID_CURSOR" || error.code === "INVALID_REQUEST" ? 400
            : error.code === "PRECONDITION_REQUIRED" ? 428
              : error.code === "REVISION_MISMATCH" ? 412
            : error.code === "IDEMPOTENCY_CONFLICT" ? 409
              : 404;
        return json({ error: error.code }, status);
      }
      throw error;
    }
  }

  async function handleAccountAppAudit(request: Request, url: URL, appId: string): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!accountService || !auth.payload.accountId) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "Account service is unavailable");
    }
    try {
      return json(await accountService.listAppAuditEvents({
        actorAccountId: auth.payload.accountId,
        appId,
        query: queryFromUrl(url),
      }), 200);
    } catch (error) {
      if (error instanceof AccountServiceError) {
        const status = error.code === "APP_MEMBERSHIP_REQUIRED" || error.code === "ACCOUNT_BLOCKED" ? 403
          : error.code === "INVALID_CURSOR" || error.code === "INVALID_REQUEST" ? 400
            : 404;
        return json({ error: error.code }, status);
      }
      throw error;
    }
  }

  async function handlePeople(request: Request, appId?: string): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!options.peopleRepository) return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "people queries are unavailable");
    const actor = { issuer: auth.payload.identityIssuer, subject: auth.payload.subject };
    const service = new PeopleService(options.peopleRepository, async scope => {
      if ("appId" in scope) {
        if (!accountService || !auth.payload.accountId) {
          throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
        }
        try {
          await accountService.requireAppMembership(auth.payload.accountId, scope.appId);
        } catch (error) {
          if (error instanceof AccountServiceError) {
            throw new PlatformAccessError(error.code, error.code === "APP_MEMBERSHIP_REQUIRED" ? 403 : 503);
          }
          throw error;
        }
      } else {
        if (!platformAccess) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
        await platformAccess.requireAccess(actor, "platform.admin");
      }
    }, now);
    const params = queryFromUrl(new URL(request.url));
    try {
      return json(await service.list(appId === undefined ? { platform: true } : { appId }, {
        ...params, ...(params.limit === undefined ? {} : { limit: Number(params.limit) }),
      }), 200);
    } catch (error) {
      if (error instanceof PlatformAccessError) return json({ error: error.code }, error.status);
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }
  }

  async function handleAppInvitations(request: Request, appId: string, invitationId?: string): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    const context = serviceContext(auth.payload, request);
    if (invitationId !== undefined) {
      if (!(await passCsrf(request, auth.payload))) return csrfRejected();
      const result = await controlPlane.revokeAppMemberInvitation(context, appId, invitationId, {
        ifMatch: request.headers.get("If-Match") ?? undefined,
      });
      if ("error" in result) return json(transformAppAdminError({ ...result }), result.error === "INVITATION_NOT_PENDING" ? 409 : casAdminErrorHttpStatus[result.error]);
      return new Response(null, { status: 204, headers: { ETag: formatCasAdminETag(result.revision), "Cache-Control": REVISION_CACHE_CONTROL } });
    }
    const params = queryFromUrl(new URL(request.url));
    const parsed = AppInvitationQuerySchema.safeParse({ ...params, ...(params.limit === undefined ? {} : { limit: Number(params.limit) }) });
    if (!parsed.success) return invalidRequest("Invalid invitation filters or pagination");
    const result = await controlPlane.listAppMemberInvitations(context, appId, parsed.data);
    return "error" in result
      ? json(transformAppAdminError({ ...result }), casAdminErrorHttpStatus[result.error])
      : json(result, 200);
  }

  async function handleMemberInvitationAcceptance(request: Request, token: string): Promise<Response> {
    const sessionId = readSessionId(request);
    if (!sessionId) return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "login required");
    const payload = await readSession(sessionId);
    if (!payload || !payload.authenticated || payload.subject.length === 0) {
      return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "login required");
    }
    if (payload.invitationAccess?.kind === "platform") {
      return adminErrorResponse(
        CasAdminErrorCodes.INVITATION_SESSION_REQUIRED,
        "this session is bound to a platform invitation",
      );
    }
    if (payload.invitationAccess?.kind === "app") {
      const tokenHash = await sha256Hex(token);
      if (!(await secureEqual(tokenHash, payload.invitationAccess.tokenHash))) {
        return adminErrorResponse(
          CasAdminErrorCodes.INVITATION_SESSION_REQUIRED,
          "this session is bound to another invitation",
        );
      }
    } else {
      const auth = await requireAuthenticated(request);
      if (auth instanceof Response) return auth;
    }
    if (!(await passCsrf(request, payload))) return csrfRejected();

    const result = await controlPlane.acceptMemberInvitation(
      serviceContext(payload, request),
      { path: { token } },
    );
    if ("error" in result) return json(result, casAdminErrorHttpStatus[result.error]);

    const nextPayload: AdminSessionPayload = {
      v: 1,
      authenticated: true,
      identityIssuer: payload.identityIssuer,
      subject: payload.subject,
      displayName: payload.displayName,
      emailForDisplay: payload.emailForDisplay,
      csrfToken: generateCsrfToken(),
      authProvider: payload.authProvider,
      authenticatedAt: payload.authenticatedAt,
      accountId: payload.accountId,
      externalIdentityId: payload.externalIdentityId,
      credentialVersion: payload.credentialVersion,
      admittedViaInvitation: payload.admittedViaInvitation || payload.invitationAccess
        ? true
        : undefined,
    };
    const nextSessionId = generateSessionId();
    await persistSession(nextSessionId, nextPayload, sessionTtlMs);
    await sessionStore.delete(sessionId);
    const response = json(result, 200);
    response.headers.set("Set-Cookie", sessionCookieHeader(cookieOptions, nextSessionId));
    response.headers.set("X-CSRF-Token", nextPayload.csrfToken);
    return response;
  }

  async function handlePlatformInvitationAcceptance(request: Request, token: string): Promise<Response> {
    if (!platformInvitations) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "platform invitation service is not configured");
    }
    const sessionId = readSessionId(request);
    if (!sessionId) return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "login required");
    const payload = await readSession(sessionId);
    if (!payload?.authenticated || payload.invitationAccess?.kind !== "platform") {
      return adminErrorResponse(CasAdminErrorCodes.INVITATION_SESSION_REQUIRED, "matching platform invitation session required");
    }
    const tokenHash = await sha256Hex(token);
    if (!(await secureEqual(tokenHash, payload.invitationAccess.tokenHash))) {
      return adminErrorResponse(CasAdminErrorCodes.INVITATION_SESSION_REQUIRED, "this session is bound to another invitation");
    }
    if (!(await passCsrf(request, payload))) return csrfRejected();
    try {
      await platformInvitations.accept(
        { issuer: payload.identityIssuer, subject: payload.subject },
        { displayName: payload.displayName, emailForDisplay: payload.emailForDisplay },
        payload.verifiedEmailEvidence ?? [],
        token,
        request.headers.get("X-Request-Id"),
      );
    } catch (error) {
      if (error instanceof PlatformAccessError) {
        return adminErrorResponse(error.code as CasAdminErrorResponse["error"]);
      }
      throw error;
    }
    const nextPayload: AdminSessionPayload = {
      v: 1,
      authenticated: true,
      identityIssuer: payload.identityIssuer,
      subject: payload.subject,
      displayName: payload.displayName,
      emailForDisplay: payload.emailForDisplay,
      csrfToken: generateCsrfToken(),
      authProvider: payload.authProvider,
      authenticatedAt: payload.authenticatedAt,
      accountId: payload.accountId,
      externalIdentityId: payload.externalIdentityId,
      credentialVersion: payload.credentialVersion,
      admittedViaInvitation: true,
    };
    const nextSessionId = generateSessionId();
    await persistSession(nextSessionId, nextPayload, sessionTtlMs);
    await sessionStore.delete(sessionId);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookieHeader(cookieOptions, nextSessionId),
        "X-CSRF-Token": nextPayload.csrfToken,
      },
    });
  }

  async function handleAdminApi(
    request: Request,
    url: URL,
    route: CasAdminRoute,
  ): Promise<Response> {
    if (route.operation === "acceptMemberInvitation") {
      return handleMemberInvitationAcceptance(request, route.token);
    }
    if (route.operation === "acceptPlatformInvitation") {
      return handlePlatformInvitationAcceptance(request, route.token);
    }
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (isMutating(request.method) && !(await passCsrf(request, auth.payload))) {
      return csrfRejected();
    }
    const ctx = serviceContext(auth.payload, request);
    const query = queryFromUrl(url);
    const mutation = {
      ifMatch: request.headers.get("If-Match") ?? undefined,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
    };

    switch (route.operation) {
      case "me": {
        if (!accountService || !auth.payload.accountId || !auth.payload.externalIdentityId) {
          return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "Account login required");
        }
        const account = await accountService.getSelf(
          auth.payload.accountId, auth.payload.externalIdentityId,
          providerRegistry.list().map(provider => provider.kind),
        );
        const authenticatedIdentity = account.identities.find(identity => identity.currentLogin);
        if (!authenticatedIdentity) return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "Account login required");
        const response = json({
          account,
          authenticatedIdentity,
          memberships: await accountService.listAccountMemberships(auth.payload.accountId),
        }, 200);
        response.headers.set("X-CSRF-Token", auth.payload.csrfToken);
        return response;
      }
      case "listStacks": {
        const result = await controlPlane.listStacks(ctx, { query: pageQuery(query) });
        return json(result, "error" in result ? casAdminErrorHttpStatus[result.error] : 200);
      }
      case "createStack": {
        if (platformAccess !== null) {
          try {
            await platformAccess.requireAccess(
              { issuer: auth.payload.identityIssuer, subject: auth.payload.subject },
              "apps.create",
            );
          } catch (error) {
            if (error instanceof PlatformAccessError) {
              return adminErrorResponse(error.code as CasAdminErrorResponse["error"]);
            }
            throw error;
          }
        }
        const body = await readJsonBody<{ displayName?: unknown }>(request);
        if (!body) return invalidRequest("JSON body is required");
        const result = await controlPlane.createStack(ctx, { body: { displayName: String(body.displayName ?? "") } }, mutation);
        return jsonWithEtag(result);
      }
      case "getStack": {
        const result = await controlPlane.getStack(ctx, { path: { stackId: route.stackId } });
        return jsonWithEtag(result);
      }
      case "patchStack": {
        const body = await readJsonBody<{ displayName?: unknown; description?: unknown }>(request);
        if (!body) return invalidRequest("JSON body is required");
        const result = await controlPlane.patchStack(ctx, {
          path: { stackId: route.stackId },
          body: {
            displayName: body.displayName === undefined ? undefined : String(body.displayName),
            description: body.description === undefined ? undefined : String(body.description),
          },
        }, mutation);
        return jsonWithEtag(result);
      }
      case "listMembers": {
        const result = await controlPlane.listMembers(ctx, { path: { stackId: route.stackId }, query: pageQuery(query) });
        return json(result, "error" in result ? casAdminErrorHttpStatus[result.error] : 200);
      }
      case "deleteMember": {
        const result = await controlPlane.deleteMember(ctx, {
          path: { stackId: route.stackId },
          query: {
            identityIssuer: query.identityIssuer ?? "",
            subject: query.subject ?? "",
          },
        }, mutation);
        return json(result, "error" in result ? casAdminErrorHttpStatus[result.error] : 200);
      }
      case "createMemberInvitation": {
        const body = await readJsonBody<{ emailConstraint?: unknown }>(request);
        const result = await controlPlane.createMemberInvitation(ctx, {
          path: { stackId: route.stackId },
          body: body === null || body.emailConstraint === undefined
            ? undefined
            : { emailConstraint: String(body.emailConstraint) },
        }, mutation);
        if ("error" in result) return json(result, casAdminErrorHttpStatus[result.error]);
        return json({ ...result, acceptUrl: absolutize(result.acceptUrl) }, 200);
      }
      case "getOAuthIssuer": {
        if (query.optional !== undefined && query.optional !== "true" && query.optional !== "false") {
          return invalidRequest("optional must be true or false");
        }
        const result = await controlPlane.getOAuthIssuer(ctx, {
          path: { stackId: route.stackId },
          query: { optional: query.optional === "true" },
        });
        if (result === null) return json(null, 200);
        return jsonWithEtag(result);
      }
      case "getManagedIssuer": {
        const result = await controlPlane.getManagedOAuthIssuer(ctx, { path: { stackId: route.stackId } });
        return jsonWithEtag(result);
      }
      case "patchManagedIssuer": {
        const body = await readJsonBody<{ enabled?: unknown }>(request);
        if (!body || typeof body.enabled !== "boolean") return invalidRequest("enabled must be a boolean");
        const result = await controlPlane.patchManagedOAuthIssuer(ctx, {
          path: { stackId: route.stackId },
          body: { enabled: body.enabled },
        }, mutation);
        return jsonWithEtag(result);
      }
      case "mintManagedCapability": {
        const result = await controlPlane.mintManagedCapability(ctx, { path: { stackId: route.stackId } });
        const response = json(result, "error" in result ? casAdminErrorHttpStatus[result.error] : 200);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
      case "inspectOAuthIssuer": {
        const body = await readJsonBody<{ issuer?: unknown }>(request);
        if (!body || Array.isArray(body)) return invalidRequest("JSON object body is required");
        if (Object.keys(body).some((key) => key !== "issuer")) {
          return invalidRequest("OAuth issuer inspection accepts only issuer");
        }
        if (typeof body.issuer !== "string") return invalidRequest("issuer must be a string");
        const result = await controlPlane.inspectOAuthIssuer(ctx, {
          path: { stackId: route.stackId },
          body: { issuer: body.issuer },
        });
        return jsonWithEtag(result);
      }
      case "activateOAuthIssuer": {
        const body = await readJsonBody<{ inspectionId?: unknown; activationProof?: unknown }>(request);
        if (!body) return invalidRequest("JSON body is required");
        const result = await controlPlane.activateOAuthIssuer(ctx, {
          path: { stackId: route.stackId },
          body: {
            inspectionId: String(body.inspectionId ?? ""),
            activationProof: String(body.activationProof ?? ""),
          },
        }, mutation);
        return jsonWithEtag(result);
      }
      case "listControlAuditEvents": {
        const result = await controlPlane.listControlAuditEvents(ctx, {
          path: { stackId: route.stackId },
          query: pageQuery(query),
        });
        return json(result, "error" in result ? casAdminErrorHttpStatus[result.error] : 200);
      }
      case "listRefDomains":
      case "listRootDomainRefs":
      case "listRootDomainEvents": {
        return handleAuditRead(request, route, ctx, query);
      }
      default:
        return json({ error: "Not Found" }, 404);
    }
  }

  async function handleManagedSpaceCapability(request: Request, appId: string): Promise<Response> {
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (!(await passCsrf(request, auth.payload))) return csrfRejected();
    const result = await controlPlane.mintManagedSpaceCapability(
      serviceContext(auth.payload, request),
      appId,
    );
    const response = "error" in result
      ? json(transformAppAdminError({ ...result }), result.error === "APP_SUSPENDED" ? 403 : casAdminErrorHttpStatus[result.error])
      : json(result, 201);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  // ------------------------------------------------------------------
  // Platform Admin API
  // ------------------------------------------------------------------

  async function handlePlatformAdminApi(
    request: Request,
    url: URL,
    route: AppAdminRoute,
  ): Promise<Response> {
    if (platformAccess === null) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "platform access service is not configured");
    }
    const auth = await requireAuthenticated(request);
    if (auth instanceof Response) return auth;
    if (isMutating(request.method) && !(await passCsrf(request, auth.payload))) return csrfRejected();

    const actor = { issuer: auth.payload.identityIssuer, subject: auth.payload.subject };

    try {
      switch (route.operation) {
        case "listPlatformAccounts": {
          if (!accountService || !auth.payload.accountId) throw new Error("Account service unavailable");
          return json(await accountService.listPlatformAccounts({
            actorAccountId: auth.payload.accountId,
            query: queryFromUrl(url),
          }), 200);
        }
        case "getPlatformAccount": {
          if (!accountService || !auth.payload.accountId) throw new Error("Account service unavailable");
          return json(await accountService.getPlatformAccount(auth.payload.accountId, route.accountId), 200);
        }
        case "grantPlatformAccountAuthority":
        case "revokePlatformAccountAuthority": {
          if (!accountService || !auth.payload.accountId || !auth.payload.externalIdentityId) {
            throw new Error("Account service unavailable");
          }
          await accountService.setPlatformAuthority({
            actorAccountId: auth.payload.accountId,
            actorExternalIdentityId: auth.payload.externalIdentityId,
            targetAccountId: route.accountId,
            authority: route.authority,
            grant: route.operation === "grantPlatformAccountAuthority",
            requestId: request.headers.get("X-Request-Id") ?? undefined,
          });
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
        case "blockPlatformAccount":
        case "restorePlatformAccount": {
          if (!accountService || !auth.payload.accountId || !auth.payload.externalIdentityId) {
            throw new Error("Account service unavailable");
          }
          await accountService.setPlatformBlocked({
            actorAccountId: auth.payload.accountId,
            actorExternalIdentityId: auth.payload.externalIdentityId,
            targetAccountId: route.accountId,
            blocked: route.operation === "blockPlatformAccount",
            requestId: request.headers.get("X-Request-Id") ?? undefined,
          });
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
        case "accessSummary": {
          const summary = await platformAccess.getAccessSummary(actor);
          return json(summary, 200);
        }
        case "listPlatformPrincipals": {
          const query = queryFromUrl(url);
          return json(await platformAccess.listPrincipals(actor, query), 200);
        }
        case "getPlatformPrincipal": {
          const principal = await platformAccess.getPrincipal(actor, route.principalRef);
          return json(principal, 200);
        }
        case "getPlatformAccess": {
          const access = await platformAccess.getAccessState(actor, route.principalRef);
          const response = json(access, 200);
          response.headers.set("ETag", formatCasAdminETag(access.revision));
          response.headers.set("Cache-Control", REVISION_CACHE_CONTROL);
          return response;
        }
        case "patchPlatformAccess": {
          const ifMatch = request.headers.get("If-Match") ?? undefined;
          const body = await readJsonBody<unknown>(request);
          if (body === null) return invalidRequest("JSON body is required");
          const { revision } = await platformAccess.patchAccess(actor, route.principalRef, body, ifMatch);
          return new Response(null, {
            status: 204,
            headers: { ETag: formatCasAdminETag(revision), "Cache-Control": REVISION_CACHE_CONTROL },
          });
        }
        case "listPlatformInvitations": {
          if (!platformInvitations) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
          return json(await platformInvitations.list(actor, queryFromUrl(url)), 200);
        }
        case "createPlatformInvitation": {
          if (!platformInvitations) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
          const body = await readJsonBody<unknown>(request);
          if (body === null) return invalidRequest("JSON body is required");
          const created = await platformInvitations.create(
            actor,
            body,
            request.headers.get("Idempotency-Key") ?? undefined,
            request.headers.get("X-Request-Id"),
          );
          const response = json({
            invitationId: created.invitationId,
            acceptUrl: absolutize(created.acceptUrl),
            expiresAt: created.expiresAt,
          }, 201);
          response.headers.set("ETag", formatCasAdminETag(created.revision));
          response.headers.set("Cache-Control", REVISION_CACHE_CONTROL);
          return response;
        }
        case "revokePlatformInvitation": {
          if (!platformInvitations) throw new PlatformAccessError("SERVICE_UNAVAILABLE", 503);
          const revoked = await platformInvitations.revoke(
            actor,
            route.invitationId,
            request.headers.get("If-Match") ?? undefined,
            request.headers.get("X-Request-Id"),
          );
          return new Response(null, {
            status: 204,
            headers: { ETag: formatCasAdminETag(revoked.revision), "Cache-Control": REVISION_CACHE_CONTROL },
          });
        }
        case "listPlatformAuditEvents": {
          if (!accountService || !auth.payload.accountId) throw new Error("Account service unavailable");
          return json(await accountService.listPlatformAuditEvents({
            actorAccountId: auth.payload.accountId,
            query: queryFromUrl(url),
          }), 200);
        }
        default:
          return json({ error: "Not Found" }, 404);
      }
    } catch (error) {
      if (error instanceof AccountServiceError) {
        const status = error.code === "PLATFORM_ADMIN_REQUIRED" || error.code === "ACCOUNT_BLOCKED" ? 403
          : error.code === "ACCOUNT_NOT_FOUND" ? 404
            : error.code === "INVALID_CURSOR" || error.code === "INVALID_REQUEST" ? 400
              : error.code === "LAST_PLATFORM_ADMIN" || error.code === "SELF_BLOCK_FORBIDDEN" ? 409
                : 409;
        return json({ error: error.code }, status);
      }
      if (error instanceof PlatformAccessError) {
        const body: CasAdminErrorResponse = { error: error.code as CasAdminErrorResponse["error"] };
        return json(body, error.status);
      }
      throw error;
    }
  }

  /** Root Ref audit reads: membership first, then the private reader RPC. */
  async function handleAuditRead(
    request: Request,
    route: CasAdminRoute & { operation: "listRefDomains" | "listRootDomainRefs" | "listRootDomainEvents" },
    ctx: ControlPlaneCallContext,
    query: Record<string, string>,
  ): Promise<Response> {
    const membership = await controlPlane.getStack(ctx, { path: { stackId: route.stackId } });
    if ("error" in membership) {
      return json(membership, casAdminErrorHttpStatus[membership.error]);
    }
    if (route.operation !== "listRefDomains") {
      const domainError = validateAuditRefDomain(route.refDomain);
      if (domainError) return adminErrorResponse(CasAdminErrorCodes.INVALID_REQUEST, domainError);
    }
    if (!options.auditReader) {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, NOT_AVAILABLE_MESSAGE);
    }
    const rpcPath = route.operation === "listRefDomains"
      ? "/_internal/audit/domains"
      : route.operation === "listRootDomainRefs"
        ? "/_internal/audit/refs"
        : "/_internal/audit/events";
    const rpcUrl = new URL(`https://cas-audit.internal${rpcPath}`);
    rpcUrl.searchParams.set("stackId", route.stackId);
    if (route.operation !== "listRefDomains") {
      rpcUrl.searchParams.set("refDomain", route.refDomain);
    }
    if (query.tenantId !== undefined) rpcUrl.searchParams.set("tenantId", query.tenantId);
    if (query.limit !== undefined) rpcUrl.searchParams.set("limit", query.limit);
    if (query.cursor !== undefined) rpcUrl.searchParams.set("cursor", query.cursor);
    if (query.after !== undefined) rpcUrl.searchParams.set("after", query.after);
    const headers: Record<string, string> = {};
    if (config.auditReaderKey) headers["X-CAS-Audit-Reader-Key"] = config.auditReaderKey;
    try {
      const rpcResponse = await options.auditReader.fetch(rpcUrl.toString(), { headers });
      const body = await rpcResponse.text();
      return new Response(body, {
        status: rpcResponse.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch {
      return adminErrorResponse(CasAdminErrorCodes.SERVICE_UNAVAILABLE, "audit reader is unavailable");
    }
  }

  // ------------------------------------------------------------------
  // Session / auth helpers
  // ------------------------------------------------------------------

  async function persistSession(sessionId: string, payload: AdminSessionPayload | CliOneTimeCodePayload, ttlMs: number): Promise<void> {
    const account = payload.accountId && payload.externalIdentityId && payload.credentialVersion !== undefined
      ? { accountId: payload.accountId, externalIdentityId: payload.externalIdentityId, credentialVersion: payload.credentialVersion }
      : undefined;
    await sessionStore.create(sessionId, await sessionCrypto.encrypt(payload), ttlMs, account);
  }

  function readSessionId(request: Request): string | null {
    const cookies = parseCookies(request);
    const value = cookies[cookieName];
    return value && value.length > 0 ? value : null;
  }

  async function readSession(sessionId: string): Promise<AdminSessionPayload | null> {
    const stored = await sessionStore.read(sessionId);
    if (!stored) return null;
    try {
      const payload = await sessionCrypto.decrypt(stored.encryptedPayload);
      if (accountService && payload.authenticated && payload.identityIssuer !== TEST_ACCOUNT_ISSUER) {
        try {
          if (payload.accountId && payload.externalIdentityId && payload.credentialVersion !== undefined) {
            const resolved = await accountService.authorizeCredential({
              accountId: payload.accountId,
              externalIdentityId: payload.externalIdentityId,
              credentialVersion: payload.credentialVersion,
            });
            if (resolved.authenticatedIdentity.issuer !== payload.identityIssuer
              || resolved.authenticatedIdentity.subject !== payload.subject) throw new AccountServiceError("IDENTITY_ACCOUNT_MISMATCH");
          } else {
            throw new AccountServiceError("IDENTITY_NOT_FOUND");
          }
        } catch (error) {
          if (!(error instanceof AccountServiceError)) throw error;
          await sessionStore.delete(sessionId);
          return null;
        }
      }
      if (platformAccess === null
        && payload.authenticated
        && !payload.invitationAccess
        && !payload.admittedViaInvitation
        && !isEmailAllowed(payload.emailForDisplay, true)) {
        await sessionStore.delete(sessionId);
        return null;
      }
      return payload;
    } catch {
      await sessionStore.delete(sessionId);
      return null;
    }
  }

  async function requireAuthenticated(request: Request): Promise<
    { payload: AdminSessionPayload; sessionId: string } | Response
  > {
    const sessionId = readSessionId(request);
    if (!sessionId) return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "login required");
    const payload = await readSession(sessionId);
    if (!payload || !payload.authenticated || payload.subject.length === 0) {
      return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "login required");
    }
    if (payload.invitationAccess) {
      await sessionStore.touch(sessionId, sessionTtlMs);
      return adminErrorResponse(
        CasAdminErrorCodes.INVITATION_SESSION_REQUIRED,
        "this session is limited to its invitation",
      );
    }
    if (platformAccess !== null) {
      const sessionPrincipal = {
        issuer: payload.identityIssuer,
        subject: payload.subject,
      };
      try {
        await platformAccess.requireAccess(sessionPrincipal);
      } catch (error) {
        if (error instanceof PlatformAccessError && error.code === "PLATFORM_ACCESS_REQUIRED") {
          await sessionStore.delete(sessionId);
          return adminErrorResponse(CasAdminErrorCodes.ADMIN_AUTH_REQUIRED, "login required");
        }
        throw error;
      }
    }
    await sessionStore.touch(sessionId, sessionTtlMs);
    return { payload, sessionId };
  }

  async function passCsrf(
    request: Request,
    payload: AdminSessionPayload,
  ): Promise<boolean> {
    if (config.csrfEnforced === false) return true;
    return checkSameOrigin(request, config.publicOrigin)
      && checkCsrfToken(request, payload.csrfToken);
  }

  function serviceContext(
    payload: AdminSessionPayload,
    request: Request,
  ): ControlPlaneCallContext {
    return {
      identity: { identityIssuer: payload.identityIssuer, subject: payload.subject },
      account: payload.accountId && payload.externalIdentityId && payload.credentialVersion !== undefined
        ? {
          accountId: payload.accountId,
          externalIdentityId: payload.externalIdentityId,
          credentialVersion: payload.credentialVersion,
        }
        : undefined,
      verifiedEmailEvidence: payload.verifiedEmailEvidence,
      profile: {
        displayName: payload.displayName,
        emailForDisplay: payload.emailForDisplay,
      },
      requestId: request.headers.get("X-Request-Id") ?? generateRequestId(),
      traceId: generateRequestId(),
      caller: { channel: "admin-webui" },
    };
  }

  async function auditLoginFailure(state: string): Promise<void> {
    try {
      await controlPlane.recordSessionAudit(
        {
          identity: {
            identityIssuer: config.oidcIssuer ?? "https://accounts.google.com",
            subject: "unauthenticated",
          },
          requestId: generateRequestId(),
          traceId: generateRequestId(),
        },
        "session.login_failed",
        state.length > 0 ? state : "oidc-callback",
        null,
      );
    } catch {
      // Auditing must never break the login flow.
    }
  }

  function isEmailAllowed(email: string | null, emailVerified: boolean): boolean {
    if (!emailAllowlist) return true;
    return emailVerified && email !== null && emailAllowlist.has(email.toLowerCase());
  }

  function isEvidenceAllowed(evidence: AuthenticatedProviderResult["verifiedEmailEvidence"]): boolean {
    if (!emailAllowlist) return true;
    return evidence.some(item => item.expiresAt > now() && emailAllowlist.has(item.normalizedEmail));
  }

  function sanitizeReturnTo(value: string | null): string | null {
    if (!value) return null;
    if (!value.startsWith("/admin")) return null;
    if (value.startsWith("//")) return null;
    return value;
  }
}

// ----------------------------------------------------------------------
// Response helpers
// ----------------------------------------------------------------------

function parseProviderKind(value: string): ProviderKind | null {
  return value === "google" || value === "microsoft" || value === "github" ? value : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function identityMutationStartResponse(request: Request, response: Response): Response {
  if (!request.headers.get("Accept")?.includes("application/json")) return response;
  const redirectTo = response.headers.get("Location");
  if (!redirectTo || response.status < 300 || response.status >= 400) return response;
  const headers = new Headers({ "Cache-Control": "no-store" });
  const setCookie = response.headers.get("Set-Cookie");
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return Response.json({ redirectTo }, { status: 200, headers });
}

function isMutating(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function jsonWithEtag(result: unknown): Response {
  if (isAdminError(result)) {
    return json(result, casAdminErrorHttpStatus[result.error]);
  }
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (typeof result === "object" && result !== null && "revision" in result) {
    const revision = (result as { revision: unknown }).revision;
    if (typeof revision === "number") {
      headers["ETag"] = formatCasAdminETag(revision);
      headers["Cache-Control"] = REVISION_CACHE_CONTROL;
    }
  }
  return Response.json(result, { status: 200, headers });
}

function adminErrorResponse(code: CasAdminErrorResponse["error"], message?: string): Response {
  const body: CasAdminErrorResponse = { error: code, ...(message ? { message } : {}) };
  return json(body, casAdminErrorHttpStatus[code]);
}

function invalidRequest(message: string): Response {
  return adminErrorResponse(CasAdminErrorCodes.INVALID_REQUEST, message);
}

function csrfRejected(): Response {
  return json({ error: "CSRF_ORIGIN_FAILED", message: "origin or CSRF check failed" }, 403);
}

function isAdminError(value: unknown): value is CasAdminErrorResponse {
  return (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof (value as { error: unknown }).error === "string"
  );
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (text.length === 0) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function pageQuery(query: Record<string, string>): {
  limit?: number;
  cursor?: string;
  after?: string;
} {
  const out: { limit?: number; cursor?: string; after?: string } = {};
  if (query.limit !== undefined) out.limit = Number(query.limit);
  if (query.cursor !== undefined) out.cursor = query.cursor;
  if (query.after !== undefined) out.after = query.after;
  return out;
}

function queryFromUrl(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  const search = url.search.replace(/^\?/, "");
  if (!search) return out;
  for (const pair of search.split("&")) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) {
      out[decodeURIComponent(pair)] = "";
    } else {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return out;
}

function generateRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readBasicCredentials(request: Request): { email: string; password: string } | null {
  const authorization = request.headers.get("Authorization");
  const match = authorization ? /^Basic\s+([^\s]+)$/i.exec(authorization) : null;
  if (!match) return null;
  try {
    const binary = atob(match[1]!);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { email: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

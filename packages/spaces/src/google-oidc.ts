import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { randomToken, sha256Base64Url } from "./crypto.js";
import type { PrincipalContext, SpacesRepository } from "./repository.js";

export interface GoogleOidcConfig {
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleAuthorization {
  readonly redirectUrl: string;
  readonly state: string;
}

type OAuthAttemptRepository = Pick<SpacesRepository, "createOAuthAttempt" | "consumeOAuthAttempt">;
type IdentityRepository = Pick<SpacesRepository, "resolveExternalIdentity">;

interface GoogleDiscovery {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

export class GoogleAuthError extends Error {
  constructor(
    readonly code: "auth_invalid" | "auth_unavailable" | "principal_not_admitted" | "principal_suspended",
    readonly status: 401 | 403 | 503,
  ) {
    super(code);
  }
}

export class GoogleOidcClient {
  readonly #config: GoogleOidcConfig;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  #discovery: { readonly value: GoogleDiscovery; readonly fetchedAt: number } | null = null;
  #jwks: { readonly value: JSONWebKeySet; readonly fetchedAt: number } | null = null;

  constructor(
    config: GoogleOidcConfig,
    fetchImpl: typeof fetch = globalThis.fetch,
    options: { readonly now?: () => number; readonly cacheTtlMs?: number } = {},
  ) {
    this.#config = config;
    this.#fetch = (input, init) => fetchImpl(input, init);
    this.#now = options.now ?? (() => Date.now());
    this.#cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1000;
  }

  async begin(repository: Pick<OAuthAttemptRepository, "createOAuthAttempt">): Promise<GoogleAuthorization> {
    const state = randomToken(18);
    const nonce = randomToken(18);
    const codeVerifier = randomToken(48);
    await repository.createOAuthAttempt({ state, nonce, codeVerifier, lifetimeMs: 10 * 60 * 1000 });
    const discovery = await this.#getDiscovery();
    const redirect = new URL(discovery.authorization_endpoint);
    redirect.searchParams.set("client_id", this.#config.clientId);
    redirect.searchParams.set("redirect_uri", this.#config.redirectUri);
    redirect.searchParams.set("response_type", "code");
    redirect.searchParams.set("scope", "openid email profile");
    redirect.searchParams.set("prompt", "select_account");
    redirect.searchParams.set("state", state);
    redirect.searchParams.set("nonce", nonce);
    redirect.searchParams.set("code_challenge", await sha256Base64Url(codeVerifier));
    redirect.searchParams.set("code_challenge_method", "S256");
    return { redirectUrl: redirect.toString(), state };
  }

  async complete(input: {
    readonly repository: OAuthAttemptRepository & IdentityRepository;
    readonly state: string;
    readonly stateCookie: string;
    readonly code: string;
  }): Promise<PrincipalContext> {
    if (!constantTimeEqual(input.state, input.stateCookie)) {
      throw new GoogleAuthError("auth_invalid", 401);
    }
    const attempt = await input.repository.consumeOAuthAttempt(input.state);
    if (!attempt) throw new GoogleAuthError("auth_invalid", 401);
    const discovery = await this.#getDiscovery();
    const tokenResponse = await this.#fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: this.#config.redirectUri,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        code_verifier: attempt.codeVerifier,
      }).toString(),
    }).catch(() => {
      throw new GoogleAuthError("auth_unavailable", 503);
    });
    const tokenPayload = await tokenResponse.json().catch(() => null) as Record<string, unknown> | null;
    if (!tokenResponse.ok || typeof tokenPayload?.id_token !== "string") {
      throw new GoogleAuthError("auth_invalid", 401);
    }
    let verified: Awaited<ReturnType<typeof jwtVerify>>;
    try {
      verified = await this.#verifyToken(tokenPayload.id_token, await this.#getJwks(discovery.jwks_uri));
    } catch {
      try {
        verified = await this.#verifyToken(
          tokenPayload.id_token,
          await this.#getJwks(discovery.jwks_uri, true),
        );
      } catch {
        throw new GoogleAuthError("auth_invalid", 401);
      }
    }
    if (verified.payload.nonce !== attempt.nonce || typeof verified.payload.sub !== "string") {
      throw new GoogleAuthError("auth_invalid", 401);
    }
    const subject = verified.payload.sub;
    const principal = await input.repository.resolveExternalIdentity("google", subject);
    if (!principal) throw new GoogleAuthError("principal_not_admitted", 403);
    if (principal.status !== "active") throw new GoogleAuthError("principal_suspended", 403);
    return principal;
  }

  async #getDiscovery(): Promise<GoogleDiscovery> {
    const now = this.#now();
    if (this.#discovery && now - this.#discovery.fetchedAt < this.#cacheTtlMs) {
      return this.#discovery.value;
    }
    const response = await this.#fetch(this.#config.discoveryUrl, { headers: { Accept: "application/json" } })
      .catch(() => {
        throw new GoogleAuthError("auth_unavailable", 503);
      });
    if (!response.ok) throw new GoogleAuthError("auth_unavailable", 503);
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const discovery = {
      issuer: readHttpsUrl(payload?.issuer),
      authorization_endpoint: readHttpsUrl(payload?.authorization_endpoint),
      token_endpoint: readHttpsUrl(payload?.token_endpoint),
      jwks_uri: readHttpsUrl(payload?.jwks_uri),
    };
    if (discovery.issuer !== this.#config.issuer) {
      throw new GoogleAuthError("auth_unavailable", 503);
    }
    this.#discovery = { value: discovery, fetchedAt: now };
    return discovery;
  }

  async #getJwks(uri: string, forceRefresh = false): Promise<JSONWebKeySet> {
    const now = this.#now();
    if (!forceRefresh && this.#jwks && now - this.#jwks.fetchedAt < this.#cacheTtlMs) {
      return this.#jwks.value;
    }
    const response = await this.#fetch(uri, { headers: { Accept: "application/json" } }).catch(() => {
      throw new GoogleAuthError("auth_unavailable", 503);
    });
    const payload = await response.json().catch(() => null) as JSONWebKeySet | null;
    if (!response.ok || !payload || !Array.isArray(payload.keys) || payload.keys.length === 0) {
      throw new GoogleAuthError("auth_unavailable", 503);
    }
    this.#jwks = { value: payload, fetchedAt: now };
    return payload;
  }

  #verifyToken(idToken: string, jwks: JSONWebKeySet) {
    return jwtVerify(idToken, createLocalJWKSet(jwks), {
      algorithms: ["RS256"],
      issuer: this.#config.issuer,
      audience: this.#config.clientId,
      clockTolerance: 30,
    });
  }
}

function readHttpsUrl(value: unknown): string {
  if (typeof value !== "string") throw new GoogleAuthError("auth_unavailable", 503);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("not HTTPS");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new GoogleAuthError("auth_unavailable", 503);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
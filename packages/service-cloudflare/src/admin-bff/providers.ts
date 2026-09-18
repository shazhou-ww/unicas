import {
  OidcClient,
  OAuthAuthorizationCodeClient,
  type VerifiedOidcIdentity,
} from "@unicas/control-auth";
import {
  verifiedProviderEmailEvidence,
  type AuthenticatedProviderResult,
  type ProviderAdapter,
  type ProviderCallbackInput,
  type ProviderFlowContext,
} from "@unicas/service";

export const GOOGLE_ISSUER = "https://accounts.google.com";
export const MICROSOFT_CONSUMERS_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const MICROSOFT_CONSUMERS_AUTHORITY = "https://login.microsoftonline.com/consumers/v2.0";
export const MICROSOFT_CONSUMERS_ISSUER = `https://login.microsoftonline.com/${MICROSOFT_CONSUMERS_TENANT_ID}/v2.0`;
export const GITHUB_ISSUER = "https://github.com";

interface OidcProviderClient {
  authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): Promise<string>;
  exchangeCode(input: {
    readonly code: string;
    readonly codeVerifier: string;
  }): Promise<{ readonly idToken: string; readonly accessToken: string | null }>;
  verifyIdToken(input: {
    readonly idToken: string;
    readonly nonce: string;
  }): Promise<VerifiedOidcIdentity>;
}

export class ProviderAdapterError extends Error {
  constructor(readonly code: "provider_unavailable" | "provider_response_invalid" | "callback_invalid") {
    super(code);
    this.name = "ProviderAdapterError";
  }
}

export class GoogleProviderAdapter implements ProviderAdapter {
  readonly kind = "google" as const;
  readonly displayName = "Google";

  constructor(
    readonly client: OidcProviderClient,
    readonly issuer: string = GOOGLE_ISSUER,
    readonly now: () => number = Date.now,
  ) { }

  async begin(context: ProviderFlowContext): Promise<string> {
    if (!context.nonce) throw new ProviderAdapterError("callback_invalid");
    return this.client.authorizationUrl({
      state: context.state,
      nonce: context.nonce,
      codeChallenge: context.codeChallenge,
    });
  }

  async complete(input: ProviderCallbackInput): Promise<AuthenticatedProviderResult> {
    if (!input.nonce) throw new ProviderAdapterError("callback_invalid");
    const exchanged = await this.client.exchangeCode({ code: input.code, codeVerifier: input.codeVerifier });
    const identity = await this.client.verifyIdToken({ idToken: exchanged.idToken, nonce: input.nonce });
    const authenticatedAt = this.now();
    return {
      provider: "google",
      issuer: this.issuer,
      subject: identity.sub,
      displayName: identity.name,
      avatarUrl: safeAvatar(identity.picture, ["googleusercontent.com"]),
      accountHint: identity.email,
      verifiedEmailEvidence: identity.email && identity.emailVerified
        ? [verifiedProviderEmailEvidence({
          provider: "google",
          email: identity.email,
          verifiedAt: authenticatedAt,
          authenticationEventId: input.authenticationEventId,
        })]
        : [],
      authenticatedAt,
      authenticationEventId: input.authenticationEventId,
    };
  }
}

export class MicrosoftPersonalProviderAdapter implements ProviderAdapter {
  readonly kind = "microsoft" as const;
  readonly displayName = "Microsoft";

  constructor(
    readonly client: OidcProviderClient,
    readonly now: () => number = Date.now,
  ) { }

  async begin(context: ProviderFlowContext): Promise<string> {
    if (!context.nonce) throw new ProviderAdapterError("callback_invalid");
    return this.client.authorizationUrl({
      state: context.state,
      nonce: context.nonce,
      codeChallenge: context.codeChallenge,
    });
  }

  async complete(input: ProviderCallbackInput): Promise<AuthenticatedProviderResult> {
    if (!input.nonce) throw new ProviderAdapterError("callback_invalid");
    const exchanged = await this.client.exchangeCode({ code: input.code, codeVerifier: input.codeVerifier });
    const identity = await this.client.verifyIdToken({ idToken: exchanged.idToken, nonce: input.nonce });
    if (identity.tenantId !== MICROSOFT_CONSUMERS_TENANT_ID || identity.version !== "2.0") {
      throw new ProviderAdapterError("provider_response_invalid");
    }
    const authenticatedAt = this.now();
    return {
      provider: "microsoft",
      issuer: MICROSOFT_CONSUMERS_ISSUER,
      subject: identity.sub,
      displayName: identity.name,
      avatarUrl: null,
      accountHint: identity.email ?? identity.preferredUsername,
      verifiedEmailEvidence: [],
      authenticatedAt,
      authenticationEventId: input.authenticationEventId,
    };
  }
}

export class GitHubProviderAdapter implements ProviderAdapter {
  readonly kind = "github" as const;
  readonly displayName = "GitHub";
  readonly #fetch: typeof fetch;

  constructor(
    readonly client: OAuthAuthorizationCodeClient,
    options: {
      readonly fetchImpl?: typeof fetch;
      readonly now?: () => number;
    } = {},
  ) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.#fetch = (resource, init) => fetchImpl(resource, init);
    this.now = options.now ?? Date.now;
  }

  readonly now: () => number;

  async begin(context: ProviderFlowContext): Promise<string> {
    return this.client.authorizationUrl({ state: context.state, codeChallenge: context.codeChallenge });
  }

  async complete(input: ProviderCallbackInput): Promise<AuthenticatedProviderResult> {
    const token = await this.client.exchangeCode({ code: input.code, codeVerifier: input.codeVerifier });
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "UniCAS",
    };
    const [userResponse, emailsResponse] = await Promise.all([
      this.#fetch("https://api.github.com/user", { headers }),
      this.#fetch("https://api.github.com/user/emails", { headers }),
    ]).catch(() => {
      throw new ProviderAdapterError("provider_unavailable");
    });
    if (!userResponse.ok || !emailsResponse.ok) throw new ProviderAdapterError("provider_unavailable");
    const user = (await userResponse.json().catch(() => null)) as GitHubUser | null;
    const emails = (await emailsResponse.json().catch(() => null)) as GitHubEmail[] | null;
    if (!validGitHubUser(user) || !Array.isArray(emails)) {
      throw new ProviderAdapterError("provider_response_invalid");
    }
    const authenticatedAt = this.now();
    const verifiedEmailEvidence = emails
      .filter(validGitHubEmail)
      .filter(email => email.verified)
      .map(email => verifiedProviderEmailEvidence({
        provider: "github",
        email: email.email,
        verifiedAt: authenticatedAt,
        authenticationEventId: input.authenticationEventId,
      }));
    return {
      provider: "github",
      issuer: GITHUB_ISSUER,
      subject: String(user.id),
      displayName: nonEmpty(user.name) ?? user.login,
      avatarUrl: safeAvatar(user.avatar_url, ["githubusercontent.com"]),
      accountHint: user.login,
      verifiedEmailEvidence,
      authenticatedAt,
      authenticationEventId: input.authenticationEventId,
    };
  }
}

export function createGoogleProvider(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly discoveryUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}): GoogleProviderAdapter {
  return new GoogleProviderAdapter(new OidcClient({
    issuer: GOOGLE_ISSUER,
    discoveryUrl: input.discoveryUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  }, { fetchImpl: input.fetchImpl, now: input.now }), GOOGLE_ISSUER, input.now);
}

export function createMicrosoftPersonalProvider(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly discoveryUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}): MicrosoftPersonalProviderAdapter {
  return new MicrosoftPersonalProviderAdapter(new OidcClient({
    issuer: MICROSOFT_CONSUMERS_ISSUER,
    discoveryUrl: input.discoveryUrl
      ?? `${MICROSOFT_CONSUMERS_AUTHORITY}/.well-known/openid-configuration`,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  }, { fetchImpl: input.fetchImpl, now: input.now }), input.now);
}

export function createGitHubProvider(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}): GitHubProviderAdapter {
  return new GitHubProviderAdapter(new OAuthAuthorizationCodeClient({
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
    scopes: ["read:user", "user:email"],
  }, { fetchImpl: input.fetchImpl }), { fetchImpl: input.fetchImpl, now: input.now });
}

interface GitHubUser {
  readonly id?: unknown;
  readonly login?: unknown;
  readonly name?: unknown;
  readonly avatar_url?: unknown;
}

interface GitHubEmail {
  readonly email?: unknown;
  readonly verified?: unknown;
}

function validGitHubUser(value: GitHubUser | null): value is GitHubUser & { id: number; login: string } {
  return value !== null
    && Number.isSafeInteger(value.id)
    && (value.id as number) > 0
    && typeof value.login === "string"
    && value.login.length > 0;
}

function validGitHubEmail(value: GitHubEmail): value is GitHubEmail & { email: string; verified: boolean } {
  return typeof value.email === "string"
    && value.email.length > 0
    && typeof value.verified === "boolean";
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeAvatar(value: unknown, allowedHostSuffixes: readonly string[]): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !allowedHostSuffixes.some(suffix =>
      url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) return null;
    return url.toString();
  } catch {
    return null;
  }
}
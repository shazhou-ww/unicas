export interface OAuthAuthorizationCodeClientConfig {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

export interface OAuthAccessToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly scope: string | null;
}

export class OAuthError extends Error {
  constructor(readonly code: "authorization_config_invalid" | "token_exchange_failed", message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export class OAuthAuthorizationCodeClient {
  readonly #authorizationEndpoint: URL;
  readonly #tokenEndpoint: URL;
  readonly #clientId: string;
  readonly #clientSecret: string | undefined;
  readonly #redirectUri: string;
  readonly #scopes: readonly string[];
  readonly #fetch: typeof fetch;

  constructor(
    config: OAuthAuthorizationCodeClientConfig,
    options: { readonly fetchImpl?: typeof fetch } = {},
  ) {
    this.#authorizationEndpoint = httpsEndpoint(config.authorizationEndpoint);
    this.#tokenEndpoint = httpsEndpoint(config.tokenEndpoint);
    this.#clientId = requireNonEmpty(config.clientId, "clientId");
    this.#clientSecret = config.clientSecret;
    this.#redirectUri = requireHttpUrl(config.redirectUri, "redirectUri");
    if (config.scopes.length === 0 || config.scopes.some(scope => scope.length === 0)) {
      throw new OAuthError("authorization_config_invalid", "scopes must contain non-empty values");
    }
    this.#scopes = [...config.scopes];
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.#fetch = (input, init) => fetchImpl(input, init);
  }

  authorizationUrl(input: {
    readonly state: string;
    readonly codeChallenge: string;
  }): string {
    const url = new URL(this.#authorizationEndpoint);
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", this.#redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.#scopes.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(input: {
    readonly code: string;
    readonly codeVerifier: string;
  }): Promise<OAuthAccessToken> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: this.#redirectUri,
      client_id: this.#clientId,
      code_verifier: input.codeVerifier,
    });
    if (this.#clientSecret !== undefined && this.#clientSecret.length > 0) {
      body.set("client_secret", this.#clientSecret);
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#tokenEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
    } catch (error) {
      throw new OAuthError("token_exchange_failed", "OAuth token exchange failed");
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof payload.access_token !== "string" || payload.access_token.length === 0) {
      throw new OAuthError("token_exchange_failed", `OAuth token exchange failed with ${response.status}`);
    }
    return {
      accessToken: payload.access_token,
      tokenType: typeof payload.token_type === "string" && payload.token_type.length > 0
        ? payload.token_type
        : "Bearer",
      scope: typeof payload.scope === "string" ? payload.scope : null,
    };
  }
}

function httpsEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError("authorization_config_invalid", "provider endpoint must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new OAuthError("authorization_config_invalid", "provider endpoint must be an absolute HTTPS URL without credentials");
  }
  return url;
}

function requireHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError("authorization_config_invalid", `${name} must be an absolute HTTP(S) URL`);
  }
  if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:") || url.username || url.password) {
    throw new OAuthError("authorization_config_invalid", `${name} must be an absolute HTTP(S) URL without credentials`);
  }
  return url.toString();
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0) throw new OAuthError("authorization_config_invalid", `${name} must not be empty`);
  return value;
}
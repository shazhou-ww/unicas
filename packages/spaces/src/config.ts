import type { D1Database } from "@cloudflare/workers-types";
import { DefaultMaximumUploadBytes, MaximumUploadBytes } from "./file-service.js";
import type { CapabilityConfig } from "./capability.js";
import type { GoogleOidcConfig } from "./google-oidc.js";

export interface SpacesEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly SPACES_DB: D1Database;
  readonly PUBLIC_ORIGIN: string;
  readonly UNICAS_BASE_URL: string;
  readonly UNICAS_AUDIENCE: string;
  readonly SPACES_ISSUER: string;
  readonly SPACES_SIGNING_KID: string;
  readonly SPACES_SIGNING_PRIVATE_KEY: string;
  readonly SPACES_SIGNING_PUBLIC_JWKS: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly GOOGLE_ISSUER?: string;
  readonly GOOGLE_DISCOVERY_URL?: string;
  readonly SPACES_SESSION_TTL_SECONDS?: string;
  readonly SPACES_MAX_UPLOAD_BYTES?: string;
  readonly SPACES_COOKIE_SECURE?: string;
  readonly SPACES_SMOKE_ENABLED?: string;
  readonly SPACES_SMOKE_CREDENTIAL?: string;
  readonly SPACES_SMOKE_PRINCIPAL_ID?: string;
}

export interface SpacesConfig {
  readonly publicOrigin: string;
  readonly capability: CapabilityConfig;
  readonly google: GoogleOidcConfig;
  readonly publicJwks: { readonly keys: readonly Readonly<Record<string, unknown>>[] };
  readonly sessionTtlMs: number;
  readonly maximumUploadBytes: number;
  readonly secureCookies: boolean;
  readonly smoke: {
    readonly enabled: boolean;
    readonly credential?: string;
    readonly principalId?: string;
  };
}

export class SpacesConfigurationError extends Error {
  readonly code = "configuration_unavailable";
}

export function readSpacesConfig(env: SpacesEnv): SpacesConfig {
  const publicOrigin = httpOrigin(required(env.PUBLIC_ORIGIN, "PUBLIC_ORIGIN"), "PUBLIC_ORIGIN");
  const issuer = httpsUrl(required(env.SPACES_ISSUER, "SPACES_ISSUER"), "SPACES_ISSUER");
  const keyId = required(env.SPACES_SIGNING_KID, "SPACES_SIGNING_KID");
  const googleIssuer = httpsUrl(env.GOOGLE_ISSUER ?? "https://accounts.google.com", "GOOGLE_ISSUER");
  return {
    publicOrigin,
    capability: {
      issuer,
      audience: required(env.UNICAS_AUDIENCE, "UNICAS_AUDIENCE"),
      keyId,
      privateKeyPem: required(env.SPACES_SIGNING_PRIVATE_KEY, "SPACES_SIGNING_PRIVATE_KEY"),
      unicasBaseUrl: httpOrigin(required(env.UNICAS_BASE_URL, "UNICAS_BASE_URL"), "UNICAS_BASE_URL"),
    },
    google: {
      issuer: googleIssuer,
      discoveryUrl: httpsUrl(
        env.GOOGLE_DISCOVERY_URL ?? `${googleIssuer}/.well-known/openid-configuration`,
        "GOOGLE_DISCOVERY_URL",
      ),
      clientId: required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
      clientSecret: required(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
      redirectUri: `${publicOrigin}/auth/google/callback`,
    },
    publicJwks: parsePublicJwks(env.SPACES_SIGNING_PUBLIC_JWKS, keyId),
    sessionTtlMs: boundedInteger(env.SPACES_SESSION_TTL_SECONDS, 8 * 60 * 60, 300, 24 * 60 * 60) * 1000,
    maximumUploadBytes: boundedInteger(
      env.SPACES_MAX_UPLOAD_BYTES,
      DefaultMaximumUploadBytes,
      1,
      MaximumUploadBytes,
    ),
    secureCookies: env.SPACES_COOKIE_SECURE !== "false",
    smoke: {
      enabled: env.SPACES_SMOKE_ENABLED === "true",
      ...(env.SPACES_SMOKE_CREDENTIAL ? { credential: env.SPACES_SMOKE_CREDENTIAL } : {}),
      ...(env.SPACES_SMOKE_PRINCIPAL_ID ? { principalId: env.SPACES_SMOKE_PRINCIPAL_ID } : {}),
    },
  };
}

export function issuerMetadata(config: SpacesConfig): Readonly<Record<string, unknown>> {
  return {
    issuer: config.capability.issuer,
    authorization_endpoint: `${config.publicOrigin}/oauth/authorize`,
    token_endpoint: `${config.publicOrigin}/oauth/token`,
    jwks_uri: `${config.publicOrigin}/.well-known/jwks.json`,
    scopes_supported: [],
    code_challenge_methods_supported: ["S256"],
  };
}

export function issuerJwks(config: SpacesConfig): { readonly keys: readonly Readonly<Record<string, unknown>>[] } {
  return config.publicJwks;
}

function parsePublicJwks(value: string | undefined, activeKeyId: string): {
  readonly keys: readonly Readonly<Record<string, unknown>>[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(value, "SPACES_SIGNING_PUBLIC_JWKS"));
  } catch {
    throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || !Array.isArray((parsed as { keys?: unknown }).keys)
    || (parsed as { keys: unknown[] }).keys.length === 0
    || (parsed as { keys: unknown[] }).keys.length > 5) {
    throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS must contain 1-5 public keys");
  }
  const seen = new Set<string>();
  const keys = (parsed as { keys: unknown[] }).keys.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS keys must be objects");
    }
    const jwk = value as Record<string, unknown>;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string"
      || typeof jwk.kid !== "string" || jwk.kid.length === 0) {
      throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS keys must be named EC P-256 public keys");
    }
    if (["d", "p", "q", "dp", "dq", "qi", "k", "oth"].some((field) => field in jwk)) {
      throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS must not contain private key material");
    }
    if (seen.has(jwk.kid)) throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS contains a duplicate kid");
    seen.add(jwk.kid);
    return { ...jwk, alg: "ES256", use: "sig", key_ops: ["verify"] };
  });
  if (!seen.has(activeKeyId)) {
    throw new SpacesConfigurationError("SPACES_SIGNING_PUBLIC_JWKS must contain SPACES_SIGNING_KID");
  }
  return { keys };
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) throw new SpacesConfigurationError(`${name} is required`);
  return value.trim();
}

function httpOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpacesConfigurationError(`${name} must be an absolute URL`);
  }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname)))
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new SpacesConfigurationError(`${name} must be an HTTPS origin or local HTTP origin`);
  }
  return url.origin;
}

function httpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpacesConfigurationError(`${name} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new SpacesConfigurationError(`${name} must be an HTTPS URL without credentials, query, or fragment`);
  }
  return url.toString().replace(/\/$/, "");
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new SpacesConfigurationError(`Numeric configuration must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}
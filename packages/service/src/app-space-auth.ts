import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import {
  CapabilityAlgorithm,
  CapabilityAuthenticationError,
  CapabilityAuthorizationError,
  SpaceCapabilityVersion,
  spaceCasManagePermission,
  spaceCasReadPermission,
  spaceCasWritePermission,
  validateRefDomainClaim,
  type AppSpaceRoute,
} from "@unicas/tenant-protocol";
import type { JwksFetcher } from "./tenant-auth.js";

export interface ResolvedAppAuthority {
  readonly appId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly capabilityMaxLifetimeSeconds: number;
}

export interface AppAuthorityResolver {
  resolveIssuer(issuer: string): Promise<ResolvedAppAuthority | null>;
}

export interface AppSpaceAuthEvent {
  readonly kind: "authorized" | "rejected" | "registry_stale" | "fail_closed";
  readonly operation: AppSpaceRoute["operation"] | "unknown";
  readonly appId?: string;
  readonly spaceId?: string;
  readonly issuer?: string;
  readonly kid?: string;
  readonly jti?: string;
  readonly reason?: string;
}

export interface AppSpaceVerifierOptions {
  readonly repository: AppAuthorityResolver;
  readonly allowedAlgorithms?: readonly string[];
  readonly cacheTtlMs?: number;
  readonly hardStaleBoundMs?: number;
  readonly jwksFetcher?: JwksFetcher;
  readonly now?: () => number;
  readonly onEvent?: (event: AppSpaceAuthEvent) => void;
}

export interface VerifiedAppSpaceCall {
  readonly appId: string;
  readonly spaceId: string;
  readonly subject: string;
  readonly jti: string;
  readonly kid: string;
  readonly permissions: readonly string[];
  readonly refDomain?: string;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_HARD_STALE_BOUND_MS = 60_000;
const CLOCK_TOLERANCE_SECONDS = 30;

export class AppSpaceCapabilityVerifier {
  readonly #repository: AppAuthorityResolver;
  readonly #algorithms: string[];
  readonly #cacheTtlMs: number;
  readonly #hardStaleBoundMs: number;
  readonly #jwksFetcher: JwksFetcher | undefined;
  readonly #now: () => number;
  readonly #onEvent: (event: AppSpaceAuthEvent) => void;
  readonly #authorityCache = new Map<string, CachedAppAuthority>();
  readonly #remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(options: AppSpaceVerifierOptions) {
    this.#repository = options.repository;
    this.#algorithms = [...(options.allowedAlgorithms ?? [CapabilityAlgorithm])];
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#hardStaleBoundMs = options.hardStaleBoundMs ?? DEFAULT_HARD_STALE_BOUND_MS;
    if (this.#cacheTtlMs >= this.#hardStaleBoundMs) {
      throw new TypeError("cacheTtlMs must be below hardStaleBoundMs");
    }
    this.#jwksFetcher = options.jwksFetcher;
    this.#now = options.now ?? (() => Date.now());
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  async verify(request: Request, route: AppSpaceRoute): Promise<VerifiedAppSpaceCall> {
    let capability: VerifiedAppSpacePayload;
    try {
      capability = await this.#verifyToken(request, route);
    } catch (error) {
      this.#onEvent({
        kind: "rejected",
        operation: route.operation,
        appId: route.appId,
        spaceId: route.spaceId,
        reason: error instanceof Error ? error.message : "authorization failed",
      });
      throw error;
    }
    this.#onEvent({
      kind: "authorized",
      operation: route.operation,
      appId: capability.appId,
      spaceId: capability.spaceId,
      issuer: capability.issuer,
      kid: capability.kid,
      jti: capability.jti,
    });
    return {
      appId: capability.appId,
      spaceId: capability.spaceId,
      subject: capability.subject,
      jti: capability.jti,
      kid: capability.kid,
      permissions: capability.permissions,
      ...(capability.refDomain === undefined ? {} : { refDomain: capability.refDomain }),
    };
  }

  async #verifyToken(request: Request, route: AppSpaceRoute): Promise<VerifiedAppSpacePayload> {
    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      throw new CapabilityAuthenticationError("missing_token", "CAS capability token is required");
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
      throw new CapabilityAuthenticationError("invalid_token", "CAS authorization header is invalid");
    }
    const token = match[1]!;

    let unverifiedIssuer: unknown;
    let kid: string | undefined;
    let algorithm: string | undefined;
    try {
      unverifiedIssuer = decodeJwt(token).iss;
      const header = decodeProtectedHeader(token);
      kid = typeof header.kid === "string" ? header.kid : undefined;
      algorithm = typeof header.alg === "string" ? header.alg : undefined;
    } catch {
      throw new CapabilityAuthenticationError("invalid_token", "CAS capability token is malformed");
    }
    if (typeof unverifiedIssuer !== "string" || unverifiedIssuer.length === 0 || !kid || !algorithm) {
      throw new CapabilityAuthenticationError("invalid_token", "CAS capability token is missing issuer or key id");
    }
    if (!this.#algorithms.includes(algorithm)) {
      throw new CapabilityAuthorizationError(
        "unsupported_algorithm",
        `CAS capability algorithm ${algorithm} is not allowed`,
      );
    }

    const authority = await this.#resolveAuthority(unverifiedIssuer);
    if (!authority) {
      throw new CapabilityAuthenticationError("unknown_issuer", "CAS capability issuer is not registered");
    }
    const keySet = this.#remoteKeySet(authority.jwksUri);
    let payload: Omit<VerifiedAppSpacePayload, "appId" | "kid">;
    let lifetimeSeconds = 0;
    try {
      const result = await jwtVerify(token, keySet, {
        algorithms: this.#algorithms,
        issuer: authority.issuer,
        audience: authority.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: new Date(this.#now()),
        requiredClaims: ["ver", "sub", "iat", "nbf", "exp", "jti", "spaceId", "permissions"],
      });
      payload = normalizeAppSpacePayload(result.payload);
      lifetimeSeconds = Number(result.payload.exp) - Number(result.payload.iat);
    } catch (error) {
      if (error instanceof CapabilityAuthenticationError
        || error instanceof CapabilityAuthorizationError) {
        throw error;
      }
      throw new CapabilityAuthenticationError("invalid_token", "CAS capability token verification failed");
    }

    if (lifetimeSeconds > authority.capabilityMaxLifetimeSeconds) {
      throw new CapabilityAuthenticationError(
        "invalid_token",
        "CAS capability lifetime exceeds the App's configured maximum",
      );
    }
    if (authority.appId !== route.appId) {
      throw new CapabilityAuthorizationError(
        "resource_scope_mismatch",
        "CAS capability App does not match the requested path",
      );
    }
    if (payload.spaceId !== route.spaceId) {
      throw new CapabilityAuthorizationError(
        "resource_scope_mismatch",
        "CAS capability Space does not match the requested path",
      );
    }

    const permission = appSpacePermissionFor(route);
    if (!payload.permissions.includes(permission)) {
      throw new CapabilityAuthorizationError(
        "insufficient_permission",
        `CAS ${route.operation} requires ${permission}`,
      );
    }

    let refDomain: string | undefined;
    if (route.operation === "listRootRefs" || route.operation === "updateRootRefs") {
      refDomain = this.#requireValidRefDomain(payload);
    }
    return { ...payload, appId: authority.appId, kid, refDomain };
  }

  #remoteKeySet(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
    const cached = this.#remoteKeySets.get(jwksUri);
    if (cached) return cached;
    const keySet = createRemoteJWKSet(new URL(jwksUri), this.#jwksFetcher
      ? { [customFetch]: this.#jwksFetcher }
      : undefined);
    this.#remoteKeySets.set(jwksUri, keySet);
    return keySet;
  }

  async #resolveAuthority(issuer: string): Promise<ResolvedAppAuthority | null> {
    const now = this.#now();
    const cached = this.#authorityCache.get(issuer);
    if (cached) {
      const age = now - cached.fetchedAt;
      if (age < this.#cacheTtlMs) return cached.authority;
      if (age >= this.#hardStaleBoundMs) {
        try {
          const fresh = await this.#repository.resolveIssuer(issuer);
          if (fresh) {
            this.#remoteKeySets.delete(cached.authority.jwksUri);
            this.#authorityCache.set(issuer, { authority: fresh, fetchedAt: now });
            return fresh;
          }
          this.#authorityCache.delete(issuer);
          throw new CapabilityAuthenticationError("unknown_issuer", "CAS capability issuer is not registered");
        } catch (error) {
          if (error instanceof CapabilityAuthenticationError) throw error;
          this.#authorityCache.delete(issuer);
          this.#onEvent({
            kind: "fail_closed",
            operation: "unknown",
            issuer,
            reason: "authority registry unreachable past the hard stale bound",
          });
          throw new CapabilityAuthenticationError("registry_unavailable", "CAS authority registry is unavailable");
        }
      }
      try {
        const fresh = await this.#repository.resolveIssuer(issuer);
        if (fresh) {
          this.#remoteKeySets.delete(cached.authority.jwksUri);
          this.#authorityCache.set(issuer, { authority: fresh, fetchedAt: now });
          return fresh;
        }
        this.#authorityCache.delete(issuer);
        throw new CapabilityAuthenticationError("unknown_issuer", "CAS capability issuer is not registered");
      } catch (error) {
        if (error instanceof CapabilityAuthenticationError) throw error;
        this.#onEvent({
          kind: "registry_stale",
          operation: "unknown",
          issuer,
          reason: "authority registry unreachable; serving cached record within the stale bound",
        });
        return cached.authority;
      }
    }
    const authority = await this.#repository.resolveIssuer(issuer).catch(() => null);
    if (!authority) return null;
    this.#authorityCache.set(issuer, { authority, fetchedAt: now });
    return authority;
  }

  #requireValidRefDomain(
    payload: Omit<VerifiedAppSpacePayload, "appId" | "kid">,
  ): string {
    const claimed = payload.refDomain;
    if (claimed === undefined) {
      throw new CapabilityAuthorizationError(
        "resource_scope_mismatch",
        "Root Refs write requires a refDomain claim",
      );
    }
    const error = validateRefDomainClaim(claimed);
    if (error) {
      throw new CapabilityAuthorizationError("resource_scope_mismatch", error);
    }
    return claimed;
  }
}

export function appSpacePermissionFor(route: AppSpaceRoute): string {
  switch (route.operation) {
    case "readContent":
    case "readMetadata":
    case "listRootRefs":
      return spaceCasReadPermission(route.spaceId);
    case "lease":
    case "updateRootRefs":
      return spaceCasWritePermission(route.spaceId);
    case "usage":
    case "gc":
      return spaceCasManagePermission(route.spaceId);
  }
}

interface VerifiedAppSpacePayload {
  readonly subject: string;
  readonly jti: string;
  readonly spaceId: string;
  readonly permissions: readonly string[];
  readonly issuer: string;
  readonly refDomain?: string;
  readonly appId: string;
  readonly kid: string;
}

interface CachedAppAuthority {
  readonly authority: ResolvedAppAuthority;
  readonly fetchedAt: number;
}

function normalizeAppSpacePayload(payload: {
  ver?: unknown;
  sub?: unknown;
  jti?: unknown;
  spaceId?: unknown;
  permissions?: unknown;
  iss?: unknown;
  refDomain?: unknown;
}): Omit<VerifiedAppSpacePayload, "appId" | "kid"> {
  if (payload.ver !== SpaceCapabilityVersion) {
    throw new CapabilityAuthenticationError(
      "invalid_token",
      `CAS capability version is invalid (expected ${SpaceCapabilityVersion})`,
    );
  }
  if (
    typeof payload.sub !== "string" || payload.sub.length === 0
    || typeof payload.jti !== "string" || payload.jti.length === 0
    || typeof payload.spaceId !== "string" || payload.spaceId.length === 0
    || typeof payload.iss !== "string"
    || !Array.isArray(payload.permissions)
    || payload.permissions.some((permission) => typeof permission !== "string")
  ) {
    throw new CapabilityAuthenticationError("invalid_token", "CAS capability claims are invalid");
  }
  const refDomain = payload.refDomain;
  if (refDomain !== undefined && typeof refDomain !== "string") {
    throw new CapabilityAuthenticationError("invalid_token", "CAS capability refDomain is invalid");
  }
  return {
    subject: payload.sub,
    jti: payload.jti,
    spaceId: payload.spaceId,
    permissions: payload.permissions as readonly string[],
    issuer: payload.iss,
    ...(typeof refDomain === "string" ? { refDomain } : {}),
  };
}
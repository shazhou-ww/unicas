import type { JWTHeaderParameters } from "jose";

export function canonicalPermissionSegment(value: string): string {
  if (value.length === 0) throw new TypeError("Capability resource IDs must not be empty");
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export const CapabilityAlgorithm = "ES256" as const;
export const CapabilityTokenType = "unidocs-cap+jwt" as const;
export const DefaultCapabilityLifetimeSeconds = 120;
export const MaximumCapabilityLifetimeSeconds = 7 * 24 * 60 * 60;
export const MaximumCapabilityClockSkewSeconds = 30;

export interface CapabilityProtectedHeader extends JWTHeaderParameters {
  readonly alg: typeof CapabilityAlgorithm;
  readonly kid: string;
  readonly typ: typeof CapabilityTokenType;
}

export const REF_DOMAIN_MAX_LENGTH = 64;
export const REF_DOMAIN_PATTERN = /^[a-z][a-z0-9]*(?::[a-z0-9]+)*$/;

export function isReservedRefDomain(domain: string): boolean {
  return domain === "_legacy" || domain.startsWith("_");
}

export function validateRefDomainClaim(value: unknown): string | null {
  if (typeof value !== "string") return "refDomain must be a string";
  if (value.length === 0) return "refDomain must not be empty";
  if (value.length > REF_DOMAIN_MAX_LENGTH) {
    return `refDomain must be at most ${REF_DOMAIN_MAX_LENGTH} characters`;
  }
  if (!REF_DOMAIN_PATTERN.test(value)) {
    return "refDomain must be lowercase segments of letters/digits joined by ':'";
  }
  if (isReservedRefDomain(value)) return `refDomain '${value}' is reserved`;
  return null;
}

export type CapabilityErrorCode =
  | "invalid_token"
  | "missing_token"
  | "insufficient_permission"
  | "resource_scope_mismatch"
  | "unknown_issuer"
  | "registry_unavailable"
  | "unsupported_algorithm"
  | "APP_SUSPENDED";

export abstract class CapabilityError extends Error {
  abstract readonly status: 401 | 403;
  readonly code: CapabilityErrorCode;

  protected constructor(code: CapabilityErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class CapabilityAuthenticationError extends CapabilityError {
  readonly status = 401 as const;

  constructor(
    code: "invalid_token" | "missing_token" | "unknown_issuer" | "registry_unavailable",
    message: string,
  ) {
    super(code, message);
    this.name = "CapabilityAuthenticationError";
  }
}

export class CapabilityAuthorizationError extends CapabilityError {
  readonly status = 403 as const;

  constructor(
    code:
      | "insufficient_permission"
      | "resource_scope_mismatch"
      | "unsupported_algorithm"
      | "registry_unavailable"
      | "APP_SUSPENDED",
    message: string,
  ) {
    super(code, message);
    this.name = "CapabilityAuthorizationError";
  }
}
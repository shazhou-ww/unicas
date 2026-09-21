import type { JWTPayload } from "jose";
import {
  canonicalPermissionSegment,
  type CapabilityProtectedHeader,
} from "../shared-capability.js";

export {
  CapabilityAlgorithm,
  CapabilityAuthenticationError,
  CapabilityAuthorizationError,
  CapabilityError,
  CapabilityTokenType,
  DefaultCapabilityLifetimeSeconds,
  MaximumCapabilityClockSkewSeconds,
  MaximumCapabilityLifetimeSeconds,
  REF_DOMAIN_MAX_LENGTH,
  REF_DOMAIN_PATTERN,
  canonicalPermissionSegment,
  isReservedRefDomain,
  validateRefDomainClaim,
} from "../shared-capability.js";
export type {
  CapabilityErrorCode,
  CapabilityProtectedHeader,
} from "../shared-capability.js";

declare const capabilityPermissionBrand: unique symbol;

export type CapabilityPermission = string & {
  readonly [capabilityPermissionBrand]: true;
};

export type CapabilityPermissionKind =
  | "cas:read"
  | "cas:write"
  | "cas:manage"
  | "sessions:create"
  | "sessions:read"
  | "sessions:write";

export type ParsedCapabilityPermission = {
  readonly kind: CapabilityPermissionKind;
  readonly tenantId: string;
  readonly sessionId?: string;
};

export function casReadPermission(tenantId: string): CapabilityPermission {
  return tenantPermission(tenantId, "cas:read");
}

export function casWritePermission(tenantId: string): CapabilityPermission {
  return tenantPermission(tenantId, "cas:write");
}

export function casManagePermission(tenantId: string): CapabilityPermission {
  return tenantPermission(tenantId, "cas:manage");
}

export function sessionCreatePermission(tenantId: string): CapabilityPermission {
  return tenantPermission(tenantId, "sessions:create");
}

export function sessionReadPermission(
  tenantId: string,
  sessionId: string,
): CapabilityPermission {
  return sessionPermission(tenantId, sessionId, "read");
}

export function sessionWritePermission(
  tenantId: string,
  sessionId: string,
): CapabilityPermission {
  return sessionPermission(tenantId, sessionId, "write");
}

export function parseCapabilityPermission(
  permission: string,
): ParsedCapabilityPermission | null {
  const parts = permission.split(":");
  if (parts[0] !== "tenants") return null;
  const tenantId = decodeCanonicalSegment(parts[1]);
  if (tenantId === null) return null;

  if (parts.length === 4 && parts[2] === "cas") {
    const action = parts[3];
    if (action === "read" || action === "write") {
      return { kind: `cas:${action}`, tenantId };
    }
    if (action === "manage") return { kind: "cas:manage", tenantId };
    return null;
  }
  if (parts.length === 4 && parts[2] === "sessions" && parts[3] === "create") {
    return { kind: "sessions:create", tenantId };
  }
  if (parts.length === 5 && parts[2] === "sessions") {
    const sessionId = decodeCanonicalSegment(parts[3]);
    const action = parts[4];
    if (sessionId !== null && (action === "read" || action === "write")) {
      return { kind: `sessions:${action}`, tenantId, sessionId };
    }
  }
  return null;
}

export function hasCapabilityPermission(
  permissions: readonly string[],
  expected: CapabilityPermission,
): boolean {
  return permissions.includes(expected);
}

function tenantPermission(
  tenantId: string,
  suffix: "cas:read" | "cas:write" | "cas:manage" | "sessions:create",
): CapabilityPermission {
  return `tenants:${canonicalPermissionSegment(tenantId)}:${suffix}` as CapabilityPermission;
}

function sessionPermission(
  tenantId: string,
  sessionId: string,
  action: "read" | "write",
): CapabilityPermission {
  return `tenants:${canonicalPermissionSegment(tenantId)}:sessions:${canonicalPermissionSegment(sessionId)}:${action}` as CapabilityPermission;
}

function decodeCanonicalSegment(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && canonicalPermissionSegment(decoded) === value
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export const CapabilityVersion = 1 as const;

export interface CapabilityClaimsBase extends JWTPayload {
  readonly ver: typeof CapabilityVersion;
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
  readonly tenantId: string;
  readonly permissions: readonly CapabilityPermission[];
  readonly refDomain?: string;
}

export interface TenantCapabilityClaims extends CapabilityClaimsBase {
  readonly sessionId?: never;
}

export interface SessionCapabilityClaims extends CapabilityClaimsBase {
  readonly sessionId: string;
}

export type CapabilityClaims = TenantCapabilityClaims | SessionCapabilityClaims;

export interface VerifiedCapability {
  readonly protectedHeader: CapabilityProtectedHeader;
  readonly claims: CapabilityClaims;
}
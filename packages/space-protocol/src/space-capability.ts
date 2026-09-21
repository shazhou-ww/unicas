import type { JWTPayload } from "jose";
import type { CapabilityProtectedHeader } from "./shared-capability.js";

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
} from "./shared-capability.js";
export type {
  CapabilityErrorCode,
  CapabilityProtectedHeader,
} from "./shared-capability.js";

declare const spaceCapabilityPermissionBrand: unique symbol;

export type SpaceCapabilityPermission = string & {
  readonly [spaceCapabilityPermissionBrand]: true;
};

export type SpaceCapabilityPermissionKind =
  | "cas:nodes:read"
  | "cas:nodes:lease"
  | "cas:root-refs:read"
  | "cas:root-refs:update"
  | "cas:usage:read"
  | "cas:gc:execute";

export type ParsedSpaceCapabilityPermission = {
  readonly kind: SpaceCapabilityPermissionKind;
};

export function spaceNodeReadPermission(): SpaceCapabilityPermission {
  return spaceOperationPermission("cas:nodes:read");
}

export function spaceNodeLeasePermission(): SpaceCapabilityPermission {
  return spaceOperationPermission("cas:nodes:lease");
}

export function spaceRootRefsReadPermission(): SpaceCapabilityPermission {
  return spaceOperationPermission("cas:root-refs:read");
}

export function spaceRootRefsUpdatePermission(): SpaceCapabilityPermission {
  return spaceOperationPermission("cas:root-refs:update");
}

export function spaceUsageReadPermission(): SpaceCapabilityPermission {
  return spaceOperationPermission("cas:usage:read");
}

export function spaceGcExecutePermission(): SpaceCapabilityPermission {
  return spaceOperationPermission("cas:gc:execute");
}

export function parseSpaceCapabilityPermission(
  permission: string,
): ParsedSpaceCapabilityPermission | null {
  switch (permission) {
    case "cas:nodes:read":
    case "cas:nodes:lease":
    case "cas:root-refs:read":
    case "cas:root-refs:update":
    case "cas:usage:read":
    case "cas:gc:execute":
      return { kind: permission };
    default:
      return null;
  }
}

function spaceOperationPermission(
  kind: SpaceCapabilityPermissionKind,
): SpaceCapabilityPermission {
  return kind as SpaceCapabilityPermission;
}

export const SpaceCapabilityVersion = 1 as const;

export interface SpaceCapabilityClaims extends JWTPayload {
  readonly ver: typeof SpaceCapabilityVersion;
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
  readonly spaceId: string;
  readonly permissions: readonly SpaceCapabilityPermission[];
  readonly refDomain?: string;
}

export interface VerifiedSpaceCapability {
  readonly protectedHeader: CapabilityProtectedHeader;
  readonly claims: SpaceCapabilityClaims;
}
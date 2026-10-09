import { z } from "zod";
import {
  REF_DOMAIN_MAX_LENGTH,
  REF_DOMAIN_PATTERN,
  type CapabilityProtectedHeader,
} from "./shared-capability.js";
import type { AppSpaceRoute } from "./routes.js";

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

export const SpaceCapabilityPermissionKinds = [
  "cas:nodes:read",
  "cas:nodes:lease",
  "cas:root-refs:read",
  "cas:root-refs:update",
  "cas:usage:read",
  "cas:gc:execute",
] as const;

export type SpaceCapabilityPermissionKind =
  (typeof SpaceCapabilityPermissionKinds)[number];

export type ParsedSpaceCapabilityPermission = {
  readonly kind: SpaceCapabilityPermissionKind;
};

export function spaceNodeReadPermission(): SpaceCapabilityPermission {
  return spaceOperationPermission(SpaceOperationPolicies.readContent.permission);
}

export function spaceNodeLeasePermission(): SpaceCapabilityPermission {
  return spaceOperationPermission(SpaceOperationPolicies.lease.permission);
}

export function spaceRootRefsReadPermission(): SpaceCapabilityPermission {
  return spaceOperationPermission(SpaceOperationPolicies.listRootRefs.permission);
}

export function spaceRootRefsUpdatePermission(): SpaceCapabilityPermission {
  return spaceOperationPermission(SpaceOperationPolicies.updateRootRefs.permission);
}

export function spaceUsageReadPermission(): SpaceCapabilityPermission {
  return spaceOperationPermission(SpaceOperationPolicies.usage.permission);
}

export function spaceGcExecutePermission(): SpaceCapabilityPermission {
  return spaceOperationPermission(SpaceOperationPolicies.gc.permission);
}

export function parseSpaceCapabilityPermission(
  permission: string,
): ParsedSpaceCapabilityPermission | null {
  if (!(SpaceCapabilityPermissionKinds as readonly string[]).includes(permission)) {
    return null;
  }
  return { kind: permission as SpaceCapabilityPermissionKind };
}

function spaceOperationPermission(
  kind: SpaceCapabilityPermissionKind,
): SpaceCapabilityPermission {
  return kind as SpaceCapabilityPermission;
}

export const SpaceCapabilityVersion = 1 as const;

export const SpaceRefDomainClaimSchema = z.string()
  .max(REF_DOMAIN_MAX_LENGTH)
  .regex(REF_DOMAIN_PATTERN)
  .describe("Root Ref business namespace required by Root Ref operations.");

export const SpaceCapabilityClaimsSchema = z.object({
  ver: z.literal(SpaceCapabilityVersion),
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1).readonly(),
  ]),
  iat: z.number(),
  nbf: z.number(),
  exp: z.number(),
  jti: z.string().min(1),
  spaceId: z.string().min(1),
  permissions: z.array(z.enum(SpaceCapabilityPermissionKinds)).readonly(),
  refDomain: z.string().optional(),
}).passthrough().readonly().meta({ id: "SpaceCapabilityClaims" });

export type SpaceCapabilityClaims =
  Omit<z.infer<typeof SpaceCapabilityClaimsSchema>, "permissions">
  & { readonly permissions: readonly SpaceCapabilityPermission[] };

type SpaceOperationPolicyDefinition = {
  readonly operationId: string;
  readonly permission: SpaceCapabilityPermissionKind;
  readonly requiredClaims: readonly ("spaceId" | "refDomain")[];
};

export const SpaceOperationPolicies = {
  readContent: {
    operationId: "readContent",
    permission: "cas:nodes:read",
    requiredClaims: ["spaceId"],
  },
  readMetadata: {
    operationId: "readMetadata",
    permission: "cas:nodes:read",
    requiredClaims: ["spaceId"],
  },
  lease: {
    operationId: "leaseNode",
    permission: "cas:nodes:lease",
    requiredClaims: ["spaceId"],
  },
  usage: {
    operationId: "getUsage",
    permission: "cas:usage:read",
    requiredClaims: ["spaceId"],
  },
  gc: {
    operationId: "runGc",
    permission: "cas:gc:execute",
    requiredClaims: ["spaceId"],
  },
  listRootRefs: {
    operationId: "listRootRefs",
    permission: "cas:root-refs:read",
    requiredClaims: ["spaceId", "refDomain"],
  },
  updateRootRefs: {
    operationId: "updateRootRefs",
    permission: "cas:root-refs:update",
    requiredClaims: ["spaceId", "refDomain"],
  },
} as const satisfies Record<AppSpaceRoute["operation"], SpaceOperationPolicyDefinition>;

export type SpaceOperationPolicy =
  (typeof SpaceOperationPolicies)[keyof typeof SpaceOperationPolicies];

export function spaceOperationPolicyFor<TOperation extends AppSpaceRoute["operation"]>(
  operation: TOperation,
): (typeof SpaceOperationPolicies)[TOperation] {
  return SpaceOperationPolicies[operation];
}

export interface VerifiedSpaceCapability {
  readonly protectedHeader: CapabilityProtectedHeader;
  readonly claims: SpaceCapabilityClaims;
}
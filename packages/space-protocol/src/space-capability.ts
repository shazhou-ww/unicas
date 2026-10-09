import { z } from "zod";
import {
  REF_DOMAIN_MAX_LENGTH,
  REF_DOMAIN_PATTERN,
  type CapabilityProtectedHeader,
} from "./shared-capability.js";
import type { AppSpaceRoute } from "./routes.js";
import {
  parseSpaceSelector,
  SPACE_SELECTOR_MAX_LENGTH,
  type SpaceSelector,
} from "./space-id.js";

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

export const SpaceCapabilityVersion = 2 as const;
export const MaximumSpaceCapabilityGrants = 32;

export interface SpaceCapabilityGrant {
  readonly selector: SpaceSelector;
  readonly permissions: readonly SpaceCapabilityPermission[];
}

export const SpaceRefDomainClaimSchema = z.string()
  .max(REF_DOMAIN_MAX_LENGTH)
  .regex(REF_DOMAIN_PATTERN)
  .describe("Root Ref business namespace required by Root Ref operations.");

const SpaceSelectorClaimSchema = z.string()
  .min(1)
  .max(SPACE_SELECTOR_MAX_LENGTH)
  .refine(selector => parseSpaceSelector(selector) !== null)
  .describe("Exact, terminal segment-prefix, or terminal recursive-prefix Space selector.");

const SpaceCapabilityGrantSchema = z.object({
  selector: SpaceSelectorClaimSchema,
  permissions: z.array(z.enum(SpaceCapabilityPermissionKinds)).min(1).readonly(),
}).readonly();

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
  grants: z.array(SpaceCapabilityGrantSchema)
    .min(1)
    .max(MaximumSpaceCapabilityGrants)
    .readonly(),
  refDomain: z.string().optional(),
}).passthrough().readonly().meta({ id: "SpaceCapabilityClaims" });

export type SpaceCapabilityClaims =
  Omit<z.infer<typeof SpaceCapabilityClaimsSchema>, "grants">
  & { readonly grants: readonly SpaceCapabilityGrant[] };

type SpaceOperationPolicyDefinition = {
  readonly operationId: string;
  readonly permission: SpaceCapabilityPermissionKind;
  readonly requiredClaims: readonly ("grants" | "refDomain")[];
};

export const SpaceOperationPolicies = {
  readContent: {
    operationId: "readContent",
    permission: "cas:nodes:read",
    requiredClaims: ["grants"],
  },
  readMetadata: {
    operationId: "readMetadata",
    permission: "cas:nodes:read",
    requiredClaims: ["grants"],
  },
  lease: {
    operationId: "leaseNode",
    permission: "cas:nodes:lease",
    requiredClaims: ["grants"],
  },
  usage: {
    operationId: "getUsage",
    permission: "cas:usage:read",
    requiredClaims: ["grants"],
  },
  gc: {
    operationId: "runGc",
    permission: "cas:gc:execute",
    requiredClaims: ["grants"],
  },
  listRootRefs: {
    operationId: "listRootRefs",
    permission: "cas:root-refs:read",
    requiredClaims: ["grants", "refDomain"],
  },
  updateRootRefs: {
    operationId: "updateRootRefs",
    permission: "cas:root-refs:update",
    requiredClaims: ["grants", "refDomain"],
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
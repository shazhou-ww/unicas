/**
 * @unicas/space-protocol — CAS Space data-plane HTTP contracts.
 *
 * HTTP request/response types, route definitions, and the CAS capability
 * claim vocabulary. Wire encodings (node binary format, digest, blob index)
 * live in @unicas/codec and are intentionally NOT re-exported here.
 */

export {
  DefaultSpaceNodeLeaseDurationMs,
  SpaceApiBasePath,
  SpaceApiErrorMap,
  spaceApiContract,
} from "./space-v2-contract.js";
export type { SpaceApiContract } from "./space-v2-contract.js";

export type {
  AppId,
  CasGcResult,
  CasHash,
  CasLeaseOperationResult,
  CasLeaseResult,
  CasNode,
  CasNodeDescriptor,
  CasNodeMetadata,
  CasNodeState,
  CasRefChanges,
  CasReferences,
  CasRootRefBalance,
  CasRootRefsPage,
  CasRootRefUpdate,
  CasUploadRequiredResult,
  CasUsage,
  Space,
  SpaceId,
  SpaceNodeLeaseAwaitingReplacementUploadResult,
  SpaceNodeLeaseAwaitingUploadResult,
  SpaceNodeLeaseReadyResult,
  SpaceNodeLeaseRequest,
  SpaceNodeLeaseResult,
  SpaceNodeLeaseValidatedAwaitingChildrenResult,
  SpaceNodeUploadInstructions,
  SpaceNodeUploadRejection,
  SpaceNodeUploadRejectionCode,
} from "./types.js";

export {
  AppIdSchema,
  CasGcResultSchema,
  CasHashSchema,
  CasLeaseOperationResultSchema,
  CasLeaseResultSchema,
  CasNodeDescriptorSchema,
  CasNodeMetadataSchema,
  CasNodeSchema,
  CasNodeStateSchema,
  CasRefChangesSchema,
  CasReferencesSchema,
  CasRootRefBalanceSchema,
  CasRootRefsPageSchema,
  CasRootRefUpdateSchema,
  CasUploadRequiredResultSchema,
  CasUsageSchema,
  SpaceIdSchema,
  SpaceSchema,
} from "./schemas.js";

export {
  CasLeaseDurationHeader,
  CasUploadIdHeader,
  CasUploadLengthHeader,
} from "./http.js";
export type { CasErrorResponse } from "./http.js";

export { appSpaceRoutes, matchAppSpaceRoute } from "./routes.js";
export type { AppSpaceRoute } from "./routes.js";

// Space capability claim vocabulary
export {
  canonicalPermissionSegment,
  parseSpaceCapabilityPermission,
  spaceGcExecutePermission,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  spaceUsageReadPermission,
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  DefaultCapabilityLifetimeSeconds,
  isReservedRefDomain,
  MaximumCapabilityClockSkewSeconds,
  MaximumCapabilityLifetimeSeconds,
  REF_DOMAIN_MAX_LENGTH,
  REF_DOMAIN_PATTERN,
  validateRefDomainClaim,
  CapabilityAuthenticationError,
  CapabilityAuthorizationError,
  CapabilityError,
} from "./space-capability.js";
export type {
  CapabilityErrorCode,
  CapabilityProtectedHeader,
  ParsedSpaceCapabilityPermission,
  SpaceCapabilityClaims,
  SpaceCapabilityPermission,
  SpaceCapabilityPermissionKind,
  VerifiedSpaceCapability,
} from "./space-capability.js";

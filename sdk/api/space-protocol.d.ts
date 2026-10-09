/**
 * @unicas/space-protocol — CAS Space data-plane HTTP contracts.
 *
 * HTTP request/response types, route definitions, and the CAS capability
 * claim vocabulary. Wire encodings (node binary format, digest, blob index)
 * live in @unicas/codec and are intentionally NOT re-exported here.
 */
export { DefaultSpaceNodeLeaseDurationMs, SpaceApiBasePath, SpaceApiErrorMap, SpaceApiStableErrorMap, SpaceApiStableErrorCodesByStatus, SpaceReadContentHttpContract, SpaceReadContentRangeNotSatisfiable, spaceApiContract, } from "./space-contract.js";
export type { SpaceApiContract, SpaceApiStableErrorCode, SpaceReadContentHttpResponse, SpaceReadContentResponseHeaders, } from "./space-contract.js";
export type { AppId, CasGcResult, CasHash, CasLeaseOperationResult, CasLeaseResult, CasNode, CasNodeDescriptor, CasNodeMetadata, CasNodeState, CasRefChanges, CasReferences, CasRootRefBalance, CasRootRefsPage, CasRootRefUpdate, CasUploadRequiredResult, CasUsage, Space, SpaceId, SpaceNodeLeaseAwaitingReplacementUploadResult, SpaceNodeLeaseAwaitingUploadResult, SpaceNodeLeaseReadyResult, SpaceNodeLeaseRequest, SpaceNodeLeaseResult, SpaceNodeLeaseValidatedAwaitingChildrenResult, SpaceNodeUploadInstructions, SpaceNodeUploadRejection, SpaceNodeUploadRejectionCode, } from "./types.js";
export { AppIdSchema, CAS_MAX_REQUEST_ID_LENGTH, CAS_MAX_ROOT_REF_CHANGES, CAS_MAX_ROOT_REF_DELTA, CasGcResultSchema, CasHashSchema, CasLeaseOperationResultSchema, CasLeaseResultSchema, CasNodeDescriptorSchema, CasNodeMetadataSchema, CasNodeSchema, CasNodeStateSchema, CasRefChangesSchema, CasReferencesSchema, CasRootRefBalanceSchema, CasRootRefsPageSchema, CasRootRefUpdateSchema, CasUploadRequiredResultSchema, CasUsageSchema, SpaceIdSchema, SpaceSchema, } from "./schemas.js";
export { CasNodeRefsHeader, formatCasNodeRefsHeader, parseCasNodeRefsHeader, } from "./http.js";
export type { CasErrorResponse } from "./http.js";
export { appSpaceRoutes, matchAppSpaceRoute } from "./routes.js";
export type { AppSpaceRoute } from "./routes.js";
export { parseSpaceSelector, spaceSelectorMatches, validateSpaceId, SPACE_ID_MAX_LENGTH, SPACE_ID_PATTERN, SPACE_SELECTOR_MAX_LENGTH, } from "./space-id.js";
export type { ParsedSpaceSelector, SpaceSelector, SpaceSelectorKind, } from "./space-id.js";
export { canonicalPermissionSegment, parseSpaceCapabilityPermission, spaceOperationPolicyFor, spaceGcExecutePermission, spaceNodeLeasePermission, spaceNodeReadPermission, spaceRootRefsReadPermission, spaceRootRefsUpdatePermission, spaceUsageReadPermission, CapabilityAlgorithm, CapabilityTokenType, MaximumSpaceCapabilityGrants, SpaceCapabilityVersion, SpaceCapabilityClaimsSchema, SpaceCapabilityPermissionKinds, SpaceOperationPolicies, SpaceRefDomainClaimSchema, DefaultCapabilityLifetimeSeconds, isReservedRefDomain, MaximumCapabilityClockSkewSeconds, MaximumCapabilityLifetimeSeconds, REF_DOMAIN_MAX_LENGTH, REF_DOMAIN_PATTERN, validateRefDomainClaim, CapabilityAuthenticationError, CapabilityAuthorizationError, CapabilityError, } from "./space-capability.js";
export type { CapabilityErrorCode, CapabilityProtectedHeader, ParsedSpaceCapabilityPermission, SpaceCapabilityClaims, SpaceCapabilityGrant, SpaceCapabilityPermission, SpaceCapabilityPermissionKind, SpaceOperationPolicy, VerifiedSpaceCapability, } from "./space-capability.js";

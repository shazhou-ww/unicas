/** Functional App-level CAS client for explicit multi-Space operations. */

export type {
  AppCasClient,
  AppCasClientConfig,
  AppCasNodeCacheKey,
  CasGcOptions,
  CasGcResult,
  CasHash,
  CasHttpFetcher,
  CasLeaseOptions,
  CasLeaseResult,
  CasListRootRefsOptions,
  CasNode,
  CasNodeCache,
  CasNodeCacheKey,
  ProvidedSpaceCapability,
  SpaceCapabilityAcquireReason,
  SpaceCapabilityGrantMetadata,
  SpaceCapabilityMetadata,
  SpaceCapabilityProvider,
  SpaceCapabilityRequirement,
  SpaceNodeLeaseOptions,
  CasNodeRange,
  CasNodeSource,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasRootRefsResult,
  CasUsage,
  HttpFetcher,
} from "./types.js";

export type {
  SpaceNodeLeaseResult,
  SpaceNodeUploadInstructions,
  SpaceNodeUploadRejection,
  SpaceNodeUploadRejectionCode,
} from "@unicas/space-protocol";

export {
  createAppCasClient,
  DEFAULT_SPACE_NODE_LEASE_OPTIONS,
} from "./client.js";
export {
  CasCapabilityError,
  CasClientError,
} from "./errors.js";
export type { CasCapabilityErrorCode } from "./errors.js";

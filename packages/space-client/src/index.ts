/** Functional, tenant-bound CAS client. */

export type {
  CasGcOptions,
  CasGcResult,
  CasHash,
  CasHttpFetcher,
  CasLeaseOptions,
  CasLeaseResult,
  CasListRootRefsOptions,
  CasNodeCache,
  CasNodeCacheKey,
  SpaceCasClient,
  SpaceCasClientConfig,
  SpaceCasNodeCacheKey,
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
  createSpaceCasClient,
  DEFAULT_SPACE_NODE_LEASE_OPTIONS,
} from "./client.js";
export { CasClientError } from "./errors.js";

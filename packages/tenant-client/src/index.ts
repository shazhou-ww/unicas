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
  CasNodeRange,
  CasNodeSource,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasRootRefsResult,
  CasUsage,
  HttpFetcher,
  TenantCasClient,
  TenantCasClientConfig,
  TenantCasNodeCacheKey,
} from "./types.js";

export { createSpaceCasClient, createTenantCasClient } from "./client.js";
export { CasClientError } from "./errors.js";

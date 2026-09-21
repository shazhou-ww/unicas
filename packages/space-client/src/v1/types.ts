import type {
  CasClientConfigBase,
  CasClientOperations,
  CasHash,
  CasLeaseOptions,
  CasLeaseResult,
  CasNodeCacheStrategy,
  CasNodeSource,
} from "../shared-types.js";

export type {
  CasGcOptions,
  CasGcResult,
  CasHash,
  CasHttpFetcher,
  CasLeaseOptions,
  CasLeaseResult,
  CasListRootRefsOptions,
  CasNodeMetadata,
  CasNodeRange,
  CasNodeSource,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasRootRefsResult,
  CasUsage,
  HttpFetcher,
} from "../shared-types.js";

export interface TenantCasNodeCacheKey {
  readonly stackId: string;
  readonly tenantId: string;
  readonly hash: CasHash;
}

export type V1CasNodeCache = CasNodeCacheStrategy<TenantCasNodeCacheKey>;

export interface TenantCasClient extends CasClientOperations {
  leaseNode(
    hash: CasHash,
    source?: CasNodeSource,
    options?: CasLeaseOptions,
  ): Promise<CasLeaseResult>;
}

export interface TenantCasClientConfig extends CasClientConfigBase<TenantCasNodeCacheKey> {
  readonly stackId: string;
  readonly tenantId: string;
}
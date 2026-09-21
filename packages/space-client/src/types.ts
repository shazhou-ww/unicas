import type { SpaceNodeLeaseResult } from "@unicas/space-protocol";
import type {
  CasClientConfigBase,
  CasClientOperations,
  CasHash,
  CasNodeCacheStrategy,
  SpaceNodeLeaseOptions,
} from "./shared-types.js";

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
  SpaceNodeLeaseOptions,
} from "./shared-types.js";

export interface SpaceCasNodeCacheKey {
  readonly version: 1;
  readonly appId: string;
  readonly spaceId: string;
  readonly hash: CasHash;
}

export type CasNodeCacheKey = SpaceCasNodeCacheKey;
export type CasNodeCache = CasNodeCacheStrategy<SpaceCasNodeCacheKey>;

export interface SpaceCasClient extends CasClientOperations {
  leaseNode(hash: CasHash): Promise<SpaceNodeLeaseResult>;
  leaseNode(hash: CasHash, options: SpaceNodeLeaseOptions): Promise<SpaceNodeLeaseResult>;
}

export interface SpaceCasClientConfig extends CasClientConfigBase<SpaceCasNodeCacheKey> {
  readonly appId: string;
  readonly spaceId: string;
}
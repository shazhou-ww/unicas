import type {
  SpaceCapabilityPermissionKind,
  SpaceNodeLeaseResult,
  SpaceSelector,
} from "@unicas/space-protocol";
import type {
  CasGcOptions,
  CasGcResult,
  CasHash,
  CasListRootRefsOptions,
  CasNode,
  CasNodeCacheStrategy,
  CasNodeMetadata,
  CasNodeRange,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasRootRefsResult,
  CasUsage,
  HttpFetcher,
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
  CasNode,
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

export interface AppCasNodeCacheKey {
  readonly version: 1;
  readonly appId: string;
  readonly spaceId: string;
  readonly hash: CasHash;
}

export type CasNodeCacheKey = AppCasNodeCacheKey;
export type CasNodeCache = CasNodeCacheStrategy<AppCasNodeCacheKey>;

export interface AppCasClient {
  readNode(
    spaceId: string,
    hash: CasHash,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CasNode>;
  readMetadata(
    spaceId: string,
    hash: CasHash,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CasNodeMetadata>;
  readContent(
    spaceId: string,
    hash: CasHash,
    range?: CasNodeRange,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
  leaseNode(spaceId: string, hash: CasHash): Promise<SpaceNodeLeaseResult>;
  leaseNode(
    spaceId: string,
    hash: CasHash,
    options: SpaceNodeLeaseOptions,
  ): Promise<SpaceNodeLeaseResult>;
  listRootRefs(
    spaceId: string,
    options?: CasListRootRefsOptions,
  ): Promise<CasRootRefsPage>;
  updateRootRefs(
    spaceId: string,
    update: CasRootRefUpdate,
  ): Promise<CasRootRefsResult>;
  usage(spaceId: string, signal?: AbortSignal): Promise<CasUsage>;
  gc(spaceId: string, options?: CasGcOptions): Promise<CasGcResult>;
}

export interface AppCasClientConfig {
  readonly baseUrl: string;
  readonly appId: string;
  readonly capabilityProvider: SpaceCapabilityProvider;
  readonly fetcher?: HttpFetcher;
  readonly cache?: CasNodeCache;
}

export type SpaceCapabilityAcquireReason =
  | "missing"
  | "expiring"
  | "requirement-miss"
  | "server-rejected";

export interface SpaceCapabilityRequirement {
  readonly appId: string;
  readonly spaceId: string;
  readonly permission: SpaceCapabilityPermissionKind;
  readonly reason: SpaceCapabilityAcquireReason;
}

export interface SpaceCapabilityProvider {
  acquire(
    requirement: SpaceCapabilityRequirement,
  ): Promise<ProvidedSpaceCapability>;
}

export interface ProvidedSpaceCapability {
  readonly bearerToken: string;
  readonly metadata: SpaceCapabilityMetadata;
}

export interface SpaceCapabilityMetadata {
  readonly version: 2;
  readonly notBefore?: number;
  readonly expiresAt: number;
  readonly grants: readonly SpaceCapabilityGrantMetadata[];
  readonly refDomain?: string;
}

export interface SpaceCapabilityGrantMetadata {
  readonly selector: SpaceSelector;
  readonly permissions: readonly SpaceCapabilityPermissionKind[];
}
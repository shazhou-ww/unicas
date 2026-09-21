import type {
  CasGcResult,
  CasHash,
  CasLeaseResult,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
  SpaceNodeLeaseResult,
} from "@unicas/tenant-protocol";

export interface HttpFetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export type CasHttpFetcher = HttpFetcher;

export interface CasNodeRange {
  readonly offset: number;
  readonly length?: number;
}

export interface CasNodeSource {
  readonly contentLength: number;
  readonly body: BodyInit;
}

export interface CasLeaseOptions {
  readonly durationMs?: number;
  readonly signal?: AbortSignal;
}

export interface SpaceNodeLeaseOptions {
  readonly durationMs: number;
  readonly signal: AbortSignal | null;
}

export interface CasGcOptions {
  readonly maxNodes?: number;
  readonly signal?: AbortSignal;
}

export interface CasListRootRefsOptions {
  readonly limit?: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface CasRootRefsResult {
  readonly success: boolean;
  readonly idempotent?: boolean;
  readonly revision?: number;
}

export interface TenantCasNodeCacheKey {
  readonly stackId: string;
  readonly tenantId: string;
  readonly hash: CasHash;
}

export interface SpaceCasNodeCacheKey {
  readonly version: 2;
  readonly appId: string;
  readonly spaceId: string;
  readonly hash: CasHash;
}

export type CasNodeCacheKey = TenantCasNodeCacheKey | SpaceCasNodeCacheKey;

/** Strategy for caching immutable node metadata and own-content reads. */
export interface CasNodeCache {
  metadata(
    key: CasNodeCacheKey,
    load: () => Promise<CasNodeMetadata>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CasNodeMetadata>;
  read(
    key: CasNodeCacheKey,
    range: CasNodeRange | undefined,
    load: () => Promise<ReadableStream<Uint8Array>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
}

interface CasClientOperations {
  readMetadata(hash: CasHash, options?: { readonly signal?: AbortSignal }): Promise<CasNodeMetadata>;
  readContent(
    hash: CasHash,
    range?: CasNodeRange,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
  updateRootRefs(update: CasRootRefUpdate): Promise<CasRootRefsResult>;
  listRootRefs(options?: CasListRootRefsOptions): Promise<CasRootRefsPage>;
  usage(signal?: AbortSignal): Promise<CasUsage>;
  gc(options?: CasGcOptions): Promise<CasGcResult>;
}

export interface TenantCasClient extends CasClientOperations {
  leaseNode(
    hash: CasHash,
    source?: CasNodeSource,
    options?: CasLeaseOptions,
  ): Promise<CasLeaseResult>;
}

export interface SpaceCasClient extends CasClientOperations {
  leaseNode(hash: CasHash): Promise<SpaceNodeLeaseResult>;
  leaseNode(hash: CasHash, options: SpaceNodeLeaseOptions): Promise<SpaceNodeLeaseResult>;
}

interface CasClientConfigBase {
  readonly baseUrl: string;
  readonly getToken: () => Promise<string>;
  readonly fetcher?: HttpFetcher;
  readonly cache?: CasNodeCache;
}

export interface TenantCasClientConfig extends CasClientConfigBase {
  readonly stackId: string;
  readonly tenantId: string;
}

export interface SpaceCasClientConfig extends CasClientConfigBase {
  readonly appId: string;
  readonly spaceId: string;
}

export type {
  CasGcResult,
  CasHash,
  CasLeaseResult,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
};
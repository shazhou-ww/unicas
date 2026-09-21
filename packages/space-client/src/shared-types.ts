import type {
  CasGcResult,
  CasHash,
  CasLeaseResult,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
} from "@unicas/space-protocol";

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

export interface CasNodeCacheStrategy<Key extends { readonly hash: CasHash }> {
  metadata(
    key: Key,
    load: () => Promise<CasNodeMetadata>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CasNodeMetadata>;
  read(
    key: Key,
    range: CasNodeRange | undefined,
    load: () => Promise<ReadableStream<Uint8Array>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface CasClientOperations {
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

export interface CasClientConfigBase<Key extends { readonly hash: CasHash }> {
  readonly baseUrl: string;
  readonly getToken: () => Promise<string>;
  readonly fetcher?: HttpFetcher;
  readonly cache?: CasNodeCacheStrategy<Key>;
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
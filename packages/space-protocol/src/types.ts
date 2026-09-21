/** 64 lowercase hexadecimal SHA-256 characters. */
export type CasHash = string;

export type AppId = string;
export type SpaceId = string;

/** Addressable v2 data ownership boundary within an App. */
export interface Space {
  readonly appId: AppId;
  readonly spaceId: SpaceId;
}

export interface CasNodeMetadata {
  readonly hash: CasHash;
  readonly size: number;
  readonly contentType: string;
  readonly refs: readonly CasHash[];
}

export interface CasNodeState {
  readonly leaseStartedAt: number;
  readonly leaseExpiresAt: number;
  readonly childRefCount: number;
  readonly rootRefCount: number;
}

export interface CasNodeDescriptor {
  readonly hash: CasHash;
  readonly size: number;
  readonly contentType: string;
  readonly refs: readonly CasHash[];
}

export interface CasLeaseResult {
  readonly hash: CasHash;
  readonly ready: true;
  readonly leaseStartedAt: number;
  readonly leaseExpiresAt: number;
}

export interface CasUploadRequiredResult {
  readonly hash: CasHash;
  readonly ready: false;
  readonly status: "upload_required";
  readonly uploadId: string;
  readonly expiresAt: number;
  readonly upload: {
    readonly method: "PUT";
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
  };
}

export type CasLeaseOperationResult = CasLeaseResult | CasUploadRequiredResult;

export interface SpaceNodeLeaseRequest {
  readonly leaseDurationMs: number;
}

export interface SpaceNodeUploadInstructions {
  readonly method: "PUT";
  readonly url: string;
  readonly expiresAt: number;
  readonly headers: Readonly<Record<string, string>>;
}

export type SpaceNodeUploadRejectionCode =
  | "NODE_TOO_LARGE"
  | "NODE_DIGEST_MISMATCH"
  | "INVALID_CANONICAL_NODE"
  | "NODE_CONFLICT";

export interface SpaceNodeUploadRejection {
  readonly code: SpaceNodeUploadRejectionCode;
  readonly message: string;
}

export interface SpaceNodeLeaseReadyResult {
  readonly state: "ready";
  readonly hash: CasHash;
  readonly leaseStartedAt: number;
  readonly leaseExpiresAt: number;
}

export interface SpaceNodeLeaseAwaitingUploadResult {
  readonly state: "awaiting_upload";
  readonly hash: CasHash;
  readonly upload: SpaceNodeUploadInstructions;
}

export interface SpaceNodeLeaseAwaitingReplacementUploadResult {
  readonly state: "awaiting_replacement_upload";
  readonly hash: CasHash;
  readonly rejection: SpaceNodeUploadRejection;
  readonly upload: SpaceNodeUploadInstructions;
}

export interface SpaceNodeLeaseValidatedAwaitingChildrenResult {
  readonly state: "validated_awaiting_children";
  readonly hash: CasHash;
  readonly childHashes: readonly CasHash[];
}

export type SpaceNodeLeaseResult =
  | SpaceNodeLeaseReadyResult
  | SpaceNodeLeaseAwaitingUploadResult
  | SpaceNodeLeaseAwaitingReplacementUploadResult
  | SpaceNodeLeaseValidatedAwaitingChildrenResult;

export type CasReferences = Readonly<Record<CasHash, number>>;
export type CasRefChanges = Readonly<Record<CasHash, number>>;

export interface CasRootRefUpdate {
  readonly requestId: string;
  readonly changes: CasRefChanges;
}

export interface CasRootRefBalance {
  readonly hash: CasHash;
  readonly refCount: number;
}

export interface CasRootRefsPage {
  readonly refDomain: string;
  readonly revision: number;
  readonly items: readonly CasRootRefBalance[];
  readonly nextCursor: string | null;
}

export interface CasUsage {
  readonly nodeCount: number;
  readonly readyContentBytes: number;
  readonly readyStoredBytes: number;
  readonly reservedBytes: number;
  readonly notReadyNodeCount: number;
  readonly leasedNodeCount: number;
}

export interface CasGcResult {
  readonly examined: number;
  readonly deleted: number;
  readonly reclaimedContentBytes: number;
}

export interface CasNode {
  readonly metadata: CasNodeMetadata;
  readonly content: ReadableStream<Uint8Array>;
}

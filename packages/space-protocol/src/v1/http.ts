import type {
  CasGcResult,
  CasHash,
  CasLeaseOperationResult,
  CasNodeMetadata,
  CasNodeState,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
} from "../types.js";
import type { CasErrorResponse } from "../http.js";

export {
  CasLeaseDurationHeader,
  CasUploadIdHeader,
  CasUploadLengthHeader,
} from "../http.js";
export type { CasErrorResponse } from "../http.js";

export interface CasStackPath {
  readonly stackId: string;
}

export interface CasTenantPath extends CasStackPath {
  readonly tenantId: string;
}

export interface CasNodePath extends CasTenantPath {
  readonly hash: CasHash;
}

export interface CasReadContentRequest {
  readonly path: CasNodePath;
}

export type CasReadContentResponse =
  | { body: ReadableStream<Uint8Array>; headers: { contentType: string; contentLength: number } }
  | CasErrorResponse;

export interface CasReadMetadataRequest {
  readonly path: CasNodePath;
}

export type CasReadMetadataResponse =
  | { metadata: CasNodeMetadata; state: CasNodeState }
  | CasErrorResponse;

export interface CasLeaseRequest {
  readonly path: CasNodePath;
  readonly headers: {
    leaseDurationMs?: number;
    uploadLength?: number;
    uploadId?: string;
    contentType?: "application/vnd.unidocs.cas-node.v1";
    contentLength?: number;
  };
  readonly body?: ReadableStream<Uint8Array>;
}

export type CasLeaseResponse = CasLeaseOperationResult | CasErrorResponse;

export interface CasUsageRequest {
  readonly path: CasTenantPath;
}

export type CasUsageResponse = CasUsage | CasErrorResponse;

export interface CasGcRequest {
  readonly path: CasTenantPath;
  readonly body?: { maxNodes?: number };
}

export type CasGcResponse = CasGcResult | CasErrorResponse;

export interface CasListRootRefsRequest {
  readonly path: CasTenantPath;
  readonly query?: { readonly limit?: number; readonly cursor?: string };
}

export type CasListRootRefsResponse = CasRootRefsPage | CasErrorResponse;

export interface CasUpdateRootRefsRequest {
  readonly path: CasTenantPath;
  readonly body: CasRootRefUpdate;
}

export type CasUpdateRootRefsResponse =
  | { success: true; idempotent: boolean; revision: number }
  | CasErrorResponse;

export interface CasEndpointContracts {
  readContent: { request: CasReadContentRequest; response: CasReadContentResponse };
  readMetadata: { request: CasReadMetadataRequest; response: CasReadMetadataResponse };
  lease: { request: CasLeaseRequest; response: CasLeaseResponse };
  usage: { request: CasUsageRequest; response: CasUsageResponse };
  gc: { request: CasGcRequest; response: CasGcResponse };
  listRootRefs: { request: CasListRootRefsRequest; response: CasListRootRefsResponse };
  updateRootRefs: {
    request: CasUpdateRootRefsRequest;
    response: CasUpdateRootRefsResponse;
  };
}
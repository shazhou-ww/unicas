import { oc } from "@orpc/contract";
import { JSON_SCHEMA_OUTPUT_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";
import {
  AppIdSchema,
  CasRootRefUpdateSchema,
  SpaceIdSchema,
} from "./schemas.js";
import type {
  SpaceNodeLeaseRequest,
  SpaceNodeLeaseResult,
  SpaceNodeUploadInstructions,
  SpaceNodeUploadRejection,
} from "./types.js";

export const SpaceApiBasePath = "/v1/cas";
export const DefaultSpaceNodeLeaseDurationMs = 15 * 60 * 1000;

const ErrorDataSchema = z.object({ message: z.string().optional() }).readonly();

const LegacySpaceApiErrorMap = {
  INVALID_REQUEST: { status: 400, message: "The CAS request is invalid", data: ErrorDataSchema },
  UNAUTHORIZED: { status: 401, message: "A valid Space capability is required", data: ErrorDataSchema },
  FORBIDDEN: { status: 403, message: "The capability does not grant this operation", data: ErrorDataSchema },
  NOT_FOUND: { status: 404, message: "The requested CAS resource was not found", data: ErrorDataSchema },
  CONFLICT: { status: 409, message: "The CAS mutation conflicts with current state", data: ErrorDataSchema },
  RESOURCE_EXHAUSTED: { status: 429, message: "The Space has too many active uploads", data: ErrorDataSchema },
} as const;

export const SpaceApiStableErrorMap = {
  INVALID_REQUEST: { status: 400, message: "The CAS request is invalid", data: ErrorDataSchema },
  ROOT_REF_INVALID: { status: 400, message: "The Root Ref request is invalid", data: ErrorDataSchema },
  missing_token: { status: 401, message: "A Space capability is required", data: ErrorDataSchema },
  invalid_token: { status: 401, message: "The Space capability is invalid", data: ErrorDataSchema },
  unknown_issuer: { status: 401, message: "The capability issuer is not registered", data: ErrorDataSchema },
  registry_unavailable: { status: 401, message: "The App authority registry is unavailable", data: ErrorDataSchema },
  insufficient_permission: { status: 403, message: "The capability lacks the exact operation permission", data: ErrorDataSchema },
  resource_scope_mismatch: { status: 403, message: "The capability scope does not match the route", data: ErrorDataSchema },
  unsupported_algorithm: { status: 403, message: "The capability algorithm is not supported", data: ErrorDataSchema },
  APP_SUSPENDED: { status: 403, message: "The App is suspended", data: ErrorDataSchema },
  NODE_NOT_FOUND: { status: 404, message: "The requested node was not found or is not ready", data: ErrorDataSchema },
  NODE_CONFLICT: { status: 409, message: "The node conflicts with immutable state", data: ErrorDataSchema },
  NODE_NOT_READY: { status: 409, message: "A referenced node is not ready", data: ErrorDataSchema },
  NEGATIVE_AGGREGATE: { status: 409, message: "The Root Ref update would create a negative balance", data: ErrorDataSchema },
  IDEMPOTENCY_CONFLICT: { status: 409, message: "The idempotency identity was reused with different content", data: ErrorDataSchema },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The CAS payload exceeds the configured limit", data: ErrorDataSchema },
  CAS_UPLOAD_LIMIT: { status: 429, message: "The Space has too many active uploads", data: ErrorDataSchema },
  SERVICE_UNAVAILABLE: { status: 503, message: "The CAS operation is temporarily unavailable", data: ErrorDataSchema },
  STORAGE_ERROR: { status: 503, message: "The CAS storage operation failed", data: ErrorDataSchema },
  ROOT_REF_BUSY: { status: 503, message: "The Root Ref update exhausted its bounded retry", data: ErrorDataSchema },
} as const;

export const SpaceApiErrorMap = {
  ...LegacySpaceApiErrorMap,
  ...SpaceApiStableErrorMap,
} as const;

export const SpaceApiStableErrorCodesByStatus = {
  400: ["INVALID_REQUEST", "ROOT_REF_INVALID"],
  401: ["missing_token", "invalid_token", "unknown_issuer", "registry_unavailable"],
  403: [
    "insufficient_permission",
    "resource_scope_mismatch",
    "unsupported_algorithm",
    "registry_unavailable",
    "APP_SUSPENDED",
    "ROOT_REF_INVALID",
  ],
  404: ["NODE_NOT_FOUND"],
  409: ["NODE_CONFLICT", "NODE_NOT_READY", "NEGATIVE_AGGREGATE", "IDEMPOTENCY_CONFLICT"],
  413: ["PAYLOAD_TOO_LARGE"],
  416: ["INVALID_REQUEST"],
  429: ["CAS_UPLOAD_LIMIT"],
  503: ["STORAGE_ERROR", "ROOT_REF_BUSY", "SERVICE_UNAVAILABLE"],
} as const;

export type SpaceApiStableErrorCode =
  (typeof SpaceApiStableErrorCodesByStatus)[keyof typeof SpaceApiStableErrorCodesByStatus][number];

const spaceProcedure = oc.errors(SpaceApiStableErrorMap);
const HashSchema = z.string()
  .regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest")
  .describe("Lowercase hexadecimal SHA-256 digest of canonical CAS node bytes.");
const TimestampSchema = z.number().int().nonnegative()
  .describe("Unix timestamp in milliseconds since 1970-01-01T00:00:00Z.");
const scopeQuery = z.object({
  appId: AppIdSchema.describe("App that establishes issuer authority and storage isolation."),
  spaceId: SpaceIdSchema.describe("Space authorized by the capability for this request."),
}).readonly();
const nodeParams = z.object({
  hash: HashSchema.describe("Lowercase SHA-256 content digest."),
}).readonly();

export const SpaceReadContentHttpContract = {
  request: {
    rangeHeader: "Range",
    rangePattern: "^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$",
  },
  mediaType: "application/vnd.unidocs.cas-node.v1",
  headers: {
    acceptRanges: { name: "Accept-Ranges", value: "bytes" },
    contentLength: { name: "Content-Length", pattern: "^(?:0|[1-9][0-9]*)$" },
    contentType: { name: "Content-Type" },
    nodeRefs: {
      name: "X-CAS-Refs",
      pattern: "^(?:[0-9a-f]{64}(?:,[0-9a-f]{64})*)?$",
      maxLength: 16_639,
    },
    contentRange: {
      name: "Content-Range",
      pattern: "^bytes [0-9]+-[0-9]+/[0-9]+$",
    },
  },
  responses: {
    full: { status: 200, description: "Complete node content" },
    partial: { status: 206, description: "Partial node content" },
    rangeNotSatisfiable: {
      status: 416,
      error: "INVALID_REQUEST",
      contentRangePattern: "^bytes \\*/[0-9]+$",
    },
  },
} as const;

export const SpaceReadContentRangeNotSatisfiable =
  SpaceReadContentHttpContract.responses.rangeNotSatisfiable;

const RangeHeaderSchema = z.string()
  .regex(new RegExp(SpaceReadContentHttpContract.request.rangePattern))
  .describe("One RFC 9110 byte range: bounded, open-ended, or suffix.");

export interface SpaceReadContentResponseHeaders {
  readonly "Accept-Ranges": "bytes";
  readonly "Content-Length": string;
  readonly "Content-Type": string;
  readonly "X-CAS-Refs": string;
}

export type SpaceReadContentHttpResponse =
  | {
      readonly status: 200;
      readonly headers: SpaceReadContentResponseHeaders;
      readonly body: ReadableStream<Uint8Array>;
    }
  | {
      readonly status: 206;
      readonly headers: SpaceReadContentResponseHeaders & {
        readonly "Content-Range": string;
      };
      readonly body: ReadableStream<Uint8Array>;
    }
  | {
      readonly status: 416;
      readonly headers: { readonly "Content-Range": string };
      readonly body: { readonly error: "INVALID_REQUEST"; readonly message?: string };
    };

const ReadContentOutputSchema: z.ZodType<ReadableStream<Uint8Array>> = z.any()
  .refine(value => value instanceof ReadableStream);
const binaryContentSchema = {
  type: "string",
  contentMediaType: SpaceReadContentHttpContract.mediaType,
  contentEncoding: "binary",
} as const;
const baseResponseHeaderProperties = {
  [SpaceReadContentHttpContract.headers.acceptRanges.name]: {
    const: SpaceReadContentHttpContract.headers.acceptRanges.value,
  },
  [SpaceReadContentHttpContract.headers.contentLength.name]: {
    type: "string",
    pattern: SpaceReadContentHttpContract.headers.contentLength.pattern,
    description: "Decimal response body length in bytes.",
  },
  [SpaceReadContentHttpContract.headers.contentType.name]: {
    type: "string",
    minLength: 1,
  },
  [SpaceReadContentHttpContract.headers.nodeRefs.name]: {
    type: "string",
    maxLength: SpaceReadContentHttpContract.headers.nodeRefs.maxLength,
    pattern: SpaceReadContentHttpContract.headers.nodeRefs.pattern,
    description: "Ordered comma-separated child node digests, or an empty string.",
  },
} as const;
const baseRequiredResponseHeaders = [
  SpaceReadContentHttpContract.headers.acceptRanges.name,
  SpaceReadContentHttpContract.headers.contentLength.name,
  SpaceReadContentHttpContract.headers.contentType.name,
  SpaceReadContentHttpContract.headers.nodeRefs.name,
] as const;

JSON_SCHEMA_OUTPUT_REGISTRY.add(ReadContentOutputSchema, {
  oneOf: [
    {
      type: "object",
      properties: {
        status: {
          const: SpaceReadContentHttpContract.responses.full.status,
          description: SpaceReadContentHttpContract.responses.full.description,
        },
        headers: {
          type: "object",
          properties: baseResponseHeaderProperties,
          required: [...baseRequiredResponseHeaders],
        },
        body: binaryContentSchema,
      },
      required: ["status", "headers", "body"],
    },
    {
      type: "object",
      properties: {
        status: {
          const: SpaceReadContentHttpContract.responses.partial.status,
          description: SpaceReadContentHttpContract.responses.partial.description,
        },
        headers: {
          type: "object",
          properties: {
            ...baseResponseHeaderProperties,
            [SpaceReadContentHttpContract.headers.contentRange.name]: {
              type: "string",
              pattern: SpaceReadContentHttpContract.headers.contentRange.pattern,
              description: "Selected inclusive byte range and complete content length.",
            },
          },
          required: [
            ...baseRequiredResponseHeaders,
            SpaceReadContentHttpContract.headers.contentRange.name,
          ],
        },
        body: binaryContentSchema,
      },
      required: ["status", "headers", "body"],
    },
  ],
});

const NodeMetadataSchema = z.object({
  hash: HashSchema.describe("Digest that identifies this immutable node."),
  size: z.number().int().nonnegative().describe("Logical content length in bytes."),
  contentType: z.string().min(1).describe("Media type recorded for the immutable content."),
  refs: z.array(HashSchema).readonly().describe("Ordered child-node digests."),
}).readonly().meta({ id: "SpaceNodeMetadata" });
const NodeStateSchema = z.object({
  leaseStartedAt: TimestampSchema.describe("Start of the current uninterrupted lease period."),
  leaseExpiresAt: TimestampSchema.describe("Deadline before which collection cannot delete the node."),
  childRefCount: z.number().int().nonnegative().describe("Stored parent edges that reference this node."),
  rootRefCount: z.number().int().describe("Aggregate business Root Ref balance for this node."),
}).readonly().meta({ id: "SpaceNodeState" });
const SpaceNodeLeaseRequestSchema: z.ZodType<SpaceNodeLeaseRequest> = z.object({
  leaseDurationMs: z.number().int().positive()
    .describe("Requested lease duration in milliseconds."),
}).readonly().meta({ id: "SpaceNodeLeaseRequest" });
const SpaceNodeUploadInstructionsSchema: z.ZodType<SpaceNodeUploadInstructions> = z.object({
  method: z.literal("PUT"),
  url: z.url(),
  expiresAt: TimestampSchema,
  headers: z.record(z.string(), z.string()).readonly(),
}).readonly().meta({ id: "SpaceNodeUploadInstructions" });
const SpaceNodeUploadRejectionSchema: z.ZodType<SpaceNodeUploadRejection> = z.object({
  code: z.enum([
    "NODE_TOO_LARGE",
    "NODE_DIGEST_MISMATCH",
    "INVALID_CANONICAL_NODE",
    "NODE_CONFLICT",
  ]),
  message: z.string().min(1),
}).readonly().meta({ id: "SpaceNodeUploadRejection" });
const LeaseOperationResultSchema: z.ZodType<SpaceNodeLeaseResult> = z.discriminatedUnion("state", [
  z.object({
    hash: HashSchema,
    state: z.literal("ready"),
    leaseStartedAt: TimestampSchema,
    leaseExpiresAt: TimestampSchema,
  }).readonly(),
  z.object({
    hash: HashSchema,
    state: z.literal("awaiting_upload"),
    upload: SpaceNodeUploadInstructionsSchema,
  }).readonly(),
  z.object({
    hash: HashSchema,
    state: z.literal("awaiting_replacement_upload"),
    rejection: SpaceNodeUploadRejectionSchema,
    upload: SpaceNodeUploadInstructionsSchema,
  }).readonly(),
  z.object({
    hash: HashSchema,
    state: z.literal("validated_awaiting_children"),
    childHashes: z.array(HashSchema).min(1).max(256).readonly(),
  }).readonly(),
]).meta({ id: "SpaceLeaseOperationResult" });
const UsageSchema = z.object({
  nodeCount: z.number().int().nonnegative().describe("Node metadata rows owned by the Space."),
  readyContentBytes: z.number().int().nonnegative().describe("Logical bytes with ready canonical content."),
  readyStoredBytes: z.number().int().nonnegative().describe("Physical bytes attributed to ready content."),
  reservedBytes: z.number().int().nonnegative()
    .describe("Known bytes reserved by validated or server-mediated incomplete uploads; pre-validation direct R2 bytes are excluded."),
  notReadyNodeCount: z.number().int().nonnegative().describe("Nodes without ready canonical content."),
  leasedNodeCount: z.number().int().nonnegative().describe("Nodes protected by an unexpired lease."),
}).readonly().meta({ id: "SpaceUsage" });
const GcResultSchema = z.object({
  examined: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  reclaimedContentBytes: z.number().int().nonnegative(),
}).readonly().meta({ id: "SpaceGcResult" });
const RootRefsPageSchema = z.object({
  refDomain: z.string().min(1).describe("Business lifecycle namespace from the verified capability."),
  revision: z.number().int().nonnegative().describe("Stable snapshot revision represented by this page."),
  items: z.array(z.object({
    hash: HashSchema,
    refCount: z.number().int(),
  }).readonly()).readonly(),
  nextCursor: z.string().min(1).nullable(),
}).readonly().meta({ id: "SpaceRootRefsPage" });

export const readContentContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/nodes/{hash}`,
    operationId: "readContent",
    summary: "Read immutable node content",
    description: "Streams canonical bytes for a ready node in the requested Space. Content-Type, Content-Length, and X-CAS-Refs describe the same immutable node so clients can consume metadata and content in one authorized request. Requires cas:nodes:read.",
    inputStructure: "detailed",
    outputStructure: "detailed",
    tags: ["Nodes"],
  })
  .input(z.object({
    params: nodeParams,
    query: scopeQuery,
    headers: z.object({ Range: RangeHeaderSchema.optional() }).readonly().optional(),
  }).readonly())
  .output(ReadContentOutputSchema);

export const readMetadataContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/nodes/{hash}/metadata`,
    operationId: "readMetadata",
    summary: "Read node metadata",
    description: "Returns immutable metadata and mutable retention state for one Space node. Requires cas:nodes:read.",
    inputStructure: "detailed",
    tags: ["Nodes"],
  })
  .input(z.object({ params: nodeParams, query: scopeQuery }).readonly())
  .output(z.object({ metadata: NodeMetadataSchema, state: NodeStateSchema }).readonly()
    .meta({ id: "SpaceReadMetadataResponse" }));

export const leaseNodeContract = spaceProcedure
  .route({
    method: "POST",
    path: `${SpaceApiBasePath}/nodes/{hash}/lease`,
    operationId: "leaseNode",
    summary: "Lease a node",
    description: "Advances the lease-driven node state machine and returns the resulting ready, upload, replacement-upload, or dependency state. Requires cas:nodes:lease.",
    inputStructure: "detailed",
    tags: ["Nodes"],
  })
  .input(z.object({
    params: nodeParams,
    query: scopeQuery,
    body: SpaceNodeLeaseRequestSchema,
  }).readonly())
  .output(LeaseOperationResultSchema);

export const getUsageContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/usage`,
    operationId: "getUsage",
    summary: "Read Space CAS usage",
    description: "Returns current operational accounting for one Space. Requires cas:usage:read.",
    inputStructure: "detailed",
    tags: ["Operations"],
  })
  .input(z.object({ query: scopeQuery }).readonly())
  .output(UsageSchema);

export const runGcContract = spaceProcedure
  .route({
    method: "POST",
    path: `${SpaceApiBasePath}/gc`,
    operationId: "runGc",
    summary: "Run Space garbage collection",
    description: "Runs one bounded and race-safe garbage-collection pass within the Space. Requires cas:gc:execute.",
    inputStructure: "detailed",
    tags: ["Operations"],
  })
  .input(z.object({
    query: scopeQuery,
    body: z.object({ maxNodes: z.number().int().positive().optional() }).readonly().optional(),
  }).readonly())
  .output(GcResultSchema);

export const listRootRefsContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/root-refs`,
    operationId: "listRootRefs",
    summary: "List Space Root Ref balances",
    description: "Returns a revision-stable page for the refDomain in the verified capability. Requires cas:root-refs:read and a valid signed refDomain.",
    inputStructure: "detailed",
    tags: ["Root Refs"],
  })
  .input(z.object({
    query: z.object({
      appId: AppIdSchema.describe("App that establishes issuer authority and storage isolation."),
      spaceId: SpaceIdSchema.describe("Space authorized by the capability for this request."),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().min(1).optional(),
    }).readonly(),
  }).readonly())
  .output(RootRefsPageSchema);

export const updateRootRefsContract = spaceProcedure
  .route({
    method: "POST",
    path: `${SpaceApiBasePath}/root-refs`,
    operationId: "updateRootRefs",
    summary: "Apply Space Root Ref changes",
    description: "Atomically applies signed Root Ref deltas in the capability's refDomain. Requires cas:root-refs:update and a valid signed refDomain.",
    inputStructure: "detailed",
    tags: ["Root Refs"],
  })
  .input(z.object({ query: scopeQuery, body: CasRootRefUpdateSchema }).readonly())
  .output(z.object({
    success: z.literal(true),
    idempotent: z.boolean(),
    revision: z.number().int().nonnegative(),
  }).readonly().meta({ id: "SpaceUpdateRootRefsResponse" }));

export const spaceApiContract = {
  nodes: {
    readContent: readContentContract,
    readMetadata: readMetadataContract,
    lease: leaseNodeContract,
  },
  operations: { getUsage: getUsageContract, runGc: runGcContract },
  rootRefs: { list: listRootRefsContract, update: updateRootRefsContract },
};

export type SpaceApiContract = typeof spaceApiContract;
import { oc } from "@orpc/contract";
import { JSON_SCHEMA_INPUT_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";
import { AppIdSchema, SpaceIdSchema } from "./schemas.js";
import type {
  SpaceNodeLeaseRequest,
  SpaceNodeLeaseResult,
  SpaceNodeUploadInstructions,
  SpaceNodeUploadRejection,
} from "./types.js";

export const SpaceApiBasePath = "/v2/apps/{appId}/spaces/{spaceId}";
export const DefaultSpaceNodeLeaseDurationMs = 15 * 60 * 1000;

const ErrorDataSchema = z.object({ message: z.string().optional() }).readonly();

export const SpaceApiErrorMap = {
  INVALID_REQUEST: { status: 400, message: "The CAS request is invalid", data: ErrorDataSchema },
  UNAUTHORIZED: { status: 401, message: "A valid Space capability is required", data: ErrorDataSchema },
  FORBIDDEN: { status: 403, message: "The capability does not grant this operation", data: ErrorDataSchema },
  NOT_FOUND: { status: 404, message: "The requested CAS resource was not found", data: ErrorDataSchema },
  CONFLICT: { status: 409, message: "The CAS mutation conflicts with current state", data: ErrorDataSchema },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The CAS payload exceeds the configured limit", data: ErrorDataSchema },
  RESOURCE_EXHAUSTED: { status: 429, message: "The Space has too many active uploads", data: ErrorDataSchema },
  INTERNAL_ERROR: { status: 500, message: "The CAS operation failed", data: ErrorDataSchema },
} as const;

const spaceProcedure = oc.errors(SpaceApiErrorMap);
const HashSchema = z.string()
  .regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest")
  .describe("Lowercase hexadecimal SHA-256 digest of canonical CAS node bytes.");
const TimestampSchema = z.number().int().nonnegative()
  .describe("Unix timestamp in milliseconds since 1970-01-01T00:00:00Z.");
const spaceParams = z.object({
  appId: AppIdSchema.describe("App that establishes issuer authority and storage isolation."),
  spaceId: SpaceIdSchema.describe("Space authorized by the capability for this request."),
}).readonly();
const nodeParams = spaceParams.unwrap().extend({
  hash: HashSchema.describe("Lowercase SHA-256 content digest."),
}).readonly();
const BinaryStreamSchema = z.instanceof(ReadableStream<Uint8Array>);

JSON_SCHEMA_INPUT_REGISTRY.add(BinaryStreamSchema, {
  type: "string",
  contentMediaType: "application/vnd.unidocs.cas-node.v1",
  contentEncoding: "binary",
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
const RefChangesSchema = z.record(HashSchema, z.number().int()).readonly()
  .describe("Signed Root Ref deltas keyed by node digest.");
const RootRefUpdateSchema = z.object({
  requestId: z.string().min(1).describe("Stable idempotency identity for this commit."),
  changes: RefChangesSchema,
}).readonly().meta({ id: "SpaceRootRefUpdate" });
const RootRefsPageSchema = z.object({
  refDomain: z.string().min(1).describe("Business lifecycle namespace from the verified capability."),
  revision: z.number().int().nonnegative().describe("Stable snapshot revision represented by this page."),
  items: z.array(z.object({
    hash: HashSchema,
    refCount: z.number().int(),
  }).readonly()).readonly(),
  nextCursor: z.string().min(1).nullable(),
}).readonly().meta({ id: "SpaceRootRefsPage" });

export const readSpaceContentContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/cas/nodes/{hash}/content`,
    operationId: "readSpaceContent",
    summary: "Read immutable node content",
    description: "Streams canonical bytes for a ready node in the requested Space. Requires cas:nodes:read.",
    inputStructure: "detailed",
    tags: ["Nodes"],
  })
  .input(z.object({ params: nodeParams }).readonly())
  .output(BinaryStreamSchema);

export const readSpaceMetadataContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/cas/nodes/{hash}/metadata`,
    operationId: "readSpaceMetadata",
    summary: "Read node metadata",
    description: "Returns immutable metadata and mutable retention state for one Space node. Requires cas:nodes:read.",
    inputStructure: "detailed",
    tags: ["Nodes"],
  })
  .input(z.object({ params: nodeParams }).readonly())
  .output(z.object({ metadata: NodeMetadataSchema, state: NodeStateSchema }).readonly()
    .meta({ id: "SpaceReadMetadataResponse" }));

export const leaseSpaceNodeContract = spaceProcedure
  .route({
    method: "POST",
    path: `${SpaceApiBasePath}/cas/nodes/{hash}/lease`,
    operationId: "leaseSpaceNode",
    summary: "Lease a node",
    description: "Advances the lease-driven node state machine and returns the resulting ready, upload, replacement-upload, or dependency state. Requires cas:nodes:lease.",
    inputStructure: "detailed",
    tags: ["Nodes"],
  })
  .input(z.object({
    params: nodeParams,
    body: SpaceNodeLeaseRequestSchema,
  }).readonly())
  .output(LeaseOperationResultSchema);

export const getSpaceUsageContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/cas/usage`,
    operationId: "getSpaceUsage",
    summary: "Read Space CAS usage",
    description: "Returns current operational accounting for one Space. Requires cas:usage:read.",
    inputStructure: "detailed",
    tags: ["Operations"],
  })
  .input(z.object({ params: spaceParams }).readonly())
  .output(UsageSchema);

export const runSpaceGcContract = spaceProcedure
  .route({
    method: "POST",
    path: `${SpaceApiBasePath}/cas/gc`,
    operationId: "runSpaceGc",
    summary: "Run Space garbage collection",
    description: "Runs one bounded and race-safe garbage-collection pass within the Space. Requires cas:gc:execute.",
    inputStructure: "detailed",
    tags: ["Operations"],
  })
  .input(z.object({
    params: spaceParams,
    body: z.object({ maxNodes: z.number().int().positive().optional() }).readonly().optional(),
  }).readonly())
  .output(GcResultSchema);

export const listSpaceRootRefsContract = spaceProcedure
  .route({
    method: "GET",
    path: `${SpaceApiBasePath}/root-refs`,
    operationId: "listSpaceRootRefs",
    summary: "List Space Root Ref balances",
    description: "Returns a revision-stable page for the refDomain in the verified capability. Requires cas:root-refs:read and a valid signed refDomain.",
    inputStructure: "detailed",
    tags: ["Root Refs"],
  })
  .input(z.object({
    params: spaceParams,
    query: z.object({
      limit: z.number().int().min(1).max(1000).optional(),
      cursor: z.string().min(1).optional(),
    }).readonly().optional(),
  }).readonly())
  .output(RootRefsPageSchema);

export const updateSpaceRootRefsContract = spaceProcedure
  .route({
    method: "POST",
    path: `${SpaceApiBasePath}/root-refs`,
    operationId: "updateSpaceRootRefs",
    summary: "Apply Space Root Ref changes",
    description: "Atomically applies signed Root Ref deltas in the capability's refDomain. Requires cas:root-refs:update and a valid signed refDomain.",
    inputStructure: "detailed",
    tags: ["Root Refs"],
  })
  .input(z.object({ params: spaceParams, body: RootRefUpdateSchema }).readonly())
  .output(z.object({
    success: z.literal(true),
    idempotent: z.boolean(),
    revision: z.number().int().nonnegative(),
  }).readonly().meta({ id: "SpaceUpdateRootRefsResponse" }));

export const spaceApiContract = {
  nodes: {
    readContent: readSpaceContentContract,
    readMetadata: readSpaceMetadataContract,
    lease: leaseSpaceNodeContract,
  },
  operations: { getUsage: getSpaceUsageContract, runGc: runSpaceGcContract },
  rootRefs: { list: listSpaceRootRefsContract, update: updateSpaceRootRefsContract },
};

export type SpaceApiContract = typeof spaceApiContract;
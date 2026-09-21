import type { CanonicalNodeLimits } from "@unicas/codec";
import {
  HASH_SIZE,
  HEADER_SIZE,
  MAX_CANONICAL_NODE_BYTES,
  MAX_CONTENT_TYPE_LENGTH,
  MAX_NODE_REFS,
  hashToHex,
  parseCanonicalNodeStream,
  sha256,
  validateHash,
} from "@unicas/codec";
import type {
  CasLeaseResult,
  SpaceNodeLeaseReadyResult,
  SpaceNodeUploadRejection,
} from "@unicas/tenant-protocol";
import { NodeOpError, NodeOpErrorCodes } from "./node-errors.js";

export const DEFAULT_LEASE_MS = 15 * 60 * 1000;
export const MIN_LEASE_MS = 60 * 1000;
export const MAX_LEASE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_UPLOAD_SESSION_MS = 15 * 60 * 1000;
export const DEFAULT_UPLOAD_CLEANUP_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_ACTIVE_UPLOADS = 1024;

export interface NodeLeaseScope {
  readonly stackId: string;
  readonly tenantId: string;
}

export interface NodeLeaseRecord {
  readonly leaseStartedAt: number;
  readonly leaseExpiresAt: number;
}

export interface CanonicalOrphanObject {
  readonly storedBytes: number;
  readonly sha256Hex?: string;
}

export interface AdoptedCanonicalNodePlan {
  readonly hash: string;
  readonly contentSize: number;
  readonly contentType: string;
  readonly refs: readonly string[];
  readonly storedBytes: number;
  readonly leaseStartedAt: number;
  readonly leaseExpiresAt: number;
  readonly reservationCreatedAt: number;
  readonly reservationExpiresAt: number;
}

export interface CanonicalNodeLeaseRecord extends NodeLeaseRecord {
  readonly contentSize: number;
  readonly contentType: string;
}

export interface CanonicalUploadReservation {
  readonly hash: string;
  readonly storedBytes: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface CanonicalNodeUploadPlan {
  readonly hash: string;
  readonly storedBytes: number;
  readonly leaseDurationMs: number;
}

export interface CanonicalDirectUploadSession {
  readonly hash: string;
  readonly uploadId: string;
  readonly temporaryObjectKey: string;
  readonly storedBytes: number;
  readonly leaseDurationMs: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface CanonicalDirectUploadRepository extends NodeLeaseRepository {
  readCanonicalUploadSession(
    scope: NodeLeaseScope,
    hash: string,
  ): Promise<CanonicalDirectUploadSession | null>;
  reserveCanonicalUploadSession(
    scope: NodeLeaseScope,
    session: CanonicalDirectUploadSession,
  ): Promise<void>;
  deleteCanonicalUploadSession(
    scope: NodeLeaseScope,
    hash: string,
    uploadId: string,
  ): Promise<void>;
}

export type CanonicalDirectUploadPrepareResult =
  | { readonly kind: "ready"; readonly result: CasLeaseResult }
  | {
    readonly kind: "upload";
    readonly session: CanonicalDirectUploadSession;
    readonly replacedTemporaryObjectKey?: string;
  };

export type CanonicalDirectUploadFinalizeAdmission =
  | { readonly kind: "ready"; readonly result: CasLeaseResult }
  | { readonly kind: "upload"; readonly session: CanonicalDirectUploadSession };

export type CanonicalNodeLeaseBeginResult =
  | { readonly kind: "ready"; readonly result: CasLeaseResult }
  | { readonly kind: "upload"; readonly plan: CanonicalNodeUploadPlan };

export type UploadedCanonicalNodeCommit =
  | {
    readonly kind: "existing";
    readonly hash: string;
    readonly storedBytes: number;
    readonly leaseStartedAt: number;
    readonly leaseExpiresAt: number;
  }
  | {
    readonly kind: "new";
    readonly hash: string;
    readonly contentSize: number;
    readonly storedBytes: number;
    readonly contentType: string;
    readonly refs: readonly string[];
    readonly leaseStartedAt: number;
    readonly leaseExpiresAt: number;
  };

/** Canonical-node metadata parsed from the upload stream itself (tee'd while
 *  the bytes stream into storage). Supplying it lets the finalize step skip
 *  the post-upload R2 read-back: the upload already carried a `sha256`
 *  checksum, so the stored bytes are identical to the stream that was parsed. */
export interface ParsedUploadedNodeMetadata {
  readonly contentSize: number;
  readonly contentType: string;
  readonly refs: readonly string[];
}

export interface LeaseDrivenUploadValidation extends ParsedUploadedNodeMetadata {
  readonly storedBytes: number;
}

export interface LeaseDrivenUploadRecord {
  readonly hash: string;
  readonly generation: string;
  readonly temporaryObjectKey: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly cleanupAt: number;
  readonly rejection: SpaceNodeUploadRejection | null;
  readonly validation: LeaseDrivenUploadValidation | null;
}

export interface LeaseDrivenUploadObject {
  readonly storedBytes: number;
}

export interface LeaseDrivenNodeUploadRepository extends CanonicalNodeLeaseRepository {
  countLeaseDrivenUploads(scope: NodeLeaseScope): Promise<number>;
  readCanonicalBytes(scope: NodeLeaseScope, hash: string): Promise<Uint8Array | null>;
  readLeaseDrivenUpload(
    scope: NodeLeaseScope,
    hash: string,
  ): Promise<LeaseDrivenUploadRecord | null>;
  replaceLeaseDrivenUpload(
    scope: NodeLeaseScope,
    expectedGeneration: string | null,
    record: LeaseDrivenUploadRecord,
  ): Promise<boolean>;
  stageLeaseDrivenUploadValidation(
    scope: NodeLeaseScope,
    hash: string,
    generation: string,
    validation: LeaseDrivenUploadValidation,
  ): Promise<boolean>;
  readTemporaryUploadObject(
    scope: NodeLeaseScope,
    temporaryObjectKey: string,
  ): Promise<LeaseDrivenUploadObject | null>;
  readTemporaryUploadBytes(
    scope: NodeLeaseScope,
    temporaryObjectKey: string,
  ): Promise<Uint8Array | null>;
  deleteTemporaryUploadObject(
    scope: NodeLeaseScope,
    temporaryObjectKey: string,
  ): Promise<void>;
  deleteLeaseDrivenUpload(
    scope: NodeLeaseScope,
    hash: string,
    generation: string,
  ): Promise<void>;
  putVerifiedCanonicalBytes(
    scope: NodeLeaseScope,
    hash: string,
    bytes: Uint8Array,
  ): Promise<void>;
}

export type LeaseDrivenNodeUploadResult =
  | { readonly kind: "ready"; readonly result: SpaceNodeLeaseReadyResult }
  | { readonly kind: "awaiting_upload"; readonly upload: LeaseDrivenUploadRecord }
  | {
    readonly kind: "awaiting_replacement_upload";
    readonly upload: LeaseDrivenUploadRecord;
    readonly rejection: SpaceNodeUploadRejection;
  }
  | {
    readonly kind: "validated_awaiting_children";
    readonly childHashes: readonly string[];
  };

/** Semantic persistence boundary for bodyless node renewal and orphan adoption. */
export interface NodeLeaseRepository {
  readNodeLease(scope: NodeLeaseScope, hash: string): Promise<NodeLeaseRecord | null>;
  readCanonicalObject(scope: NodeLeaseScope, hash: string): Promise<CanonicalOrphanObject | null>;
  readCanonicalPrefix(
    scope: NodeLeaseScope,
    hash: string,
    length: number,
  ): Promise<ReadableStream<Uint8Array> | null>;
  isNodeReady(scope: NodeLeaseScope, hash: string): Promise<boolean>;
  renewNodeLease(
    scope: NodeLeaseScope,
    hash: string,
    lease: NodeLeaseRecord,
  ): Promise<void>;
  commitAdoptedCanonicalNode(
    scope: NodeLeaseScope,
    plan: AdoptedCanonicalNodePlan,
  ): Promise<void>;
}

/** Additional persistence operations required by streaming canonical uploads. */
export interface CanonicalNodeLeaseRepository extends NodeLeaseRepository {
  readCanonicalNodeLease(
    scope: NodeLeaseScope,
    hash: string,
  ): Promise<CanonicalNodeLeaseRecord | null>;
  readNodeRefs(scope: NodeLeaseScope, hash: string): Promise<readonly string[]>;
  reserveCanonicalUpload(
    scope: NodeLeaseScope,
    reservation: CanonicalUploadReservation,
  ): Promise<void>;
  putCanonicalObject(
    scope: NodeLeaseScope,
    hash: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<void>;
  commitUploadedCanonicalNode(
    scope: NodeLeaseScope,
    plan: UploadedCanonicalNodeCommit,
  ): Promise<void>;
}

export function clampLeaseDuration(value: number): number {
  return Math.min(Math.max(value, MIN_LEASE_MS), MAX_LEASE_MS);
}

export function parseLeaseDuration(header: string | null): number {
  if (header == null || header === "") return DEFAULT_LEASE_MS;
  const value = Number(header);
  if (!Number.isFinite(value)) {
    throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, "Invalid lease duration");
  }
  return clampLeaseDuration(value);
}

export function nextNodeLease(
  existing: NodeLeaseRecord | null,
  durationMs: number,
  now: number,
): NodeLeaseRecord {
  return {
    leaseStartedAt: existing && existing.leaseExpiresAt > now ? existing.leaseStartedAt : now,
    leaseExpiresAt: Math.max(existing?.leaseExpiresAt ?? 0, now + durationMs),
  };
}

export async function leaseDrivenNodeUpload(input: {
  readonly repository: LeaseDrivenNodeUploadRepository;
  readonly scope: NodeLeaseScope;
  readonly hash: string;
  readonly leaseDurationMs: number;
  readonly createIdentifiers: () => {
    readonly generation: string;
    readonly temporaryObjectKey: string;
  };
  readonly limits?: CanonicalNodeLimits;
  readonly uploadSessionMs?: number;
  readonly uploadCleanupMs?: number;
  readonly maxActiveUploads?: number;
  readonly now?: () => number;
}): Promise<LeaseDrivenNodeUploadResult> {
  validateLeaseHash(input.hash);
  const now = (input.now ?? (() => Date.now()))();
  const leaseDurationMs = clampLeaseDuration(input.leaseDurationMs);
  const existing = await input.repository.readCanonicalNodeLease(input.scope, input.hash);
  const canonical = await input.repository.readCanonicalObject(input.scope, input.hash);

  if (existing !== null) {
    if (canonical === null) {
      throw new NodeOpError(
        503,
        NodeOpErrorCodes.STORAGE,
        `Ready node ${input.hash} is missing canonical content`,
      );
    }
    const lease = nextNodeLease(existing, leaseDurationMs, now);
    await input.repository.renewNodeLease(input.scope, input.hash, lease);
    return { kind: "ready", result: { state: "ready", hash: input.hash, ...lease } };
  }

  let upload = await input.repository.readLeaseDrivenUpload(input.scope, input.hash);
  if (canonical !== null) {
    if (upload === null) {
      upload = createLeaseDrivenUpload(input, now, null);
      await replaceLeaseDrivenUpload(input.repository, input.scope, null, upload);
    }
    let validation = upload.validation;
    if (validation === null) {
      const bytes = await input.repository.readCanonicalBytes(input.scope, input.hash);
      if (bytes === null) {
        throw new NodeOpError(503, NodeOpErrorCodes.STORAGE, "Canonical object disappeared during recovery");
      }
      const validated = await validateLeaseDrivenUpload(input.hash, bytes, input.limits);
      if (!validated.ok) {
        throw new NodeOpError(503, NodeOpErrorCodes.STORAGE, "Canonical orphan failed integrity validation");
      }
      validation = validated.validation;
      if (!await input.repository.stageLeaseDrivenUploadValidation(
        input.scope,
        input.hash,
        upload.generation,
        validation,
      )) {
        throw new NodeOpError(409, NodeOpErrorCodes.CONFLICT, "Canonical upload generation changed");
      }
      upload = { ...upload, validation };
    }
    return publishValidatedLeaseDrivenUpload(input, upload, validation, leaseDurationMs, now);
  }

  if (upload === null) {
    const activeUploads = await input.repository.countLeaseDrivenUploads(input.scope);
    if (activeUploads >= (input.maxActiveUploads ?? DEFAULT_MAX_ACTIVE_UPLOADS)) {
      throw new NodeOpError(429, NodeOpErrorCodes.UPLOAD_LIMIT, "Space has too many active node uploads");
    }
    upload = createLeaseDrivenUpload(input, now, null);
    await replaceLeaseDrivenUpload(input.repository, input.scope, null, upload);
  }

  const temporary = await input.repository.readTemporaryUploadObject(
    input.scope,
    upload.temporaryObjectKey,
  );
  if (temporary === null) {
    if (upload.validation !== null) {
      throw new NodeOpError(503, NodeOpErrorCodes.STORAGE, "Validated upload content is missing");
    }
    if (upload.expiresAt <= now) {
      const replacement = createLeaseDrivenUpload(input, now, upload.rejection);
      await replaceLeaseDrivenUpload(input.repository, input.scope, upload.generation, replacement);
      await input.repository.deleteTemporaryUploadObject(input.scope, upload.temporaryObjectKey)
        .catch(() => undefined);
      upload = replacement;
    }
    return upload.rejection === null
      ? { kind: "awaiting_upload", upload }
      : { kind: "awaiting_replacement_upload", upload, rejection: upload.rejection };
  }

  if (upload.validation !== null) {
    return publishValidatedLeaseDrivenUpload(
      input,
      upload,
      upload.validation,
      leaseDurationMs,
      now,
    );
  }

  const maxBytes = input.limits?.maxCanonicalNodeBytes ?? MAX_CANONICAL_NODE_BYTES;
  if (temporary.storedBytes > maxBytes) {
    return replaceRejectedLeaseDrivenUpload(input, upload, {
      code: "NODE_TOO_LARGE",
      message: "Uploaded canonical node exceeds the configured size limit",
    }, now);
  }
  const bytes = await input.repository.readTemporaryUploadBytes(
    input.scope,
    upload.temporaryObjectKey,
  );
  if (bytes === null) {
    return upload.rejection === null
      ? { kind: "awaiting_upload", upload }
      : { kind: "awaiting_replacement_upload", upload, rejection: upload.rejection };
  }
  const validated = await validateLeaseDrivenUpload(input.hash, bytes, input.limits);
  if (!validated.ok) {
    return replaceRejectedLeaseDrivenUpload(input, upload, validated.rejection, now);
  }
  if (!await input.repository.stageLeaseDrivenUploadValidation(
    input.scope,
    input.hash,
    upload.generation,
    validated.validation,
  )) {
    throw new NodeOpError(409, NodeOpErrorCodes.CONFLICT, "Canonical upload generation changed");
  }
  upload = { ...upload, validation: validated.validation };
  return publishValidatedLeaseDrivenUpload(
    input,
    upload,
    validated.validation,
    leaseDurationMs,
    now,
    bytes,
  );
}

async function publishValidatedLeaseDrivenUpload(
  input: Parameters<typeof leaseDrivenNodeUpload>[0],
  upload: LeaseDrivenUploadRecord,
  validation: LeaseDrivenUploadValidation,
  leaseDurationMs: number,
  now: number,
  validatedBytes?: Uint8Array,
): Promise<LeaseDrivenNodeUploadResult> {
  const childHashes: string[] = [];
  const seen = new Set<string>();
  for (const childHash of validation.refs) {
    if (seen.has(childHash)) continue;
    seen.add(childHash);
    if (!await input.repository.isNodeReady(input.scope, childHash)) childHashes.push(childHash);
  }
  if (childHashes.length > 0) {
    return { kind: "validated_awaiting_children", childHashes };
  }

  const bytes = validatedBytes ?? await input.repository.readTemporaryUploadBytes(
    input.scope,
    upload.temporaryObjectKey,
  );
  if (bytes !== null) {
    await input.repository.putVerifiedCanonicalBytes(input.scope, input.hash, bytes);
  } else if (await input.repository.readCanonicalObject(input.scope, input.hash) === null) {
    throw new NodeOpError(503, NodeOpErrorCodes.STORAGE, "Validated upload content is missing");
  }

  const lease = nextNodeLease(null, leaseDurationMs, now);
  await input.repository.commitUploadedCanonicalNode(input.scope, {
    kind: "new",
    hash: input.hash,
    contentSize: validation.contentSize,
    storedBytes: validation.storedBytes,
    contentType: validation.contentType,
    refs: validation.refs,
    ...lease,
  });
  try {
    await input.repository.deleteTemporaryUploadObject(input.scope, upload.temporaryObjectKey);
    await input.repository.deleteLeaseDrivenUpload(input.scope, input.hash, upload.generation);
  } catch {
    // The ready node is authoritative; cleanup_at keeps the temporary object bounded.
  }
  return { kind: "ready", result: { state: "ready", hash: input.hash, ...lease } };
}

async function replaceRejectedLeaseDrivenUpload(
  input: Parameters<typeof leaseDrivenNodeUpload>[0],
  upload: LeaseDrivenUploadRecord,
  rejection: SpaceNodeUploadRejection,
  now: number,
): Promise<LeaseDrivenNodeUploadResult> {
  const replacement = createLeaseDrivenUpload(input, now, rejection);
  await replaceLeaseDrivenUpload(
    input.repository,
    input.scope,
    upload.generation,
    replacement,
  );
  await input.repository.deleteTemporaryUploadObject(input.scope, upload.temporaryObjectKey)
    .catch(() => undefined);
  return { kind: "awaiting_replacement_upload", upload: replacement, rejection };
}

function createLeaseDrivenUpload(
  input: Parameters<typeof leaseDrivenNodeUpload>[0],
  now: number,
  rejection: SpaceNodeUploadRejection | null,
): LeaseDrivenUploadRecord {
  const identifiers = input.createIdentifiers();
  if (identifiers.generation.length === 0 || identifiers.temporaryObjectKey.length === 0) {
    throw new TypeError("Canonical upload identifiers must not be empty");
  }
  const expiresAt = now + (input.uploadSessionMs ?? DEFAULT_UPLOAD_SESSION_MS);
  return {
    hash: input.hash,
    ...identifiers,
    createdAt: now,
    expiresAt,
    cleanupAt: expiresAt + (input.uploadCleanupMs ?? DEFAULT_UPLOAD_CLEANUP_MS),
    rejection,
    validation: null,
  };
}

async function replaceLeaseDrivenUpload(
  repository: LeaseDrivenNodeUploadRepository,
  scope: NodeLeaseScope,
  expectedGeneration: string | null,
  upload: LeaseDrivenUploadRecord,
): Promise<void> {
  if (!await repository.replaceLeaseDrivenUpload(scope, expectedGeneration, upload)) {
    throw new NodeOpError(409, NodeOpErrorCodes.CONFLICT, "Canonical upload generation changed");
  }
}

export async function validateLeaseDrivenUpload(
  hash: string,
  bytes: Uint8Array,
  limits?: CanonicalNodeLimits,
): Promise<
  | { readonly ok: true; readonly validation: LeaseDrivenUploadValidation }
  | { readonly ok: false; readonly rejection: SpaceNodeUploadRejection }
> {
  if (bytes.length > (limits?.maxCanonicalNodeBytes ?? MAX_CANONICAL_NODE_BYTES)) {
    return {
      ok: false,
      rejection: { code: "NODE_TOO_LARGE", message: "Uploaded canonical node exceeds the configured size limit" },
    };
  }
  if (hashToHex(await sha256(bytes)) !== hash) {
    return {
      ok: false,
      rejection: { code: "NODE_DIGEST_MISMATCH", message: "Uploaded canonical bytes did not match the requested node hash" },
    };
  }
  try {
    const parsed = await parseCanonicalNodeStream(bytesToStream(bytes), bytes.length, limits);
    await parsed.body.cancel("Canonical upload validation complete");
    return {
      ok: true,
      validation: {
        storedBytes: bytes.length,
        contentSize: parsed.contentSize,
        contentType: parsed.contentType,
        refs: parsed.refs,
      },
    };
  } catch (error) {
    return {
      ok: false,
      rejection: {
        code: "INVALID_CANONICAL_NODE",
        message: error instanceof Error ? error.message : "Uploaded canonical node is invalid",
      },
    };
  }
}

export async function prepareCanonicalNodeUpload(input: {
  readonly repository: CanonicalDirectUploadRepository;
  readonly scope: NodeLeaseScope;
  readonly hash: string;
  readonly storedBytes: number;
  readonly leaseDurationMs: number;
  readonly createIdentifiers: () => { readonly uploadId: string; readonly temporaryObjectKey: string };
  readonly limits?: CanonicalNodeLimits;
  readonly uploadSessionMs?: number;
  readonly now?: () => number;
}): Promise<CanonicalDirectUploadPrepareResult> {
  validateLeaseHash(input.hash);
  try {
    const result = await leaseReadyNode({
      repository: input.repository,
      scope: input.scope,
      hash: input.hash,
      leaseDurationMs: input.leaseDurationMs,
      limits: input.limits,
      now: input.now,
    });
    return { kind: "ready", result };
  } catch (error) {
    if (!(error instanceof NodeOpError) || error.code !== NodeOpErrorCodes.NOT_FOUND) throw error;
  }
  if (!Number.isSafeInteger(input.storedBytes) || input.storedBytes < 1) {
    throw new NodeOpError(400, NodeOpErrorCodes.UPLOAD_INVALID, "Invalid canonical upload length");
  }
  if (input.storedBytes > (input.limits?.maxCanonicalNodeBytes ?? MAX_CANONICAL_NODE_BYTES)) {
    throw new NodeOpError(413, NodeOpErrorCodes.UPLOAD_INVALID, "Canonical node is too large");
  }

  const now = (input.now ?? (() => Date.now()))();
  const existing = await input.repository.readCanonicalUploadSession(input.scope, input.hash);
  if (existing !== null && existing.expiresAt > now) {
    if (existing.storedBytes !== input.storedBytes) {
      throw new NodeOpError(409, NodeOpErrorCodes.UPLOAD_CONFLICT, "Canonical upload length conflicts with the active session");
    }
    return { kind: "upload", session: existing };
  }

  const identifiers = input.createIdentifiers();
  if (identifiers.uploadId.length === 0 || identifiers.temporaryObjectKey.length === 0) {
    throw new TypeError("Canonical upload identifiers must not be empty");
  }
  const session: CanonicalDirectUploadSession = {
    hash: input.hash,
    uploadId: identifiers.uploadId,
    temporaryObjectKey: identifiers.temporaryObjectKey,
    storedBytes: input.storedBytes,
    leaseDurationMs: input.leaseDurationMs,
    createdAt: now,
    expiresAt: now + (input.uploadSessionMs ?? DEFAULT_UPLOAD_SESSION_MS),
  };
  await input.repository.reserveCanonicalUploadSession(input.scope, session);
  return {
    kind: "upload",
    session,
    ...(existing === null ? {} : { replacedTemporaryObjectKey: existing.temporaryObjectKey }),
  };
}

export async function admitCanonicalNodeUploadFinalization(input: {
  readonly repository: CanonicalDirectUploadRepository;
  readonly scope: NodeLeaseScope;
  readonly hash: string;
  readonly uploadId: string;
  readonly leaseDurationMs: number;
  readonly limits?: CanonicalNodeLimits;
  readonly now?: () => number;
}): Promise<CanonicalDirectUploadFinalizeAdmission> {
  validateLeaseHash(input.hash);
  try {
    const result = await leaseReadyNode({
      repository: input.repository,
      scope: input.scope,
      hash: input.hash,
      leaseDurationMs: input.leaseDurationMs,
      limits: input.limits,
      now: input.now,
    });
    return { kind: "ready", result };
  } catch (error) {
    if (!(error instanceof NodeOpError) || error.code !== NodeOpErrorCodes.NOT_FOUND) throw error;
  }
  const session = await input.repository.readCanonicalUploadSession(input.scope, input.hash);
  if (session === null || session.uploadId !== input.uploadId) {
    throw new NodeOpError(400, NodeOpErrorCodes.UPLOAD_INVALID, "Canonical upload session is invalid");
  }
  const now = (input.now ?? (() => Date.now()))();
  if (session.expiresAt <= now) {
    throw new NodeOpError(410, NodeOpErrorCodes.UPLOAD_EXPIRED, "Canonical upload session expired");
  }
  return { kind: "upload", session };
}

/** Establish an upload fence, or renew immediately when the node is already ready. */
export async function beginCanonicalNodeLease(input: {
  readonly repository: CanonicalNodeLeaseRepository;
  readonly scope: NodeLeaseScope;
  readonly hash: string;
  readonly leaseDurationMs: number;
  readonly declaredLength?: number;
  readonly limits?: CanonicalNodeLimits;
  readonly now?: () => number;
}): Promise<CanonicalNodeLeaseBeginResult> {
  validateLeaseHash(input.hash);
  const existing = await input.repository.readCanonicalNodeLease(input.scope, input.hash);
  if (existing !== null && await input.repository.isNodeReady(input.scope, input.hash)) {
    const lease = nextNodeLease(existing, input.leaseDurationMs, (input.now ?? (() => Date.now()))());
    await input.repository.renewNodeLease(input.scope, input.hash, lease);
    return { kind: "ready", result: { hash: input.hash, ready: true, ...lease } };
  }

  if (input.declaredLength === undefined) {
    throw new NodeOpError(411, NodeOpErrorCodes.INVALID_REQUEST, "Content-Length is required");
  }
  if (input.declaredLength > (input.limits?.maxCanonicalNodeBytes ?? MAX_CANONICAL_NODE_BYTES)) {
    throw new NodeOpError(413, NodeOpErrorCodes.INVALID_REQUEST, "Canonical node is too large");
  }

  const now = (input.now ?? (() => Date.now()))();
  await input.repository.reserveCanonicalUpload(input.scope, {
    hash: input.hash,
    storedBytes: input.declaredLength,
    createdAt: now,
    expiresAt: now + MAX_LEASE_MS,
  });
  return {
    kind: "upload",
    plan: {
      hash: input.hash,
      storedBytes: input.declaredLength,
      leaseDurationMs: input.leaseDurationMs,
    },
  };
}

/** Stream canonical bytes to their immutable hash-addressed object outside a mutation gate. */
export async function uploadCanonicalNode(input: {
  readonly repository: CanonicalNodeLeaseRepository;
  readonly scope: NodeLeaseScope;
  readonly plan: CanonicalNodeUploadPlan;
  readonly body: ReadableStream<Uint8Array>;
}): Promise<void> {
  try {
    await input.repository.putCanonicalObject(input.scope, input.plan.hash, input.body);
  } catch (error) {
    throw new NodeOpError(
      400,
      NodeOpErrorCodes.INVALID_REQUEST,
      isChecksumMismatch(error)
        ? "Canonical node checksum does not match its hash"
        : "Canonical node upload failed",
    );
  }
}

/** Re-read mutable state and atomically publish metadata and a lease after upload. */
export async function finalizeCanonicalNodeLease(input: {
  readonly repository: CanonicalNodeLeaseRepository;
  readonly scope: NodeLeaseScope;
  readonly plan: CanonicalNodeUploadPlan;
  readonly limits?: CanonicalNodeLimits;
  readonly now?: () => number;
  /** Metadata parsed from the upload stream (tee) while it was stored. When
   *  present the finalize step skips the R2 read-back entirely; the upload was
   *  already checksum-verified by storage (`sha256`), so the parsed values are
   *  authoritative for the exact bytes that were stored. */
  readonly parsed?: ParsedUploadedNodeMetadata;
}): Promise<CasLeaseResult> {
  validateLeaseHash(input.plan.hash);
  const existing = await input.repository.readCanonicalNodeLease(input.scope, input.plan.hash);
  const now = (input.now ?? (() => Date.now()))();

  let parsed: ParsedUploadedNodeMetadata;
  if (input.parsed !== undefined) {
    parsed = input.parsed;
  } else {
    try {
      parsed = await inspectCanonicalNode(
        input.repository,
        input.scope,
        input.plan.hash,
        input.plan.storedBytes,
        input.limits,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid canonical node";
      throw new NodeOpError(
        message.includes("too large") ? 413 : 400,
        NodeOpErrorCodes.INVALID_REQUEST,
        message,
      );
    }
  }

  if (existing !== null) {
    const refs = await input.repository.readNodeRefs(input.scope, input.plan.hash);
    if (
      existing.contentSize !== parsed.contentSize
      || existing.contentType !== parsed.contentType
      || !sameRefs(refs, parsed.refs)
    ) {
      throw new NodeOpError(409, NodeOpErrorCodes.CONFLICT, "Immutable metadata mismatch");
    }
  }

  for (const childHash of parsed.refs) {
    if (!await input.repository.isNodeReady(input.scope, childHash)) {
      throw new NodeOpError(
        409,
        NodeOpErrorCodes.NOT_READY,
        `Child node ${childHash} is not ready`,
      );
    }
  }

  const lease = nextNodeLease(existing, input.plan.leaseDurationMs, now);
  await input.repository.commitUploadedCanonicalNode(input.scope, existing === null ? {
    kind: "new",
    hash: input.plan.hash,
    contentSize: parsed.contentSize,
    storedBytes: input.plan.storedBytes,
    contentType: parsed.contentType,
    refs: parsed.refs,
    ...lease,
  } : {
    kind: "existing",
    hash: input.plan.hash,
    storedBytes: input.plan.storedBytes,
    ...lease,
  });
  return { hash: input.plan.hash, ready: true, ...lease };
}

/** Stream a canonical node to storage, validate its stored envelope, and establish its lease. */
export async function leaseCanonicalNode(input: {
  readonly repository: CanonicalNodeLeaseRepository;
  readonly scope: NodeLeaseScope;
  readonly hash: string;
  readonly leaseDurationMs: number;
  readonly body: ReadableStream<Uint8Array>;
  readonly declaredLength?: number;
  readonly limits?: CanonicalNodeLimits;
  readonly now?: () => number;
}): Promise<CasLeaseResult> {
  let begin: CanonicalNodeLeaseBeginResult;
  try {
    begin = await beginCanonicalNodeLease(input);
  } catch (error) {
    await input.body.cancel("Canonical upload rejected").catch(() => undefined);
    throw error;
  }
  if (begin.kind === "ready") {
    await input.body.cancel("Node is already ready").catch(() => undefined);
    return begin.result;
  }
  await uploadCanonicalNode({
    repository: input.repository,
    scope: input.scope,
    plan: begin.plan,
    body: input.body,
  });
  return finalizeCanonicalNodeLease({
    repository: input.repository,
    scope: input.scope,
    plan: begin.plan,
    limits: input.limits,
    now: input.now,
  });
}

/** Renew an existing ready node, or adopt a verified canonical object without a row. */
export async function leaseReadyNode(input: {
  readonly repository: NodeLeaseRepository;
  readonly scope: NodeLeaseScope;
  readonly hash: string;
  readonly leaseDurationMs: number;
  readonly limits?: CanonicalNodeLimits;
  readonly now?: () => number;
}): Promise<CasLeaseResult> {
  validateLeaseHash(input.hash);

  const now = (input.now ?? (() => Date.now()))();
  const existing = await input.repository.readNodeLease(input.scope, input.hash);
  if (existing !== null) {
    if (!await input.repository.isNodeReady(input.scope, input.hash)) {
      throw new NodeOpError(
        409,
        NodeOpErrorCodes.NOT_READY,
        `Node ${input.hash} is not ready`,
      );
    }
    const lease = nextNodeLease(existing, input.leaseDurationMs, now);
    await input.repository.renewNodeLease(input.scope, input.hash, lease);
    return { hash: input.hash, ready: true, ...lease };
  }

  const object = await input.repository.readCanonicalObject(input.scope, input.hash);
  if (
    object === null
    || object.storedBytes > (input.limits?.maxCanonicalNodeBytes ?? MAX_CANONICAL_NODE_BYTES)
    || object.sha256Hex !== input.hash
  ) {
    throw new NodeOpError(404, NodeOpErrorCodes.NOT_FOUND, `Node ${input.hash} not found`);
  }

  let parsed: Awaited<ReturnType<typeof parseCanonicalNodeStream>>;
  try {
    parsed = await inspectCanonicalNode(
      input.repository,
      input.scope,
      input.hash,
      object.storedBytes,
      input.limits,
    );
  } catch (error) {
    throw new NodeOpError(
      409,
      NodeOpErrorCodes.CONFLICT,
      error instanceof Error ? error.message : "Canonical orphan is invalid",
    );
  }

  for (const childHash of parsed.refs) {
    if (!await input.repository.isNodeReady(input.scope, childHash)) {
      throw new NodeOpError(
        409,
        NodeOpErrorCodes.NOT_READY,
        `Child node ${childHash} is not ready`,
      );
    }
  }

  const lease = nextNodeLease(null, input.leaseDurationMs, now);
  await input.repository.commitAdoptedCanonicalNode(input.scope, {
    hash: input.hash,
    contentSize: parsed.contentSize,
    contentType: parsed.contentType,
    refs: parsed.refs,
    storedBytes: object.storedBytes,
    ...lease,
    reservationCreatedAt: now,
    reservationExpiresAt: now + MAX_LEASE_MS,
  });
  return { hash: input.hash, ready: true, ...lease };
}

async function inspectCanonicalNode(
  repository: NodeLeaseRepository,
  scope: NodeLeaseScope,
  hash: string,
  storedBytes: number,
  limits?: CanonicalNodeLimits,
): Promise<Awaited<ReturnType<typeof parseCanonicalNodeStream>>> {
  const prefixLimit = HEADER_SIZE
    + MAX_CONTENT_TYPE_LENGTH
    + (limits?.maxNodeRefs ?? MAX_NODE_REFS) * HASH_SIZE;
  const prefix = await repository.readCanonicalPrefix(
    scope,
    hash,
    Math.min(storedBytes, prefixLimit),
  );
  if (prefix === null) throw new Error("Canonical node disappeared during inspection");
  const parsed = await parseCanonicalNodeStream(prefix, storedBytes, limits);
  await parsed.body.cancel("Canonical prefix inspection complete");
  return parsed;
}

function validateLeaseHash(hash: string): void {
  try {
    validateHash(hash);
  } catch (error) {
    throw new NodeOpError(
      400,
      NodeOpErrorCodes.INVALID_REQUEST,
      error instanceof Error ? error.message : "Invalid hash",
    );
  }
}

function sameRefs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((hash, index) => hash === right[index]);
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** R2 reports checksum mismatches when the uploaded bytes do not hash to the
 *  requested sha256. Recognize it without leaking platform error text. */
function isChecksumMismatch(error: unknown): boolean {
  return error instanceof Error
    && /checksum/i.test(error.message)
    && /did not match|mismatch/i.test(error.message);
}

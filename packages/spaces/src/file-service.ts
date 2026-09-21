import {
  createTenantFileSystem,
  FileManifestMaxPathBytes,
  type TenantFileRoot,
  type TenantFileRootCatalog,
  type TenantFileStat,
  type TenantFileSystem,
} from "@unicas/tenant-file-client";
import type {
  SpaceCasClient,
  SpaceNodeLeaseOptions,
  SpaceNodeLeaseResult,
} from "@unicas/tenant-client";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createPrincipalCasClient,
  type CapabilityConfig,
  type SpaceAccess,
} from "./capability.js";
import {
  D1FileRootCatalog,
  type PendingRootRelease,
} from "./file-root-catalog.js";
import type { PrincipalContext } from "./repository.js";

export const DefaultMaximumUploadBytes = 40 * 1024 * 1024;
export const MaximumUploadBytes = 64 * 1024 * 1024;
export const SpacesBlobChunkBytes = 1024 * 1024;

export interface UploadEvidence {
  readonly leaseRequests: number;
  readonly nodeCount: number;
  readonly readyNodes: number;
  readonly uploadRequiredNodes: number;
}

export class FileServiceError extends Error {
  constructor(
    readonly code:
      | "invalid_path"
      | "invalid_name"
      | "invalid_revision"
      | "file_too_large"
      | "root_not_provisioned"
      | "root_release_pending"
      | "root_revision_conflict"
      | "root_ref_unconfirmed",
    readonly status: 400 | 409 | 413 | 503,
    message: string,
  ) {
    super(message);
  }
}

export interface DirectoryResult {
  readonly path: string;
  readonly revision: number;
  readonly entries: readonly TenantFileStat[];
}

export interface MutationResult {
  readonly rootId: string;
  readonly revision: number;
  readonly rootRetained: true;
  readonly entry?: TenantFileStat;
  readonly uploadEvidence?: UploadEvidence;
}

interface LeaseEvidenceTracker {
  mark(): number;
  summarize(mark: number): UploadEvidence;
}

interface ReconciliationCatalog extends TenantFileRootCatalog {
  listPendingReleases(limit?: number): Promise<readonly PendingRootRelease[]>;
  completePendingRelease(requestId: string): Promise<void>;
}

export class SpacesFileService {
  readonly #cas: SpaceCasClient;
  readonly #fileSystem: TenantFileSystem;
  readonly #maximumUploadBytes: number;
  readonly #leaseEvidence: LeaseEvidenceTracker | undefined;
  readonly #catalog: ReconciliationCatalog | undefined;

  constructor(
    cas: SpaceCasClient,
    fileSystem: TenantFileSystem,
    maximumUploadBytes = DefaultMaximumUploadBytes,
    leaseEvidence?: LeaseEvidenceTracker,
    catalog?: ReconciliationCatalog,
  ) {
    if (!Number.isSafeInteger(maximumUploadBytes) || maximumUploadBytes <= 0 || maximumUploadBytes > MaximumUploadBytes) {
      throw new RangeError(`maximumUploadBytes must be between 1 and ${MaximumUploadBytes}`);
    }
    this.#cas = cas;
    this.#fileSystem = fileSystem;
    this.#maximumUploadBytes = maximumUploadBytes;
    this.#leaseEvidence = leaseEvidence;
    this.#catalog = catalog;
  }

  async list(path: string): Promise<DirectoryResult> {
    const normalizedPath = normalizeAbsolutePath(path, true);
    const root = await this.#openRoot();
    const entries = [...await root.readdir(normalizedPath)].sort(compareEntries);
    return { path: normalizedPath, revision: root.info.revision, entries };
  }

  async createFolder(input: {
    readonly parentPath: string;
    readonly name: string;
    readonly revision: number;
  }): Promise<MutationResult> {
    const path = childPath(input.parentPath, input.name);
    return this.#mutate(input.revision, async (root) => {
      await root.mkdir(path);
      return path;
    });
  }

  async uploadFile(input: {
    readonly parentPath: string;
    readonly name: string;
    readonly contentType: string;
    readonly content: Blob;
    readonly revision: number;
    readonly signal?: AbortSignal;
    readonly onProgress?: (uploadedBytes: number) => void;
  }): Promise<MutationResult> {
    if (input.content.size > this.#maximumUploadBytes) {
      throw new FileServiceError(
        "file_too_large",
        413,
        `File size exceeds the ${this.#maximumUploadBytes}-byte limit`,
      );
    }
    const path = childPath(input.parentPath, input.name);
    const evidenceMark = this.#leaseEvidence?.mark();
    let uploadEvidence: UploadEvidence | undefined;
    const result = await this.#mutate(input.revision, async (root) => {
      await root.write(path, input.content, {
        contentType: input.contentType || "application/octet-stream",
        size: input.content.size,
        signal: input.signal,
        onProgress: input.onProgress,
      });
      if (evidenceMark !== undefined) uploadEvidence = this.#leaseEvidence?.summarize(evidenceMark);
      return path;
    });
    return uploadEvidence ? { ...result, uploadEvidence } : result;
  }

  async renameFile(input: {
    readonly path: string;
    readonly name: string;
    readonly revision: number;
  }): Promise<MutationResult> {
    const source = normalizeAbsolutePath(input.path, false);
    const destination = childPath(parentPath(source), input.name);
    return this.#mutate(input.revision, async (root) => {
      const stat = await root.stat(source);
      if (stat.type !== "file") throw new FileServiceError("invalid_path", 400, "Only files can be renamed");
      await root.move(source, destination);
      return destination;
    });
  }

  async deleteFile(input: { readonly path: string; readonly revision: number }): Promise<MutationResult> {
    const path = normalizeAbsolutePath(input.path, false);
    return this.#mutate(input.revision, async (root) => {
      const stat = await root.stat(path);
      if (stat.type !== "file") throw new FileServiceError("invalid_path", 400, "Only files can be deleted");
      await root.remove(path);
    });
  }

  async removePathForCleanup(input: {
    readonly path: string;
    readonly revision: number;
  }): Promise<MutationResult> {
    const path = normalizeAbsolutePath(input.path, false);
    return this.#mutate(input.revision, async (root) => {
      await root.remove(path);
    });
  }

  async cleanupPaths(paths: readonly string[]): Promise<MutationResult> {
    const normalizedPaths = [...new Set(paths.map((path) => normalizeAbsolutePath(path, false)))]
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    const root = await this.#openRoot();
    for (const path of normalizedPaths) {
      try {
        await root.stat(path);
      } catch (error) {
        if (error instanceof TypeError && error.message.startsWith("Path not found")) continue;
        throw error;
      }
      await root.remove(path);
    }
    const committed = await root.commit();
    await this.#assertRetained(committed.manifestHash);
    await this.reconcilePendingReleases();
    return { rootId: committed.rootId, revision: committed.revision, rootRetained: true };
  }

  async ensureSmokeRoot(): Promise<void> {
    const roots = await this.#fileSystem.listRoots();
    if (roots.length === 0) {
      await this.#fileSystem.createRoot("Release smoke");
      return;
    }
    throw new FileServiceError("root_not_provisioned", 503, "The smoke Principal has a stale file root");
  }

  async releaseSmokeRoot(runId: string): Promise<void> {
    if (!this.#catalog) throw new FileServiceError("root_not_provisioned", 503, "The smoke catalog is unavailable");
    await this.reconcilePendingReleases();
    const roots = await this.#fileSystem.listRoots();
    if (roots.length === 0) return;
    if (roots.length !== 1) {
      throw new FileServiceError("root_not_provisioned", 503, "The smoke Principal has multiple file roots");
    }
    const root = roots[0];
    const released = await this.#cas.updateRootRefs({
      requestId: `spaces-smoke:${runId}:release-root`,
      changes: { [root.manifestHash]: -1 },
    });
    if (!released.success) throw new FileServiceError("root_ref_unconfirmed", 503, "The smoke Root could not be released");
    try {
      await this.#catalog.delete({ rootId: root.rootId, revision: root.revision });
    } catch (error) {
      if ((await this.#catalog.list()).length === 0) return;
      throw error;
    }
  }

  async reconcilePendingReleases(limit = 20): Promise<number> {
    if (!this.#catalog) return 0;
    const pending = await this.#catalog.listPendingReleases(limit);
    let completed = 0;
    for (const release of pending) {
      try {
        if (await this.#rootRefCount(release.manifestHash) > 0) {
          const result = await this.#cas.updateRootRefs({
            requestId: release.requestId,
            changes: { [release.manifestHash]: -1 },
          });
          if (!result.success) throw new Error("Root Ref release failed");
        }
        await this.#catalog.completePendingRelease(release.requestId);
        completed += 1;
      } catch {
        throw new FileServiceError(
          "root_release_pending",
          503,
          "A previous file Root release is pending reconciliation",
        );
      }
    }
    return completed;
  }

  async download(path: string, signal?: AbortSignal): Promise<{
    readonly body: ReadableStream<Uint8Array>;
    readonly stat: TenantFileStat;
  }> {
    const normalizedPath = normalizeAbsolutePath(path, false);
    const root = await this.#openRoot();
    const stat = await root.stat(normalizedPath);
    if (stat.type !== "file") throw new FileServiceError("invalid_path", 400, "Path is not a file");
    return { body: await root.read(normalizedPath, undefined, signal), stat };
  }

  async #mutate(
    expectedRevision: number,
    change: (root: TenantFileRoot) => Promise<string | void>,
  ): Promise<MutationResult> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new FileServiceError("invalid_revision", 400, "A positive Root revision is required");
    }
    const root = await this.#openRoot();
    if (root.info.revision !== expectedRevision) {
      throw new FileServiceError("root_revision_conflict", 409, "The file list changed; reload and retry");
    }
    const changedPath = await change(root);
    const committed = await root.commit();
    await this.#assertRetained(committed.manifestHash);
    await this.reconcilePendingReleases();
    const entry = changedPath === undefined ? undefined : await root.stat(changedPath);
    return { rootId: committed.rootId, revision: committed.revision, rootRetained: true, ...(entry ? { entry } : {}) };
  }

  async #openRoot(): Promise<TenantFileRoot> {
    const roots = await this.#fileSystem.listRoots();
    if (roots.length !== 1) {
      throw new FileServiceError(
        "root_not_provisioned",
        503,
        roots.length === 0 ? "The Principal has no provisioned file root" : "The Principal has multiple file roots",
      );
    }
    return this.#fileSystem.openRoot(roots[0].rootId);
  }

  async #assertRetained(manifestHash: string): Promise<void> {
    if (await this.#rootRefCount(manifestHash) > 0) return;
    throw new FileServiceError("root_ref_unconfirmed", 503, "The committed Root Ref could not be confirmed");
  }

  async #rootRefCount(manifestHash: string): Promise<number> {
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await this.#cas.listRootRefs({ limit: 100, ...(cursor ? { cursor } : {}) });
      const reference = page.items.find((item) => item.hash === manifestHash);
      if (reference) return reference.refCount;
      if (!page.nextCursor) return 0;
      cursor = page.nextCursor;
    }
    throw new FileServiceError(
      "root_release_pending",
      503,
      "Root Ref reconciliation exceeded its bounded scan",
    );
  }
}

export async function createSpacesFileService(input: {
  readonly db: D1Database;
  readonly principal: PrincipalContext;
  readonly capability: CapabilityConfig;
  readonly access?: readonly SpaceAccess[];
  readonly maximumUploadBytes?: number;
  readonly fetcher?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
}): Promise<SpacesFileService> {
  const baseCas = await createPrincipalCasClient(
    input.capability,
    input.principal,
    input.access ?? ["read", "write"],
    input.fetcher,
  );
  const { cas, evidence } = createLeaseEvidenceClient(baseCas);
  const catalog = new D1FileRootCatalog(input.db, input.principal.principalId);
  return new SpacesFileService(cas, createTenantFileSystem({
    cas,
    catalog,
    blobOptions: {
      chunkBytes: SpacesBlobChunkBytes,
      ...(input.fetcher ? { uploadFetcher: input.fetcher } : {}),
    },
  }), input.maximumUploadBytes, evidence, catalog);
}

export function createLeaseEvidenceClient(baseCas: SpaceCasClient): {
  readonly cas: SpaceCasClient;
  readonly evidence: LeaseEvidenceTracker;
} {
  const events: { readonly hash: string; readonly state: SpaceNodeLeaseResult["state"] }[] = [];
  const leaseNode = async (
    hash: string,
    options?: SpaceNodeLeaseOptions,
  ): Promise<SpaceNodeLeaseResult> => {
    const result = options === undefined
      ? await baseCas.leaseNode(hash)
      : await baseCas.leaseNode(hash, options);
    events.push({ hash, state: result.state });
    return result;
  };
  const cas = Object.freeze({
    readMetadata: baseCas.readMetadata,
    readContent: baseCas.readContent,
    leaseNode: leaseNode as SpaceCasClient["leaseNode"],
    updateRootRefs: baseCas.updateRootRefs,
    listRootRefs: baseCas.listRootRefs,
    usage: baseCas.usage,
    gc: baseCas.gc,
  });
  const evidence: LeaseEvidenceTracker = Object.freeze({
    mark: () => events.length,
    summarize(mark: number) {
      const observed = events.slice(mark);
      const nodes = new Set(observed.map((event) => event.hash));
      const ready = new Set(observed.filter((event) => event.state === "ready").map((event) => event.hash));
      const uploadRequired = new Set(observed
        .filter((event) => event.state === "awaiting_upload" || event.state === "awaiting_replacement_upload")
        .map((event) => event.hash));
      return {
        leaseRequests: observed.length,
        nodeCount: nodes.size,
        readyNodes: ready.size,
        uploadRequiredNodes: uploadRequired.size,
      };
    },
  });
  return { cas, evidence };
}

export function normalizeAbsolutePath(path: string, allowRoot: boolean): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new FileServiceError("invalid_path", 400, "Path must be an absolute path without controls");
  }
  if (path === "/") {
    if (allowRoot) return path;
    throw new FileServiceError("invalid_path", 400, "The root directory cannot be modified");
  }
  if (path.endsWith("/") || path.split("/").slice(1).some((segment) => !isValidName(segment))) {
    throw new FileServiceError("invalid_path", 400, "Path contains an invalid segment");
  }
  if (new TextEncoder().encode(path).length > FileManifestMaxPathBytes) {
    throw new FileServiceError("invalid_path", 400, "Path is too long");
  }
  return path;
}

export function childPath(parent: string, name: string): string {
  const normalizedParent = normalizeAbsolutePath(parent, true);
  if (!isValidName(name)) {
    throw new FileServiceError("invalid_name", 400, "Name must be one non-reserved path segment");
  }
  return normalizeAbsolutePath(`${normalizedParent === "/" ? "" : normalizedParent}/${name}`, false);
}

function isValidName(name: string): boolean {
  return name.length > 0
    && name !== "."
    && name !== ".."
    && !name.includes("/")
    && !name.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(name)
    && new TextEncoder().encode(name).length <= 255;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === 0 ? "/" : path.slice(0, separator);
}

function compareEntries(left: TenantFileStat, right: TenantFileStat): number {
  return left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1;
}
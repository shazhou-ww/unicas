/**
 * CAS Durable Object — per-`(appId, spaceId)` mutation coordinator.
 *
 * Short begin/finalize, Root Ref, and GC mutations use an explicit in-instance
 * gate. Canonical request bodies stream to R2 outside that gate, so unrelated
 * uploads and reads do not queue behind a slow body. An upload reservation is
 * the durable GC fence across that unlocked interval. Root Ref commands flow
 * ONE way to the `(appId, refDomain)` domain DO, so lock ordering cannot
 * cycle.
 */

import type { D1Database, R2Bucket, DurableObjectNamespace } from "@cloudflare/workers-types";
import {
  collectExpiredUnreferencedNodes,
  DEFAULT_GC_MAX_NODES,
  NodeOpError,
  NodeOpErrorCodes,
  readNodeContent,
  readNodeMetadata,
  readNodeUsage,
} from "@unicas/service";
import { canonicalComposite } from "./do-names.js";
import {
  cleanupExpiredLeaseDrivenUploads,
  leaseDrivenNodeUpload,
  leaseReadyNode,
} from "./nodes.js";
import { CloudflareNodeGcRepository } from "./node-gc.js";
import { CloudflareNodeReadRepository } from "./node-read.js";
import { CloudflareNodeUsageRepository } from "./node-usage.js";
import { canonicalizeRootRefsUpdate, listRootRefs, parseRootRefsBody } from "./root-refs.js";
import { RootRefsErrorCodes, RootRefsValidationError } from "./root-refs.js";
import { ServerTiming } from "./timing.js";
import { R2UploadPresigner } from "./r2-upload-presigner.js";
import { logUnexpectedError, traceNodeValidation } from "./observability.js";
import { runtimeTracing } from "./runtime-tracing.js";

export interface SpaceCasDoEnv {
  CAS_DB: D1Database;
  CAS_R2: R2Bucket;
  /** Root Ref domain DO namespace (one-way calls only). */
  CAS_DOMAIN_DO: DurableObjectNamespace;
  CAS_R2_ACCOUNT_ID?: string;
  CAS_R2_BUCKET_NAME?: string;
  CAS_R2_ACCESS_KEY_ID?: string;
  CAS_R2_SECRET_ACCESS_KEY?: string;
  CAS_UPLOAD_URL_EXPIRY_SECONDS?: string;
}

export class CasDurableObject {
  readonly #env: SpaceCasDoEnv;
  #mutationTail: Promise<void> = Promise.resolve();
  readonly #activeLeaseEvaluations = new Map<string, Promise<unknown>>();
  /** Positive node-ready cache (hash -> expiry) shared by every repository
   *  built in this DO, so child-ready checks and renewals skip the R2 HEAD. */
  readonly #readyCache = new Map<string, number>();

  constructor(_state: DurableObjectState, env: SpaceCasDoEnv) {
    this.#env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const started = performance.now();
    const timing = new ServerTiming();
    const url = new URL(request.url);
    const scope = physicalScope(request);
    if (scope instanceof Response) return timing.decorate(scope);
    const { appId, spaceId } = scope;
    const store = {
      db: this.#env.CAS_DB,
      bucket: this.#env.CAS_R2,
      appId: appId,
      spaceId: spaceId,
      timing,
      readyCache: this.#readyCache,
    };

    try {
      let response: Response;
      if (url.pathname === "/updateRootRefs" && request.method === "POST") {
        response = await this.#withMutation(() => this.#forwardRootRefs(request, appId, spaceId));
      } else if (url.pathname === "/rootRefs" && request.method === "GET") {
        const limit = parseRootRefsLimit(url.searchParams.get("limit"));
        const cursor = parseRootRefsCursor(url.searchParams.get("cursor"));
        response = jsonResponse(await listRootRefs({
          db: store.db,
          appId: appId,
          spaceId: spaceId,
          refDomain: requireHeader(request, "X-CAS-Ref-Domain"),
          limit,
          cursor,
        }));
      } else if (url.pathname === "/lease" && request.method === "POST") {
        response = jsonResponse(await this.#handleLease(request, store));
      } else if (url.pathname === "/read" && request.method === "GET") {
        response = await this.#handleRead(request, store);
      } else if (url.pathname === "/metadata" && request.method === "GET") {
        response = await this.#handleMetadata(request, store);
      } else if (url.pathname === "/usage" && request.method === "GET") {
        response = jsonResponse(await readNodeUsage({
          repository: new CloudflareNodeUsageRepository(store.db, store.bucket),
          scope: { appId: store.appId, spaceId: store.spaceId },
        }));
      } else if (url.pathname === "/gc" && request.method === "POST") {
        response = jsonResponse(await this.#handleGc(request, store));
      } else {
        response = Response.json(
          { error: "SERVICE_UNAVAILABLE", message: "Space CAS operation not implemented yet" },
          { status: 501 },
        );
      }
      timing.record("cas_do_route", performance.now() - started);
      return timing.decorate(response);
    } catch (error) {
      timing.record("cas_do_route", performance.now() - started);
      if (error instanceof NodeOpError) {
        return timing.decorate(Response.json(
          { error: error.code, message: error.message },
          { status: error.status, headers: error.headers },
        ));
      }
      logUnexpectedError({ event: "unicas_space_operation_failed" }, error);
      return timing.decorate(Response.json(
        { error: NodeOpErrorCodes.STORAGE, message: "Space CAS operation failed" },
        { status: 503 },
      ));
    }
  }

  // ─── Node storage operations ──────────────────────────────

  async #handleLease(request: Request, store: Parameters<typeof leaseReadyNode>[0]): Promise<unknown> {
    const hash = requireHeader(request, "X-CAS-Hash");
    return this.#handleSpaceLease(request, store, hash);
  }

  async #handleSpaceLease(
    request: Request,
    store: Parameters<typeof leaseReadyNode>[0],
    hash: string,
  ): Promise<unknown> {
    const body: unknown = await request.json().catch(() => null);
    if (
      typeof body !== "object"
      || body === null
      || Array.isArray(body)
      || Object.keys(body).length !== 1
    ) {
      throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, "leaseDurationMs must be a positive integer");
    }
    const leaseDurationMs = (body as Record<string, unknown>)["leaseDurationMs"];
    if (!Number.isSafeInteger(leaseDurationMs) || (leaseDurationMs as number) <= 0) {
      throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, "leaseDurationMs must be a positive integer");
    }
    const now = Date.now();
    const uploadExpirySeconds = this.#uploadExpirySeconds();
    const uploadKey = `${store.appId}\0${store.spaceId}\0${hash}`;
    const active = this.#activeLeaseEvaluations.get(uploadKey);
    if (active !== undefined) return active;
    const evaluation = this.#evaluateSpaceLease(
      store,
      hash,
      leaseDurationMs as number,
      uploadExpirySeconds,
      now,
    );
    this.#activeLeaseEvaluations.set(uploadKey, evaluation);
    try {
      return await evaluation;
    } finally {
      if (this.#activeLeaseEvaluations.get(uploadKey) === evaluation) {
        this.#activeLeaseEvaluations.delete(uploadKey);
      }
    }
  }

  async #evaluateSpaceLease(
    store: Parameters<typeof leaseReadyNode>[0],
    hash: string,
    leaseDurationMs: number,
    uploadExpirySeconds: number,
    now: number,
  ): Promise<unknown> {
    const result = await this.#withMutation(() => leaseDrivenNodeUpload(store, {
      hash,
      leaseDurationMs,
      uploadSessionMs: uploadExpirySeconds * 1000,
      createIdentifiers: () => {
        const id = crypto.randomUUID();
        return { generation: id, temporaryObjectKey: `_uploads/v2/${id}` };
      },
      instrumentation: {
        validate: (operation) => traceNodeValidation(runtimeTracing, operation),
      },
      now: () => now,
    }));
    if (result.kind === "ready") return result.result;
    if (result.kind === "validated_awaiting_children") {
      return { state: result.kind, hash, childHashes: result.childHashes };
    }
    const upload = await this.#uploadPresigner(uploadExpirySeconds, now)
      .signPut(result.upload.temporaryObjectKey);
    if (result.kind === "awaiting_replacement_upload") {
      return { state: result.kind, hash, rejection: result.rejection, upload };
    }
    return {
      state: result.kind,
      hash,
      upload,
    };
  }

  #uploadPresigner(expiresInSeconds: number, now: number): R2UploadPresigner {
    const accountId = this.#env.CAS_R2_ACCOUNT_ID;
    const bucketName = this.#env.CAS_R2_BUCKET_NAME;
    const accessKeyId = this.#env.CAS_R2_ACCESS_KEY_ID;
    const secretAccessKey = this.#env.CAS_R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
      throw new NodeOpError(503, NodeOpErrorCodes.STORAGE, "Direct canonical upload is not configured");
    }
    return new R2UploadPresigner({
      accountId,
      bucketName,
      accessKeyId,
      secretAccessKey,
      expiresInSeconds,
      now: () => now,
    });
  }

  #uploadExpirySeconds(): number {
    const configured = Number(this.#env.CAS_UPLOAD_URL_EXPIRY_SECONDS ?? "300");
    if (!Number.isSafeInteger(configured) || configured < 1 || configured > 604_800) {
      throw new NodeOpError(503, NodeOpErrorCodes.STORAGE, "Direct upload expiry is invalid");
    }
    return configured;
  }

  async #handleRead(request: Request, store: Parameters<typeof leaseReadyNode>[0]): Promise<Response> {
    const hash = requireHeader(request, "X-CAS-Hash");
    const content = await readNodeContent({
      repository: new CloudflareNodeReadRepository(store.db, store.bucket, store.timing),
      scope: { appId: store.appId, spaceId: store.spaceId },
      hash,
      rangeHeader: request.headers.get("Range"),
    });
    if (content === null) {
      return Response.json({ error: NodeOpErrorCodes.NOT_FOUND, message: `Node ${hash} not found or not ready` }, { status: 404 });
    }
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Length": String(content.range === undefined
        ? content.contentSize
        : content.range.end - content.range.start + 1),
      "Content-Type": content.contentType,
    });
    if (content.range !== undefined) {
      headers.set("Content-Range", `bytes ${content.range.start}-${content.range.end}/${content.contentSize}`);
    }
    return new Response(content.body, {
      status: content.range === undefined ? 200 : 206,
      headers,
    });
  }

  async #handleMetadata(request: Request, store: Parameters<typeof leaseReadyNode>[0]): Promise<Response> {
    const hash = requireHeader(request, "X-CAS-Hash");
    const result = await readNodeMetadata({
      repository: new CloudflareNodeReadRepository(store.db, store.bucket, store.timing),
      scope: { appId: store.appId, spaceId: store.spaceId },
      hash,
    });
    if (result === null) {
      return Response.json({ error: NodeOpErrorCodes.NOT_FOUND, message: `Node ${hash} not found` }, { status: 404 });
    }
    return jsonResponse(result);
  }

  async #handleGc(request: Request, store: Parameters<typeof leaseReadyNode>[0]): Promise<unknown> {
    const body = await request.json().catch(() => null) as { maxNodes?: number } | null;
    const maxNodes = body?.maxNodes ?? DEFAULT_GC_MAX_NODES;
    if (!Number.isSafeInteger(maxNodes) || maxNodes <= 0) {
      throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, "maxNodes must be a positive integer");
    }
    return this.#withMutation(async () => {
      await cleanupExpiredLeaseDrivenUploads(store, { now: Date.now(), limit: maxNodes });
      return collectExpiredUnreferencedNodes({
        repository: new CloudflareNodeGcRepository(store.db, store.bucket),
        scope: { appId: store.appId, spaceId: store.spaceId },
        maxNodes,
      });
    });
  }

  async #withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /** Canonicalize the caller update and forward one command to the domain DO. */
  async #forwardRootRefs(
    request: Request,
    appId: string,
    spaceId: string,
  ): Promise<Response> {
    let refDomain: string;
    let canonical;
    try {
      refDomain = requireHeader(request, "X-CAS-Ref-Domain");
      const text = await request.text();
      const parsed = parseRootRefsBody(text);
      canonical = await canonicalizeRootRefsUpdate({ ...parsed, refDomain });
    } catch (error) {
      if (error instanceof RootRefsValidationError) {
        return Response.json({ error: error.code, message: error.message }, { status: error.status });
      }
      return Response.json(
        { error: RootRefsErrorCodes.INVALID_REQUEST, message: "root refs update is invalid" },
        { status: 400 },
      );
    }
    const domainId = this.#env.CAS_DOMAIN_DO.idFromName(canonicalComposite(appId, refDomain));
    const stub = this.#env.CAS_DOMAIN_DO.get(domainId);
    const response = await stub.fetch("https://domain.internal/update", {
      method: "POST",
      headers: {
        "X-CAS-App-Id": appId,
        "X-CAS-Space-Id": spaceId,
        "X-CAS-Ref-Domain": refDomain,
      },
      body: JSON.stringify({
        requestId: canonical.requestId,
        changes: Object.fromEntries(canonical.entries),
      }),
    });
    // Pass the domain DO's response through. The workers-types/DOM global
    // Response types disagree structurally; the runtime value is the same.
    return response as unknown as Response;
  }
}

function parseRootRefsLimit(value: string | null): number {
  if (value === null) return 50;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, "root refs limit must be between 1 and 200");
  }
  return limit;
}

function parseRootRefsCursor(value: string | null): string {
  if (value === null) return "";
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, "root refs cursor is invalid");
  }
  return value;
}

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

function requireHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value || value.length === 0) {
    throw new NodeOpError(400, NodeOpErrorCodes.INVALID_REQUEST, `missing ${name}`);
  }
  return value;
}

function physicalScope(request: Request): { appId: string; spaceId: string } | Response {
  const legacyStackId = request.headers.get("X-CAS-Stack-Id");
  const legacyTenantId = request.headers.get("X-CAS-Tenant-Id");
  const appId = request.headers.get("X-CAS-App-Id");
  const spaceId = request.headers.get("X-CAS-Space-Id");
  const hasLegacyScope = legacyStackId !== null || legacyTenantId !== null;
  const hasAppSpaceScope = appId !== null || spaceId !== null;

  if (hasLegacyScope) {
    return Response.json(
      { error: "INVALID_SCOPE_HEADERS", message: "legacy scope headers are forbidden" },
      { status: 400 },
    );
  }
  if (hasAppSpaceScope && appId && spaceId) return { appId, spaceId };
  return Response.json(
    { error: "INVALID_SCOPE_HEADERS", message: "one complete scope header family is required" },
    { status: 400 },
  );
}

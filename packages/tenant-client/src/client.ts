import { CanonicalNodeContentType } from "@unicas/codec";
import {
  CasUploadIdHeader,
  CasUploadLengthHeader,
  appSpaceRoutes,
  casRoutes,
} from "@unicas/tenant-protocol";
import type {
  CasGcResult,
  CasLeaseOperationResult,
  CasLeaseResult,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
} from "@unicas/tenant-protocol";
import { CasClientError } from "./errors.js";
import type {
  CasGcOptions,
  CasLeaseOptions,
  CasListRootRefsOptions,
  CasNodeRange,
  CasNodeSource,
  CasRootRefsResult,
  SpaceCasClient,
  SpaceCasClientConfig,
  TenantCasClient,
  TenantCasClientConfig,
} from "./types.js";

interface CasClientRoutes {
  readMetadata(hash: string): string;
  readContent(hash: string): string;
  lease(hash: string): string;
  updateRootRefs(): string;
  listRootRefs(options: CasListRootRefsOptions): string;
  usage(): string;
  gc(): string;
}

function validateRange(range: CasNodeRange): void {
  if (!Number.isSafeInteger(range.offset) || range.offset < 0) {
    throw new TypeError("CAS node range offset must be a non-negative safe integer");
  }
  if (range.length !== undefined && (!Number.isSafeInteger(range.length) || range.length < 0)) {
    throw new TypeError("CAS node range length must be a non-negative safe integer");
  }
}

export function createTenantCasClient(config: TenantCasClientConfig): TenantCasClient {
  const path = { stackId: config.stackId, tenantId: config.tenantId };
  return createScopedCasClient(config, path, {
    readMetadata: hash => casRoutes.readMetadata({ ...path, hash }),
    readContent: hash => casRoutes.readContent({ ...path, hash }),
    lease: hash => casRoutes.lease({ ...path, hash }),
    updateRootRefs: () => casRoutes.updateRootRefs(path),
    listRootRefs: options => casRoutes.listRootRefs(path, options),
    usage: () => casRoutes.usage(path),
    gc: () => casRoutes.gc(path),
  });
}

export function createSpaceCasClient(config: SpaceCasClientConfig): SpaceCasClient {
  const path = { appId: config.appId, spaceId: config.spaceId };
  return createScopedCasClient(config, { version: 2, ...path }, {
    readMetadata: hash => appSpaceRoutes.readMetadata({ ...path, hash }),
    readContent: hash => appSpaceRoutes.readContent({ ...path, hash }),
    lease: hash => appSpaceRoutes.lease({ ...path, hash }),
    updateRootRefs: () => appSpaceRoutes.updateRootRefs(path),
    listRootRefs: options => appSpaceRoutes.listRootRefs(path, options),
    usage: () => appSpaceRoutes.usage(path),
    gc: () => appSpaceRoutes.gc(path),
  });
}

function createScopedCasClient(
  config: TenantCasClientConfig | SpaceCasClientConfig,
  scope: Omit<import("./types.js").CasNodeCacheKey, "hash">,
  routes: CasClientRoutes,
): TenantCasClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const fetcher = config.fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };
  const uploadFetcher = config.uploadFetcher ?? fetcher;

  const request = async (
    route: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const token = await config.getToken();
    if (token.length === 0) throw new TypeError("CAS token must not be empty");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetcher.fetch(`${baseUrl}${route}`, { ...init, headers });
  };

  const requireOk = async (response: Response, operation: string): Promise<Response> => {
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: unknown; error?: unknown } | null;
      const detail = typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string" ? body.error : undefined;
      throw new CasClientError(response.status, response.statusText, operation, detail);
    }
    return response;
  };

  const client: TenantCasClient = {
    readMetadata(hash, options: { readonly signal?: AbortSignal } = {}) {
      options.signal?.throwIfAborted();
      const key = { ...scope, hash } as import("./types.js").CasNodeCacheKey;
      const loadMetadata = async (): Promise<CasNodeMetadata> => {
        const response = await requireOk(
          await request(routes.readMetadata(hash), { signal: options.signal }),
          "metadata",
        );
        const body = await response.json() as { metadata: CasNodeMetadata };
        return body.metadata;
      };
      return config.cache?.metadata(key, loadMetadata, options) ?? loadMetadata();
    },

    readContent(hash, range?: CasNodeRange, options: { readonly signal?: AbortSignal } = {}) {
      options.signal?.throwIfAborted();
      if (range !== undefined) validateRange(range);
      const key = { ...scope, hash } as import("./types.js").CasNodeCacheKey;
      const loadContent = async (): Promise<ReadableStream<Uint8Array>> => {
        if (range?.length === 0) {
          return new ReadableStream({ start: controller => controller.close() });
        }
        const headers = range === undefined
          ? undefined
          : { Range: `bytes=${range.offset}-${range.length === undefined ? "" : range.offset + range.length - 1}` };
        const response = await requireOk(
          await request(routes.readContent(hash), { headers, signal: options.signal }),
          "read",
        );
        if (response.body === null) {
          throw new CasClientError(502, "Missing response body", "read");
        }
        return response.body;
      };
      return config.cache?.read(key, range, loadContent, options) ?? loadContent();
    },

    async leaseNode(hash, source?: CasNodeSource, options: CasLeaseOptions = {}) {
      if (source !== undefined && config.uploadMode === "direct") {
        const prepareHeaders = new Headers({
          [CasUploadLengthHeader]: String(source.contentLength),
        });
        if (options.durationMs !== undefined) {
          prepareHeaders.set("X-CAS-Lease-Duration", String(options.durationMs));
        }
        const preparedResponse = await requireOk(
          await request(routes.lease(hash), {
            method: "POST",
            headers: prepareHeaders,
            signal: options.signal,
          }),
          "prepareUpload",
        );
        const prepared = await preparedResponse.json() as CasLeaseOperationResult;
        if (prepared.ready) return prepared;

        const uploadInit: RequestInit = {
          method: prepared.upload.method,
          headers: prepared.upload.headers,
          body: source.body as BodyInit,
          signal: options.signal,
        };
        if (source.body instanceof ReadableStream) {
          (uploadInit as RequestInit & { duplex?: "half" }).duplex = "half";
        }
        const uploadResponse = await uploadFetcher.fetch(prepared.upload.url, uploadInit);
        await uploadResponse.body?.cancel("Direct CAS upload response consumed").catch(() => undefined);
        if (!uploadResponse.ok && uploadResponse.status !== 412) {
          throw new CasClientError(
            uploadResponse.status,
            uploadResponse.statusText,
            "upload",
          );
        }

        const finalizeHeaders = new Headers({ [CasUploadIdHeader]: prepared.uploadId });
        if (options.durationMs !== undefined) {
          finalizeHeaders.set("X-CAS-Lease-Duration", String(options.durationMs));
        }
        const finalized = await requireOk(
          await request(routes.lease(hash), {
            method: "POST",
            headers: finalizeHeaders,
            signal: options.signal,
          }),
          "finalizeUpload",
        );
        return finalized.json() as Promise<CasLeaseResult>;
      }
      const headers = new Headers();
      if (options.durationMs !== undefined) {
        headers.set("X-CAS-Lease-Duration", String(options.durationMs));
      }
      if (source !== undefined) {
        headers.set("Content-Type", CanonicalNodeContentType);
        // 无条件设,不只对流设。服务端(service/src/node-lease.ts)缺 declaredLength
        // 就回 411,而它只认 Content-Length 头。buffer body 的那份长度原先是靠
        // fetch 自动补的 —— 而自动值**活不过一次 Request 重建**:doc service 为了
        // 埋观测会 `new Request(input, init)` 再 `fetch(target, req)`
        // (azure-sdk/src/doc-type-service.ts 的 httpCasFetcher),重建之后 body 变
        // 成流、长度丢失、转 chunked,服务端就再也看不到长度。
        // 长度这一层本来就知道(source.contentLength),没有理由让传输层去猜。
        headers.set("Content-Length", String(source.contentLength));
      }
      const init: RequestInit = {
        method: "POST",
        headers,
        body: source?.body as BodyInit | undefined,
        signal: options.signal,
      };
      if (source?.body instanceof ReadableStream) {
        (init as RequestInit & { duplex?: "half" }).duplex = "half";
      }
      const response = await requireOk(
        await request(routes.lease(hash), init),
        "lease",
      );
      return response.json();
    },

    async updateRootRefs(update: CasRootRefUpdate): Promise<CasRootRefsResult> {
      const response = await requireOk(
        await request(routes.updateRootRefs(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        }),
        "updateRootRefs",
      );
      return response.json() as Promise<CasRootRefsResult>;
    },

    async listRootRefs(options: CasListRootRefsOptions = {}): Promise<CasRootRefsPage> {
      const response = await requireOk(
        await request(routes.listRootRefs(options), { signal: options.signal }),
        "listRootRefs",
      );
      return response.json() as Promise<CasRootRefsPage>;
    },

    async usage(signal?: AbortSignal): Promise<CasUsage> {
      const response = await requireOk(
        await request(routes.usage(), { signal }),
        "usage",
      );
      return response.json() as Promise<CasUsage>;
    },

    async gc(options: CasGcOptions = {}): Promise<CasGcResult> {
      const response = await requireOk(
        await request(routes.gc(), {
          method: "POST",
          headers: options.maxNodes === undefined ? undefined : { "Content-Type": "application/json" },
          body: options.maxNodes === undefined ? undefined : JSON.stringify({ maxNodes: options.maxNodes }),
          signal: options.signal,
        }),
        "gc",
      );
      return response.json() as Promise<CasGcResult>;
    },
  };

  return Object.freeze(client);
}
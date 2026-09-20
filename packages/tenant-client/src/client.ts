import { CanonicalNodeContentType } from "@unicas/codec";
import {
  DefaultSpaceNodeLeaseDurationMs,
  appSpaceRoutes,
  casRoutes,
} from "@unicas/tenant-protocol";
import type {
  CasGcResult,
  CasLeaseResult,
  CasNodeMetadata,
  CasRootRefUpdate,
  CasRootRefsPage,
  CasUsage,
  SpaceNodeLeaseResult,
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
  SpaceNodeLeaseOptions,
  TenantCasClient,
  TenantCasClientConfig,
} from "./types.js";

export const DEFAULT_SPACE_NODE_LEASE_OPTIONS: SpaceNodeLeaseOptions = Object.freeze({
  durationMs: DefaultSpaceNodeLeaseDurationMs,
  signal: null,
});

interface CasClientRoutes {
  readMetadata(hash: string): string;
  readContent(hash: string): string;
  lease(hash: string): string;
  updateRootRefs(): string;
  listRootRefs(options: CasListRootRefsOptions): string;
  usage(): string;
  gc(): string;
}

type SharedCasClient = Omit<TenantCasClient, "leaseNode">;

interface ScopedCasClientContext {
  readonly client: SharedCasClient;
  readonly request: (route: string, init?: RequestInit) => Promise<Response>;
  readonly requireOk: (response: Response, operation: string) => Promise<Response>;
  readonly routes: CasClientRoutes;
}

function withSignal(init: RequestInit, signal: AbortSignal | null | undefined): RequestInit {
  return signal === undefined || signal === null ? init : { ...init, signal };
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
  const scoped = createScopedCasClient(config, path, {
    readMetadata: hash => casRoutes.readMetadata({ ...path, hash }),
    readContent: hash => casRoutes.readContent({ ...path, hash }),
    lease: hash => casRoutes.lease({ ...path, hash }),
    updateRootRefs: () => casRoutes.updateRootRefs(path),
    listRootRefs: options => casRoutes.listRootRefs(path, options),
    usage: () => casRoutes.usage(path),
    gc: () => casRoutes.gc(path),
  });
  return Object.freeze({
    ...scoped.client,
    async leaseNode(hash: string, source?: CasNodeSource, options: CasLeaseOptions = {}) {
      const headers = new Headers();
      if (options.durationMs !== undefined) {
        headers.set("X-CAS-Lease-Duration", String(options.durationMs));
      }
      if (source !== undefined) {
        headers.set("Content-Type", CanonicalNodeContentType);
        headers.set("Content-Length", String(source.contentLength));
      }
      const init = withSignal({
        method: "POST",
        headers,
        ...(source === undefined ? {} : { body: source.body }),
      }, options.signal);
      if (source?.body instanceof ReadableStream) {
        (init as RequestInit & { duplex?: "half" }).duplex = "half";
      }
      const response = await scoped.requireOk(
        await scoped.request(scoped.routes.lease(hash), init),
        "lease",
      );
      return response.json() as Promise<CasLeaseResult>;
    },
  });
}

export function createSpaceCasClient(config: SpaceCasClientConfig): SpaceCasClient {
  const path = { appId: config.appId, spaceId: config.spaceId };
  const scoped = createScopedCasClient(config, { version: 2, ...path }, {
    readMetadata: hash => appSpaceRoutes.readMetadata({ ...path, hash }),
    readContent: hash => appSpaceRoutes.readContent({ ...path, hash }),
    lease: hash => appSpaceRoutes.lease({ ...path, hash }),
    updateRootRefs: () => appSpaceRoutes.updateRootRefs(path),
    listRootRefs: options => appSpaceRoutes.listRootRefs(path, options),
    usage: () => appSpaceRoutes.usage(path),
    gc: () => appSpaceRoutes.gc(path),
  });
  const leaseNode = async (
    hash: string,
    options: SpaceNodeLeaseOptions = DEFAULT_SPACE_NODE_LEASE_OPTIONS,
  ): Promise<SpaceNodeLeaseResult> => {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0) {
      throw new TypeError("CAS lease duration must be a positive safe integer");
    }
    const response = await scoped.requireOk(
      await scoped.request(scoped.routes.lease(hash), withSignal({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseDurationMs: options.durationMs }),
      }, options.signal)),
      "lease",
    );
    return response.json() as Promise<SpaceNodeLeaseResult>;
  };
  return Object.freeze({ ...scoped.client, leaseNode });
}

function createScopedCasClient(
  config: TenantCasClientConfig | SpaceCasClientConfig,
  scope: Omit<import("./types.js").CasNodeCacheKey, "hash">,
  routes: CasClientRoutes,
): ScopedCasClientContext {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const fetcher = config.fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };

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

  const client: SharedCasClient = {
    readMetadata(hash, options: { readonly signal?: AbortSignal } = {}) {
      options.signal?.throwIfAborted();
      const key = { ...scope, hash } as import("./types.js").CasNodeCacheKey;
      const loadMetadata = async (): Promise<CasNodeMetadata> => {
        const response = await requireOk(
          await request(routes.readMetadata(hash), withSignal({}, options.signal)),
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
          await request(routes.readContent(hash), withSignal(
            headers === undefined ? {} : { headers },
            options.signal,
          )),
          "read",
        );
        if (response.body === null) {
          throw new CasClientError(502, "Missing response body", "read");
        }
        return response.body;
      };
      return config.cache?.read(key, range, loadContent, options) ?? loadContent();
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
        await request(routes.listRootRefs(options), withSignal({}, options.signal)),
        "listRootRefs",
      );
      return response.json() as Promise<CasRootRefsPage>;
    },

    async usage(signal?: AbortSignal): Promise<CasUsage> {
      const response = await requireOk(
        await request(routes.usage(), withSignal({}, signal)),
        "usage",
      );
      return response.json() as Promise<CasUsage>;
    },

    async gc(options: CasGcOptions = {}): Promise<CasGcResult> {
      const response = await requireOk(
        await request(routes.gc(), withSignal({
          method: "POST",
          ...(options.maxNodes === undefined ? {} : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ maxNodes: options.maxNodes }),
          }),
        }, options.signal)),
        "gc",
      );
      return response.json() as Promise<CasGcResult>;
    },
  };

  return { client: Object.freeze(client), request, requireOk, routes };
}
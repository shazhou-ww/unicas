import type { CasHash, CasNodeMetadata } from "@unicas/space-protocol";
import { CasClientError } from "./errors.js";
import type {
  CasClientConfigBase,
  CasClientOperations,
  CasGcOptions,
  CasListRootRefsOptions,
  CasNodeRange,
  CasRootRefsResult,
} from "./shared-types.js";

export interface CasClientRoutes {
  readMetadata(hash: string): string;
  readContent(hash: string): string;
  lease(hash: string): string;
  updateRootRefs(): string;
  listRootRefs(options: CasListRootRefsOptions): string;
  usage(): string;
  gc(): string;
}

export interface ScopedCasClientContext {
  readonly client: CasClientOperations;
  readonly request: (route: string, init?: RequestInit) => Promise<Response>;
  readonly requireOk: (response: Response, operation: string) => Promise<Response>;
  readonly routes: CasClientRoutes;
}

export function withSignal(
  init: RequestInit,
  signal: AbortSignal | null | undefined,
): RequestInit {
  return signal === undefined || signal === null ? init : { ...init, signal };
}

export function createScopedCasClient<Key extends { readonly hash: CasHash }>(
  config: CasClientConfigBase<Key>,
  scope: Omit<Key, "hash">,
  routes: CasClientRoutes,
): ScopedCasClientContext {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const fetcher = config.fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };

  const request = async (route: string, init: RequestInit = {}): Promise<Response> => {
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

  const client: CasClientOperations = {
    readMetadata(hash, options: { readonly signal?: AbortSignal } = {}) {
      options.signal?.throwIfAborted();
      const key = { ...scope, hash } as Key;
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
      validateRange(range);
      const key = { ...scope, hash } as Key;
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
        if (response.body === null) throw new CasClientError(502, "Missing response body", "read");
        return response.body;
      };
      return config.cache?.read(key, range, loadContent, options) ?? loadContent();
    },

    async updateRootRefs(update): Promise<CasRootRefsResult> {
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

    async listRootRefs(options: CasListRootRefsOptions = {}) {
      const response = await requireOk(
        await request(routes.listRootRefs(options), withSignal({}, options.signal)),
        "listRootRefs",
      );
      return response.json();
    },

    async usage(signal?: AbortSignal) {
      const response = await requireOk(
        await request(routes.usage(), withSignal({}, signal)),
        "usage",
      );
      return response.json();
    },

    async gc(options: CasGcOptions = {}) {
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
      return response.json();
    },
  };

  return { client: Object.freeze(client), request, requireOk, routes };
}

function validateRange(range: CasNodeRange | undefined): void {
  if (range === undefined) return;
  if (!Number.isSafeInteger(range.offset) || range.offset < 0) {
    throw new TypeError("CAS node range offset must be a non-negative safe integer");
  }
  if (range.length !== undefined && (!Number.isSafeInteger(range.length) || range.length < 0)) {
    throw new TypeError("CAS node range length must be a non-negative safe integer");
  }
}
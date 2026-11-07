import {
  CasNodeRefsHeader,
  DefaultSpaceNodeLeaseDurationMs,
  SpaceOperationPolicies,
  appSpaceRoutes,
  parseCasNodeRefsHeader,
  type CasNodeMetadata,
  type SpaceNodeLeaseResult,
} from "@unicas/space-protocol";
import { CasClientError } from "./errors.js";
import {
  createAuthorizedTransport,
  requirement,
  withSignal,
} from "./transport.js";
import type {
  AppCasClient,
  AppCasClientConfig,
  AppCasNodeCacheKey,
  CasListRootRefsOptions,
  CasNodeRange,
  CasRootRefsResult,
  SpaceNodeLeaseOptions,
} from "./types.js";

export const DEFAULT_SPACE_NODE_LEASE_OPTIONS: SpaceNodeLeaseOptions = Object.freeze({
  durationMs: DefaultSpaceNodeLeaseDurationMs,
  signal: null,
});

export function createAppCasClient(config: AppCasClientConfig): AppCasClient {
  const transport = createAuthorizedTransport(config);
  const path = (spaceId: string) => {
    transport.requireSpaceId(spaceId);
    return { appId: config.appId, spaceId };
  };

  const client: AppCasClient = {
    async readNode(spaceId, hash, options = {}) {
      options.signal?.throwIfAborted();
      const requestPath = path(spaceId);
      const response = await transport.request(
        requirement(
          config.appId,
          spaceId,
          SpaceOperationPolicies.readContent.permission,
        ),
        appSpaceRoutes.readContent({ ...requestPath, hash }),
        withSignal({}, options.signal),
        "readNode",
        true,
      );
      const contentType = response.headers.get("Content-Type");
      const contentLength = response.headers.get("Content-Length");
      const size = contentLength === null ? NaN : Number(contentLength);
      if (!contentType || !Number.isSafeInteger(size) || size < 0 || response.body === null) {
        throw new CasClientError(502, "Invalid node response", "readNode");
      }
      let refs: readonly string[];
      try {
        refs = parseCasNodeRefsHeader(response.headers.get(CasNodeRefsHeader));
      } catch (error) {
        throw new CasClientError(
          502,
          "Invalid node response",
          "readNode",
          error instanceof Error ? error.message : undefined,
        );
      }
      return {
        metadata: { hash, size, contentType, refs },
        content: response.body,
      };
    },

    readMetadata(spaceId, hash, options = {}) {
      options.signal?.throwIfAborted();
      const requestPath = path(spaceId);
      const key: AppCasNodeCacheKey = { version: 1, ...requestPath, hash };
      const loadMetadata = async (): Promise<CasNodeMetadata> => {
        const response = await transport.request(
          requirement(
            config.appId,
            spaceId,
            SpaceOperationPolicies.readMetadata.permission,
          ),
          appSpaceRoutes.readMetadata({ ...requestPath, hash }),
          withSignal({}, options.signal),
          "metadata",
          true,
        );
        const body = await response.json() as { metadata: CasNodeMetadata };
        return body.metadata;
      };
      return config.cache?.metadata(key, loadMetadata, options) ?? loadMetadata();
    },

    readContent(spaceId, hash, range?: CasNodeRange, options = {}) {
      options.signal?.throwIfAborted();
      validateRange(range);
      const requestPath = path(spaceId);
      const key: AppCasNodeCacheKey = { version: 1, ...requestPath, hash };
      const loadContent = async (): Promise<ReadableStream<Uint8Array>> => {
        if (range?.length === 0) {
          return new ReadableStream({ start: controller => controller.close() });
        }
        const headers = range === undefined
          ? undefined
          : {
              Range: `bytes=${range.offset}-${range.length === undefined
                ? ""
                : range.offset + range.length - 1}`,
            };
        const response = await transport.request(
          requirement(
            config.appId,
            spaceId,
            SpaceOperationPolicies.readContent.permission,
          ),
          appSpaceRoutes.readContent({ ...requestPath, hash }),
          withSignal(headers === undefined ? {} : { headers }, options.signal),
          "read",
          true,
        );
        if (response.body === null) {
          throw new CasClientError(502, "Missing response body", "read");
        }
        return response.body;
      };
      return config.cache?.read(key, range, loadContent, options) ?? loadContent();
    },

    async leaseNode(
      spaceId,
      hash,
      options: SpaceNodeLeaseOptions = DEFAULT_SPACE_NODE_LEASE_OPTIONS,
    ): Promise<SpaceNodeLeaseResult> {
      options.signal?.throwIfAborted();
      if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0) {
        throw new TypeError("CAS lease duration must be a positive safe integer");
      }
      const requestPath = path(spaceId);
      const response = await transport.request(
        requirement(
          config.appId,
          spaceId,
          SpaceOperationPolicies.lease.permission,
        ),
        appSpaceRoutes.lease({ ...requestPath, hash }),
        withSignal({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leaseDurationMs: options.durationMs }),
        }, options.signal),
        "lease",
        false,
      );
      return response.json() as Promise<SpaceNodeLeaseResult>;
    },

    async listRootRefs(
      spaceId,
      options: CasListRootRefsOptions = {},
    ) {
      const requestPath = path(spaceId);
      const response = await transport.request(
        requirement(
          config.appId,
          spaceId,
          SpaceOperationPolicies.listRootRefs.permission,
        ),
        appSpaceRoutes.listRootRefs(requestPath, options),
        withSignal({}, options.signal),
        "listRootRefs",
        true,
      );
      return response.json();
    },

    async updateRootRefs(spaceId, update): Promise<CasRootRefsResult> {
      const requestPath = path(spaceId);
      const response = await transport.request(
        requirement(
          config.appId,
          spaceId,
          SpaceOperationPolicies.updateRootRefs.permission,
        ),
        appSpaceRoutes.updateRootRefs(requestPath),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        },
        "updateRootRefs",
        false,
      );
      return response.json() as Promise<CasRootRefsResult>;
    },

    async usage(spaceId, signal) {
      const requestPath = path(spaceId);
      const response = await transport.request(
        requirement(
          config.appId,
          spaceId,
          SpaceOperationPolicies.usage.permission,
        ),
        appSpaceRoutes.usage(requestPath),
        withSignal({}, signal),
        "usage",
        true,
      );
      return response.json();
    },

    async gc(spaceId, options = {}) {
      const requestPath = path(spaceId);
      const response = await transport.request(
        requirement(
          config.appId,
          spaceId,
          SpaceOperationPolicies.gc.permission,
        ),
        appSpaceRoutes.gc(requestPath),
        withSignal({
          method: "POST",
          ...(options.maxNodes === undefined ? {} : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ maxNodes: options.maxNodes }),
          }),
        }, options.signal),
        "gc",
        false,
      );
      return response.json();
    },
  };

  return Object.freeze(client);
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

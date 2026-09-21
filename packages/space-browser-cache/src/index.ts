import type {
  CasNodeCache,
  CasNodeMetadata,
  SpaceCasNodeCacheKey,
} from "@unicas/space-client";
import {
  clearBrowserNodeCachesCore,
  createBrowserNodeCacheCore,
} from "./cache-core.js";

export interface BrowserCasNodeCacheOptions {
  readonly namespace: { readonly endpoint: string; readonly principal: string };
  readonly databaseName?: string;
  readonly maxBytes?: number;
  readonly maxMemoryBytes?: number;
  readonly maxEntryBytes?: number;
}

export interface BrowserCasNodeCache extends CasNodeCache {
  clear(): Promise<void>;
  close(): void;
}

export function createBrowserCasNodeCache(
  options: BrowserCasNodeCacheOptions,
): BrowserCasNodeCache {
  return createBrowserNodeCacheCore<SpaceCasNodeCacheKey>({
    ...options,
    databaseName: options.databaseName ?? "unicas-node-cache-v2",
    namespaceParts: (endpoint, principal) => ["v2", endpoint, principal],
    keyParts: (key, kind) => {
      if (!("appId" in key) || key.version !== 1) {
        throw new TypeError("App/Space cache requires a v1 cache key");
      }
      return ["v2", key.appId, key.spaceId, key.hash, kind];
    },
  });
}

export function clearBrowserCasNodeCaches(options: {
  readonly principal: string;
  readonly databaseName?: string;
}): Promise<void> {
  return clearBrowserNodeCachesCore({
    principal: options.principal,
    databaseName: options.databaseName ?? "unicas-node-cache-v2",
  });
}

export type { CasNodeMetadata };
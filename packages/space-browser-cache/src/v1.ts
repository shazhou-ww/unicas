import type {
  TenantCasNodeCacheKey,
  V1CasNodeCache,
} from "@unicas/space-client/v1";
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

export interface BrowserCasNodeCache extends V1CasNodeCache {
  clear(): Promise<void>;
  close(): void;
}

export function createBrowserCasNodeCache(
  options: BrowserCasNodeCacheOptions,
): BrowserCasNodeCache {
  return createBrowserNodeCacheCore<TenantCasNodeCacheKey>({
    ...options,
    databaseName: options.databaseName ?? "unicas-node-cache-v1",
    namespaceParts: (endpoint, principal) => [endpoint, principal],
    keyParts: (key, kind) => {
      if (!("stackId" in key)) {
        throw new TypeError("Stack/Tenant cache requires a v1 cache key");
      }
      return [key.stackId, key.tenantId, key.hash, kind];
    },
  });
}

export function clearBrowserCasNodeCaches(options: {
  readonly principal: string;
  readonly databaseName?: string;
}): Promise<void> {
  return clearBrowserNodeCachesCore({
    principal: options.principal,
    databaseName: options.databaseName ?? "unicas-node-cache-v1",
  });
}
import { createContext } from "react";
import { clearBrowserCasNodeCaches, createBrowserCasNodeCache, type BrowserCasNodeCache } from "@unicas/tenant-browser-cache";

export interface PlaygroundCacheSession {
  get(endpoint: string): BrowserCasNodeCache | undefined;
  clear(): Promise<void>;
  close(): void;
}

export const PlaygroundCacheContext = createContext<PlaygroundCacheSession | null>(null);

export function createPlaygroundCacheSession(accountId: string): PlaygroundCacheSession {
  const caches = new Map<string, BrowserCasNodeCache>();
  const principal = accountId;
  let closed = false;
  return {
    get(endpoint) {
      if (closed || !accountId) return undefined;
      let cache = caches.get(endpoint);
      if (!cache) {
        cache = createBrowserCasNodeCache({ namespace: { endpoint, principal }, version: 2 });
        caches.set(endpoint, cache);
      }
      return cache;
    },
    async clear() {
      closed = true;
      try { await clearBrowserCasNodeCaches({ principal, version: 2 }); }
      finally {
        for (const cache of caches.values()) cache.close();
        caches.clear();
      }
    },
    close() {
      closed = true;
      for (const cache of caches.values()) cache.close();
      caches.clear();
    },
  };
}
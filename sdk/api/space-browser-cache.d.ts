import type { CasNodeCache, CasNodeMetadata } from "@unicas/space-client";
export interface BrowserCasNodeCacheOptions {
    readonly namespace: {
        readonly endpoint: string;
        readonly principal: string;
    };
    readonly databaseName?: string;
    readonly maxBytes?: number;
    readonly maxMemoryBytes?: number;
    readonly maxEntryBytes?: number;
}
export interface BrowserCasNodeCache extends CasNodeCache {
    clear(): Promise<void>;
    close(): void;
}
export declare function createBrowserCasNodeCache(options: BrowserCasNodeCacheOptions): BrowserCasNodeCache;
export declare function clearBrowserCasNodeCaches(options: {
    readonly principal: string;
    readonly databaseName?: string;
}): Promise<void>;
export type { CasNodeMetadata };

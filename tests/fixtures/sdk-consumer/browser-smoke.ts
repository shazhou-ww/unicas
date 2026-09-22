import { encodeHeader } from "@unicas/codec";
import { appSpaceRoutes } from "@unicas/space-protocol";
import { createSpaceCasClient } from "@unicas/space-client";
import { createCasBlobClient } from "@unicas/space-blob-client";
import { createSpaceFileSystem, type SpaceFileRootCatalog } from "@unicas/space-file-client";
import { createBrowserCasNodeCache } from "@unicas/space-browser-cache";

async function main(): Promise<void> {
  const hash = "a".repeat(64);
  const cache = createBrowserCasNodeCache({
    namespace: { endpoint: "https://api.example", principal: "issuer:subject" },
    databaseName: `sdk-consumer-${crypto.randomUUID()}`,
  });
  const key = { version: 1 as const, appId: "app-1", spaceId: "space-1", hash };
  let loads = 0;
  const metadata = { hash, size: 1, contentType: "text/plain", refs: [] as string[] };
  await cache.metadata(key, async () => {
    loads += 1;
    return metadata;
  });
  await cache.metadata(key, async () => {
    loads += 1;
    return metadata;
  });
  if (loads !== 1) throw new Error(`IndexedDB cache loaded ${loads} times`);

  const cas = createSpaceCasClient({
    baseUrl: "https://api.example",
    appId: "app-1",
    spaceId: "space-1",
    getToken: async () => "capability",
    cache,
    fetcher: { fetch: async () => Response.json({ error: "NOT_CALLED" }, { status: 500 }) },
  });
  const catalog: SpaceFileRootCatalog = {
    list: async () => [],
    create: async (input) => ({ ...input, revision: 1, createdAt: 1, updatedAt: 1 }),
    update: async (input) => ({ ...input, createdAt: 1, updatedAt: 2 }),
    delete: async () => undefined,
  };

  if (encodeHeader(1, "text/plain", 0).length === 0) throw new Error("codec unavailable");
  if (!appSpaceRoutes.usage({ appId: "app-1", spaceId: "space-1" }).startsWith("/v1/apps/")) {
    throw new Error("protocol route unavailable");
  }
  if (typeof createCasBlobClient(cas).storeBlob !== "function") throw new Error("blob client unavailable");
  if (typeof createSpaceFileSystem({ cas, catalog }).createRoot !== "function") throw new Error("file client unavailable");

  await cache.clear();
  cache.close();
  document.body.dataset.result = "pass";
  document.body.textContent = "SDK BROWSER CONSUMER PASS";
}

main().catch((error: unknown) => {
  document.body.dataset.result = "fail";
  document.body.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});

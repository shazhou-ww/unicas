import { clearBrowserCasNodeCaches, createBrowserCasNodeCache } from "@unicas/space-browser-cache";
import { createSpaceCasClient } from "@unicas/space-client";

async function main(): Promise<void> {
  const hash = "a".repeat(64);
  const principal = "issuer.example:subject-example";
  const databaseName = `unicas-quickstart-${crypto.randomUUID()}`;
  const cache = createBrowserCasNodeCache({
    namespace: { endpoint: "https://api.example", principal },
    databaseName,
  });
  let requests = 0;
  const cas = createSpaceCasClient({
    baseUrl: "https://api.example",
    appId: "app-example",
    spaceId: "space-example",
    getToken: async () => "synthetic-capability",
    cache,
    fetcher: {
      async fetch() {
        requests += 1;
        return Response.json({
          metadata: { hash, size: 5, contentType: "text/plain", refs: [] },
        });
      },
    },
  });

  await cas.readMetadata(hash);
  await cas.readMetadata(hash);
  if (requests !== 1) throw new Error(`expected one metadata request, received ${requests}`);

  await clearBrowserCasNodeCaches({ principal, databaseName });
  cache.close();
  document.body.dataset.result = "pass";
  document.body.textContent = "SDK BROWSER QUICKSTART PASS";
}

main().catch((error: unknown) => {
  document.body.dataset.result = "fail";
  document.body.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});

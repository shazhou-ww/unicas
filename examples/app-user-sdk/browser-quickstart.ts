import { clearBrowserCasNodeCaches, createBrowserCasNodeCache } from "@unicas/space-browser-cache";
import { parseSpaceSelector } from "@unicas/space-protocol";
import { createAppCasClient } from "@unicas/space-client";

async function main(): Promise<void> {
  const hash = "a".repeat(64);
  const spaceId = "/space-example";
  const selector = parseSpaceSelector(spaceId);
  if (!selector) throw new Error("Invalid example Space ID");
  const principal = "issuer.example:subject-example";
  const databaseName = `unicas-quickstart-${crypto.randomUUID()}`;
  const cache = createBrowserCasNodeCache({
    namespace: { endpoint: "https://api.example", principal },
    databaseName,
  });
  let requests = 0;
  const cas = createAppCasClient({
    baseUrl: "https://api.example",
    appId: "app-example",
    capabilityProvider: {
      async acquire(requirement) {
        return {
          bearerToken: "synthetic-capability",
          metadata: {
            version: 2,
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            grants: [{ selector: selector.selector, permissions: [requirement.permission] }],
          },
        };
      },
    },
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

  await cas.readMetadata(spaceId, hash);
  await cas.readMetadata(spaceId, hash);
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

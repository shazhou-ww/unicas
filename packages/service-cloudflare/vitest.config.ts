import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ["@cloudflare/workers-oauth-provider"],
      },
    },
  },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./tests/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
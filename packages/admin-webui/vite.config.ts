import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type UserConfig } from "vite";
import type { UserConfig as VitestUserConfig } from "vitest/config";

/**
 * The admin console is served under `/admin/` on the CAS service domain;
 * the BFF owns `/admin/me`, `/admin/stacks/...` and the OIDC routes. In dev,
 * Vite serves the SPA and proxies every other `/admin` path (API + OIDC) to
 * the local BFF Worker (see stacks/unicas/local).
 */
const config: UserConfig & { test: VitestUserConfig["test"] } = {
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4070,
    proxy: {
      "/admin": {
        target: "http://localhost:8792",
        changeOrigin: false,
        // Proxy ONLY the BFF-owned paths; everything else (the SPA shell,
        // Vite module graph: /admin/src/*, /admin/@vite/*,
        // /admin/@react-refresh, pre-bundled deps) is served by Vite.
        bypass: (req) => {
          const path = req.url ?? "";
          const isBffRoute =
            path === "/admin/me"
            || path.startsWith("/admin/assets/")
            || path.startsWith("/admin/apps")
            || path.startsWith("/admin/stacks")
            || path.startsWith("/admin/member-invitations")
            || path.startsWith("/admin/auth/")
            || path.startsWith("/admin/invitations/")
            || path.startsWith("/admin/platform");
          if (isBffRoute) return undefined; // forward to the BFF worker
          return path; // serve from Vite
        },
      },
      "/stacks": {
        target: "http://localhost:8794",
        changeOrigin: false,
      },
      "/managed-issuers": {
        target: "http://localhost:8794",
        changeOrigin: false,
      },
      "/.well-known": {
        target: "http://localhost:8794",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    // Deterministic asset names: the BFF shell hardcodes /admin/assets/main.js
    // (and main.css), so the entry/chunk names must not be hashed.
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
};

export default defineConfig(config);

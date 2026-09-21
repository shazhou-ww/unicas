import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./ui", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
});
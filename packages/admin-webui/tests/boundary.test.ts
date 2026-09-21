import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("cas-admin-webui package boundary", () => {
  test("is browser-only: depends on the admin client facade and is not independently deployable", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "../package.json"),
        "utf8",
      ),
    );
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies["@unicas/admin-client"]).toBe("workspace:*");
    expect(pkg.dependencies["@unicas/admin-protocol"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/service"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/control-plane"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/space-client"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/space-blob-client"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/space-file-client"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/space-browser-cache"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/space-protocol"]).toBeUndefined();
    expect(pkg.dependencies["@unicas/codec"]).toBeUndefined();
    expect(pkg.scripts.deploy).toBeUndefined();
    // The OIDC BFF composition moved to @unicas/service-cloudflare; this
    // package ships only the browser UI.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    expect(() => readFileSync(join(root, "src/server/index.ts"), "utf8")).toThrow();
    expect(pkg.main).toBe("./src/ui/index.ts");
    expect(pkg.scripts.build).toBe("vite build");
  });

  test("does not retain the superseded App shell or custom modal styles", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    expect(existsSync(join(root, "src/ui/views/stack.tsx"))).toBe(false);
    const css = readFileSync(join(root, "src/ui/styles.css"), "utf8");
    for (const selector of [
      ".modal-overlay",
      ".mcp-dialog",
      ".stack-layout",
      ".stack-sidebar",
      ".stack-switcher",
      ".tabs-vertical",
      ".mobile-nav-trigger",
      ".sidebar-app-item",
      ".brand-section",
      ".concept-guide",
      ".concept-list",
      ".inline-form",
      ".invitation-list",
      ".invitation-confirmation",
      ".file-root-actions",
      ".file-manager-shell",
      ".file-upload-button",
      ".stack-list",
    ]) {
      expect(css).not.toContain(selector);
    }
  });
});

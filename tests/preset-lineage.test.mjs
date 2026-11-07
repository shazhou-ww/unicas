import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const turbo = JSON.parse(readFileSync(join(ROOT, "turbo.json"), "utf8"));

describe("Cloudflare fullstack preset adoption", () => {
  test("tracks the fullstack preset as the immediate parent", () => {
    expect(parse(readFileSync(join(ROOT, ".git-lineage.yaml"), "utf8"))).toEqual({
      version: 1,
      createdFrom: {
        repository: "https://github.com/shazhou-ww/preset-cloudflare-fullstack.git",
        branch: "main",
      },
    });
  });

  test("uses the preset task runner without replacing delivery or release gates", () => {
    expect(rootPackage.devDependencies.turbo).toBe("2.9.14");
    expect(rootPackage.scripts).toMatchObject({
      build: "turbo run build --concurrency=1",
      check: "pnpm validate",
      "test:packages": "turbo run test --concurrency=1",
      "test:quick": 'pnpm check:repo && turbo run test --filter="!@unicas/service-cloudflare" --concurrency=1',
      typecheck: "turbo run typecheck --concurrency=1",
      clean: "turbo run clean --concurrency=1",
      validate: "pnpm test:quick && pnpm build && pnpm typecheck",
      "release:service:plan": "node release/service/deploy.mjs --dry-run",
      "release:service:production": "node release/service/deploy.mjs --production",
    });
    expect(rootPackage.scripts.dev).toBeUndefined();
    expect(rootPackage.scripts.deploy).toBeUndefined();
  });

  test("orders dependency builds and the service's browser assets explicitly", () => {
    for (const name of ["build", "test", "typecheck"]) {
      expect(turbo.tasks[name].dependsOn).toContain("^build");
    }
    expect(turbo.tasks["@unicas/service-cloudflare#build"].dependsOn)
      .toEqual(["^build", "@unicas/admin-webui#build"]);
    expect(turbo.tasks["@unicas/service-cloudflare#build"].outputs)
      .toContain("src/admin-bff/ui-assets.generated.ts");
  });

  test("preserves environment forwarding and always executes validation", () => {
    expect(turbo.envMode).toBe("loose");
    for (const task of Object.values(turbo.tasks)) {
      expect(task.cache).toBe(false);
    }
  });

  test("inherits the Node and package-manager installation baseline", () => {
    expect(readFileSync(join(ROOT, ".node-version"), "utf8").trim()).toBe("24.11.1");
    const npmrc = readFileSync(join(ROOT, ".npmrc"), "utf8");
    expect(npmrc).toContain("engine-strict=true");
    expect(npmrc).toContain("strict-peer-dependencies=true");
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toContain(".turbo/");
  });

  test("locks the task runner and every platform binary with portable SHA-512 resolutions", () => {
    const lock = parse(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"));
    expect(lock.importers["."].devDependencies.turbo).toEqual({
      specifier: "2.9.14",
      version: "2.9.14",
    });
    const entries = Object.entries(lock.packages)
      .filter(([name]) => name.startsWith("turbo@") || name.startsWith("@turbo/"));
    expect(entries).toHaveLength(7);
    for (const [, entry] of entries) {
      expect(entry.resolution.integrity).toMatch(/^sha512-/);
      expect(entry.resolution.tarball).toBeUndefined();
    }
  });
});

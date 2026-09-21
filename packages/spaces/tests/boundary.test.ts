import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const wrangler = JSON.parse(readFileSync(
  new URL("../../../stacks/unicas/spaces/wrangler.jsonc", import.meta.url),
  "utf8",
));

describe("Spaces boundaries", () => {
  test("is private and depends only on public UniCAS client contracts", () => {
    expect(packageJson.private).toBe(true);
    expect(packageJson.publishConfig).toBeUndefined();
    expect(Object.keys(packageJson.dependencies).filter((name) => name.startsWith("@unicas/"))).toEqual([
      "@unicas/space-client",
      "@unicas/space-file-client",
      "@unicas/space-protocol",
    ]);
  });

  test("does not import service implementations, admin clients, or UniDocs packages", () => {
    const imports = sourceFiles(new URL("../src", import.meta.url))
      .flatMap((file) => readFileSync(file, "utf8").match(/(?:from|import\s*)\s*["']([^"']+)["']/g) ?? []);
    expect(imports.filter((specifier) => /@unicas\/(?:service|service-cloudflare|admin-)/.test(specifier)))
      .toEqual([]);
    expect(imports.filter((specifier) => specifier.includes("@unidocs/"))).toEqual([]);
  });

  test("binds only App-owned D1 and static assets", () => {
    expect(wrangler.d1_databases.map((binding: { binding: string }) => binding.binding)).toEqual(["SPACES_DB"]);
    expect(wrangler.assets.binding).toBe("ASSETS");
    expect(wrangler.services).toBeUndefined();
    expect(wrangler.r2_buckets).toBeUndefined();
    expect(wrangler.kv_namespaces).toBeUndefined();
    expect(wrangler.durable_objects).toBeUndefined();
    expect(relative(fileURLToPath(new URL("../../../stacks/unicas/spaces", import.meta.url)), packageRoot))
      .not.toBe("");
    expect(repositoryRoot).toBeTruthy();
  });
});

function sourceFiles(directory: URL): string[] {
  const root = fileURLToPath(directory);
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if ([".ts", ".tsx", ".mjs"].includes(extname(entry.name))) files.push(child);
    }
  };
  visit(root);
  return files;
}
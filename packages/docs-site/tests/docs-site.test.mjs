import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildDocsSite, DOCUMENTS, PAGE_INVENTORY } from "../src/build.mjs";

const outputDir = join(import.meta.dirname, ".docs-site-output");
const comparisonDir = join(import.meta.dirname, ".docs-site-comparison");
const provenanceDir = join(import.meta.dirname, ".docs-site-provenance");
const ROOT = resolve(import.meta.dirname, "../../..");
const CONTENT_ROOT = join(ROOT, "packages/docs-site/content");

beforeAll(async () => {
  await buildDocsSite(outputDir);
}, 30_000);

afterAll(async () => {
  await Promise.all([outputDir, comparisonDir, provenanceDir].map((directory) => (
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  )));
});

/** @param {string} route */
async function page(route) {
  return readFile(join(outputDir, route.replace(/^\/+|\/+$/g, ""), "index.html"), "utf8");
}

/**
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function artifactFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) files.push(...await artifactFiles(directory, relativePath));
    else files.push(relativePath);
  }
  return files.sort();
}

describe("documentation static site", () => {
  test("classifies every package-owned content source and preserves the reviewed route set", async () => {
    const contentFiles = await artifactFiles(CONTENT_ROOT);
    const manifestSources = DOCUMENTS.map(({ sourcePath }) => (
      relative(CONTENT_ROOT, join(ROOT, sourcePath)).replaceAll("\\", "/")
    )).sort();
    expect(contentFiles).toEqual(manifestSources);
    expect(PAGE_INVENTORY.map(({ route }) => route)).toEqual([
      "/",
      "/app-user-api/",
      "/app-user-api/scenarios/",
      "/app-user-api/http-api/",
      "/app-user-api/authorization/",
      "/app-user-api/migration-v2-to-v1/",
      "/cas-architecture/",
      "/cas-binary-format/",
      "/cas-state-protection-and-gc/",
      "/domain-topology/",
      "/terminology/",
      "/cas-control-plane-cli/",
      "/cas-control-plane-mcp/",
      "/cas-oauth-discovery-and-issuer-migration/",
      "/cas-operations/",
      "/deployment-and-local-configuration/",
      "/observability/",
      "/cas-tenant-debug-tools/",
      "/app-user-api/reference/",
      "/glossary/",
      "/reference/packages/",
      "/reference/admin-protocol/",
      "/reference/space-protocol/",
      "/reference/admin-cli/",
    ]);
    expect(await artifactFiles(join(ROOT, "docs"))).toEqual([
      "README.md",
      "managed-issuer-retirement.md",
      "npm-package-releases.md",
      "repository-tasks.md",
    ]);
  });

  test("builds the accepted document inventory and references", async () => {
    const index = await page("");
    for (const { route, title, sourcePath } of DOCUMENTS) {
      expect(index).toContain(`href="${route}"`);
      expect(index).toContain(title);
      await expect(page(route)).resolves.toContain(`blob/main/${sourcePath}`);
    }
    await expect(page("glossary")).resolves.toContain("UniCAS Glossary");
    for (const [route, title] of [
      ["reference/packages", "Package Boundaries"],
      ["reference/admin-protocol", "Admin Protocol"],
      ["reference/space-protocol", "Space Protocol"],
      ["reference/admin-cli", "Administrator CLI"],
    ]) {
      await expect(page(route)).resolves.toContain(title);
      expect(index).toContain(`href="/${route}/"`);
    }
    await expect(readFile(join(outputDir, "assets", "docs.css"), "utf8")).resolves.toContain(".article-layout");
    await expect(readFile(join(outputDir, "assets", "docs.js"), "utf8")).resolves.toContain("nav-open");
    await expect(readFile(join(outputDir, "assets", "api-reference.js"), "utf8")).resolves.toContain("app-space-v1.openapi.json");
    await expect(readFile(join(outputDir, "assets", "api-reference.css"), "utf8")).resolves.toContain("--scalar-color-accent");
    await expect(readFile(join(outputDir, "openapi", "app-space-v1.openapi.json"), "utf8")).resolves.toContain("UniCAS Space API");
    await expect(readFile(join(outputDir, "404.html"), "utf8")).resolves.toContain("No document at this address");
  });

  test("generates stable anchors and rewrites repository Markdown links", async () => {
    const architecture = await page("cas-architecture");
    expect(architecture).toContain('id="1-goals"');
    expect(architecture).toContain('href="#1-goals"');
    expect(architecture).toContain('href="/cas-binary-format/"');
    expect(architecture).toContain('aria-label="On this page"');

    const appUser = await page("app-user-api");
    expect(appUser).toContain('href="/app-user-api/scenarios/"');
    expect(appUser).toContain('href="/reference/packages/"');
    expect(appUser).toContain("packages/docs-site/content/app-user-api/README.md");

    const apiReference = await page("app-user-api/reference");
    expect(apiReference).toContain('id="api-reference"');
    expect(apiReference).toContain('href="/openapi/app-space-v1.openapi.json"');
    expect(apiReference).toContain('src="/assets/api-reference.js"');
  });

  test("emits a successful generated-link report", async () => {
    const report = JSON.parse(await readFile(join(outputDir, "link-check.json"), "utf8"));
    expect(report.pages).toBe(PAGE_INVENTORY.length);
    expect(report.failures).toEqual([]);
  });

  test("emits classified, non-secret artifact metadata for the exact OpenAPI bytes", async () => {
    const manifest = JSON.parse(await readFile(join(outputDir, "artifact-manifest.json"), "utf8"));
    const openApi = await readFile(join(outputDir, manifest.openapi.path));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      package: { name: "@unicas/docs-site", version: "0.1.0" },
      sourceRevision: null,
      linkCheck: "link-check.json",
      openapi: {
        path: "openapi/app-space-v1.openapi.json",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    expect(manifest.pages).toEqual(PAGE_INVENTORY.map(({ kind: _kind, ...pageEntry }) => pageEntry));
    expect(manifest.openapi.sha256).toBe(createHash("sha256").update(openApi).digest("hex"));
    expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|Bearer |PRIVATE KEY|customer/i);
  });

  test("emits only reviewed files and rebuilds deterministically", async () => {
    await buildDocsSite(comparisonDir);
    const files = await artifactFiles(outputDir);
    const expectedFiles = [
      "404.html",
      "artifact-manifest.json",
      "assets/api-reference.css",
      "assets/api-reference.js",
      "assets/docs.css",
      "assets/docs.js",
      "favicon.svg",
      "index.html",
      "link-check.json",
      "openapi/app-space-v1.openapi.json",
      ...PAGE_INVENTORY.filter(({ route }) => route !== "/")
        .map(({ route }) => `${route.slice(1)}index.html`),
    ].sort();
    expect(files).toEqual(expectedFiles);
    expect(await artifactFiles(comparisonDir)).toEqual(expectedFiles);
    for (const file of files) {
      expect(await readFile(join(comparisonDir, file))).toEqual(await readFile(join(outputDir, file)));
    }
  }, 30_000);

  test("records only an explicitly supplied full source revision", async () => {
    const sourceRevision = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    await buildDocsSite(provenanceDir, { sourceRevision });
    const manifest = JSON.parse(await readFile(join(provenanceDir, "artifact-manifest.json"), "utf8"));
    expect(manifest.sourceRevision).toBe(sourceRevision.toLowerCase());
    await expect(buildDocsSite(provenanceDir, { sourceRevision: "main" }))
      .rejects.toThrow("full 40-character Git commit");
  }, 30_000);
});
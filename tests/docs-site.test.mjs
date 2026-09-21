import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildDocsSite, DOCUMENTS } from "../stacks/unicas/docs-site/build.mjs";

const outputDir = join(import.meta.dirname, ".docs-site-output");

beforeAll(async () => {
  await buildDocsSite(outputDir);
}, 30_000);

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function page(route) {
  return readFile(join(outputDir, route, "index.html"), "utf8");
}

describe("documentation static site", () => {
  test("builds the accepted document inventory and references", async () => {
    const index = await page("");
    for (const [slug, title] of DOCUMENTS) {
      expect(index).toContain(`href="/${slug}/"`);
      expect(index).toContain(title);
      await expect(page(slug)).resolves.toContain("Edit source");
    }
    await expect(page("glossary")).resolves.toContain("UniCAS Glossary");
    for (const [route, title] of [
      ["reference/packages", "Package Boundaries"],
      ["reference/admin-protocol", "Admin Protocol"],
      ["reference/space-protocol", "Tenant Protocol"],
      ["reference/admin-cli", "Administrator CLI"],
    ]) {
      await expect(page(route)).resolves.toContain(title);
      expect(index).toContain(`href="/${route}/"`);
    }
    await expect(readFile(join(outputDir, "assets", "docs.css"), "utf8")).resolves.toContain(".article-layout");
    await expect(readFile(join(outputDir, "assets", "docs.js"), "utf8")).resolves.toContain("nav-open");
    await expect(readFile(join(outputDir, "assets", "api-reference.js"), "utf8")).resolves.toContain("space-v2.openapi.json");
    await expect(readFile(join(outputDir, "assets", "api-reference.css"), "utf8")).resolves.toContain("--scalar-color-accent");
    await expect(readFile(join(outputDir, "openapi", "space-v2.openapi.json"), "utf8")).resolves.toContain("UniCAS Space API");
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
    expect(appUser).toContain("docs/app-user-api/README.md");

    const apiReference = await page("app-user-api/reference");
    expect(apiReference).toContain('id="api-reference"');
    expect(apiReference).toContain('href="/openapi/space-v2.openapi.json"');
    expect(apiReference).toContain('src="/assets/api-reference.js"');
  });

  test("emits a successful generated-link report", async () => {
    const report = JSON.parse(await readFile(join(outputDir, "link-check.json"), "utf8"));
    expect(report.pages).toBe(DOCUMENTS.length + 1 + 1 + 1 + 4);
    expect(report.failures).toEqual([]);
  });
});
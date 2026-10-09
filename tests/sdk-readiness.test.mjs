import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  collectSdkSnippets,
  sdkMarkdownPaths,
  validateLocalMarkdownLinks,
} from "../scripts/sdk-readiness.mjs";

const ROOT = join(import.meta.dirname, "..");
const matrix = readJson("sdk/package-matrix.json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

describe("App-user SDK open-source readiness", () => {
  test("publishes complete community and support entry points", () => {
    for (const path of [
      "README.md",
      "LICENSE",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SUPPORT.md",
      "SECURITY.md",
      ".github/CODEOWNERS",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/ISSUE_TEMPLATE/bug.yml",
      ".github/ISSUE_TEMPLATE/feature.yml",
      ".github/ISSUE_TEMPLATE/support.yml",
      ".github/ISSUE_TEMPLATE/config.yml",
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
    for (const name of ["bug.yml", "feature.yml", "support.yml", "config.yml"]) {
      expect(() => parseYaml(read(`.github/ISSUE_TEMPLATE/${name}`)), name).not.toThrow();
    }
    expect(parseYaml(read(".github/ISSUE_TEMPLATE/config.yml")))
      .toMatchObject({ blank_issues_enabled: false });
    expect(read("CONTRIBUTING.md")).toContain("does not currently require a");
    expect(read("SUPPORT.md")).toContain("best-effort");
    expect(read("SECURITY.md")).toContain("Latest `0.1.x`");
    expect(read("SECURITY.md")).not.toContain("Until the first tagged release");
  });

  test.each(matrix.packages.map((entry) => [entry.name, entry]))(
    "%s has stable, discoverable package metadata and documentation",
    (_name, entry) => {
      const manifest = readJson(`${entry.directory}/package.json`);
      const packageSlug = entry.name.slice("@unicas/".length);
      expect(manifest.homepage).toBe(
        `https://docs.unicas.work/app-user-api/sdk/#${packageSlug}`,
      );
      expect(manifest.keywords).toEqual(expect.arrayContaining(["unicas", "typescript", "esm"]));
      expect(manifest.keywords.length).toBeGreaterThanOrEqual(5);
      expect(manifest.description).not.toMatch(/\btenant\b/iu);
      const readme = read(`${entry.directory}/README.md`);
      const encodedName = encodeURIComponent(entry.name);
      expect(readme).toContain(`https://img.shields.io/npm/v/${encodedName}?label=npm`);
      expect(readme).toContain(`https://www.npmjs.com/package/${encodedName}`);
      expect(readme).toContain(`https://img.shields.io/npm/l/${encodedName}`);
      expect(readme).not.toContain("/actions/workflows/ci.yml/badge.svg");
      expect(readme).not.toContain("https://img.shields.io/npm/dm/");
      expect(readme).not.toMatch(/npm install[^\n]*@beta/iu);
      expect(readme).not.toMatch(/modern browsers/iu);
      for (const target of [
        "https://docs.unicas.work/app-user-api/sdk/",
        "https://docs.unicas.work/app-user-api/compatibility/",
        "https://docs.unicas.work/app-user-api/sdk-reference/",
        "https://docs.unicas.work/app-user-api/versioning/",
        "https://docs.unicas.work/app-user-api/changelog/",
        "https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md",
        "https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md",
      ]) {
        expect(readme, target).toContain(target);
      }
    },
  );

  test("marks every SDK TypeScript snippet for packed declaration typechecking", async () => {
    const snippets = await collectSdkSnippets(ROOT, matrix);
    expect(snippets.map(({ group }) => group)).toEqual([
      "browser-quickstart",
      "cas-architecture-space-client",
      "codec",
      "node-quickstart",
      "space-blob-client",
      "space-browser-cache",
      "space-client",
      "space-file-client",
      "space-protocol",
    ]);
    expect(snippets.every(({ source }) => source.includes("from \"@unicas/"))).toBe(true);
  });

  test("keeps local SDK and community Markdown links resolvable", async () => {
    const failures = await validateLocalMarkdownLinks(ROOT, [
      ...sdkMarkdownPaths(matrix),
      "README.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SUPPORT.md",
      "SECURITY.md",
    ]);
    expect(failures).toEqual([]);
  });

  test("documents one compatible release policy and API baseline", () => {
    const compatibility = read("packages/docs-site/content/app-user-api/compatibility.md");
    for (const target of ["Node.js", "TypeScript", "Chromium", "Firefox", "WebKit", "ESM"]) {
      expect(compatibility).toContain(target);
    }
    const versioning = read("packages/docs-site/content/app-user-api/versioning.md");
    expect(versioning).toContain("patch release is backward compatible");
    expect(versioning).toContain("breaking TypeScript API");
    const changelog = read("CHANGELOG.md");
    for (const version of ["0.1.0-beta.1", "0.1.1", "0.1.2"]) {
      expect(changelog).toContain(`## ${version}`);
    }
    const api = readJson("sdk/api/manifest.json");
    expect(api).toMatchObject({
      schemaVersion: 1,
      releaseKey: matrix.releaseKey,
      version: matrix.version,
    });
    expect(api.packages.map(({ name }) => name)).toEqual(matrix.packages.map(({ name }) => name));
    for (const entry of api.packages) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(existsSync(join(ROOT, entry.declaration))).toBe(true);
      expect(read(entry.declaration)).not.toMatch(/\btenant\b/iu);
    }
    expect(read("packages/space-protocol/openapi/app-space-v1.openapi.json"))
      .not.toMatch(/\btenant\b/iu);
  });

  test("uses immutable workflow dependencies and visible security automation", () => {
    const workflowDirectory = join(ROOT, ".github", "workflows");
    const workflows = readdirSync(workflowDirectory)
      .filter((name) => name.endsWith(".yml"))
      .map((name) => [name, read(`.github/workflows/${name}`)]);
    for (const [name, source] of workflows) {
      for (const match of source.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/gu)) {
        if (match[1].startsWith("./")) continue;
        expect(match[2], `${name}: ${match[0]}`).toMatch(/^[0-9a-f]{40}$/u);
      }
    }
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/zricethezav\/gitleaks:[^@\s]+@sha256:[0-9a-f]{64}/u);
    expect(ci).not.toMatch(/zricethezav\/gitleaks:[^\s]+(?<!@sha256:[0-9a-f]{64})\s+git/u);

    const dependabot = parseYaml(read(".github/dependabot.yml"));
    expect(dependabot.updates.map((entry) => entry["package-ecosystem"]).sort())
      .toEqual(["github-actions", "npm"]);
    const security = parseYaml(read(".github/workflows/security.yml"));
    expect(Object.keys(security.jobs).sort()).toEqual(["codeql", "dependency-review"]);
    expect(JSON.stringify(security)).toContain("actions/dependency-review-action@");
    expect(JSON.stringify(security)).toContain("github/codeql-action/init@");
    expect(security.jobs.codeql.permissions).toEqual({
      contents: "read",
      "security-events": "write",
    });
  });
});

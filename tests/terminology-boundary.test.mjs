import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ALLOWLIST_PATH = join(import.meta.dirname, "terminology-allowlist.json");
const CATEGORIES = new Set(["frozen-v1", "external-standard", "compatibility-adapter"]);
const ROOTS = [".github/instructions", "docs", "packages", "scripts", "stacks", "tests"];
const ROOT_FILES = ["AGENTS.md", "GLOSSARY.md", "README.md", "package.json", "tsconfig.json"];
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".wrangler",
  "dist",
  "node_modules",
  "openapi",
]);
const SKIPPED_FILES = new Set([
  "packages/service-cloudflare/src/admin-bff/ui-assets.generated.ts",
  "tests/terminology-allowlist.json",
  "tests/terminology-boundary.test.mjs",
]);
const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".tsx",
  ".ts",
  ".yaml",
  ".yml",
]);
const LEGACY_TOKEN = /\b(?:[A-Za-z_$][A-Za-z0-9_$]*(?:Stack|Tenant)[A-Za-z0-9_$]*|stack(?:Id|_[a-z0-9_]+)|tenant(?:Id|_[a-z0-9_]+)|STACK_[A-Z0-9_]+|TENANT_[A-Z0-9_]+)\b/g;
const FORBIDDEN_IDENTITIES = [
  /@unicas\/tenant-(?:protocol|client|blob-client|file-client|browser-cache)\b/g,
  /packages\/tenant-(?:protocol|client|blob-client|file-client|browser-cache)\b/g,
];

function walk(path, files = []) {
  if (!existsSync(path)) return files;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function repositoryPath(path) {
  return relative(ROOT, path).replace(/\\/g, "/");
}

function loadAllowlist() {
  const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  expect(Object.keys(parsed)).toEqual(["entries"]);
  expect(Array.isArray(parsed.entries)).toBe(true);
  const keys = new Set();
  for (const entry of parsed.entries) {
    expect(Object.keys(entry).sort()).toEqual([
      "category",
      "path",
      "reason",
      "removal",
      "terms",
    ]);
    expect(typeof entry.path).toBe("string");
    expect(CATEGORIES.has(entry.category)).toBe(true);
    expect(typeof entry.reason).toBe("string");
    expect(entry.reason.length).toBeGreaterThan(10);
    expect(typeof entry.removal).toBe("string");
    expect(entry.removal.length).toBeGreaterThan(10);
    expect(Array.isArray(entry.terms)).toBe(true);
    expect(entry.terms.length).toBeGreaterThan(0);
    expect(existsSync(join(ROOT, entry.path))).toBe(true);
    for (const term of entry.terms) {
      expect(typeof term).toBe("string");
      expect(term.length).toBeGreaterThan(0);
      const key = `${entry.path}\0${term}`;
      expect(keys.has(key), `duplicate terminology allowance: ${entry.path}: ${term}`).toBe(false);
      keys.add(key);
    }
  }
  return parsed.entries;
}

function findOccurrences(content, path) {
  const occurrences = [];
  for (const match of content.matchAll(LEGACY_TOKEN)) {
    occurrences.push({ path, term: match[0], index: match.index ?? 0 });
  }
  for (const expression of FORBIDDEN_IDENTITIES) {
    for (const match of content.matchAll(expression)) {
      occurrences.push({ path, term: match[0], index: match.index ?? 0, forbidden: true });
    }
  }
  return occurrences;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

describe("App/Space terminology boundary", () => {
  test("classifies every retained Stack/Tenant occurrence and rejects old package identities", () => {
    const allowlist = loadAllowlist();
    const allowances = new Map(allowlist.flatMap((entry) =>
      entry.terms.map((term) => [`${entry.path}\0${term}`, entry])));
    const usedAllowances = new Set();
    const files = [
      ...ROOTS.flatMap((root) => walk(join(ROOT, root))),
      ...ROOT_FILES.map((path) => join(ROOT, path)).filter(existsSync),
    ];
    const violations = [];

    for (const file of files) {
      const path = repositoryPath(file);
      if (SKIPPED_FILES.has(path) || path.startsWith("tasks/")) continue;
      const content = readFileSync(file, "utf8");
      for (const occurrence of findOccurrences(content, path)) {
        if (occurrence.forbidden) {
          violations.push(`${path}:${lineNumber(content, occurrence.index)} forbidden ${occurrence.term}`);
          continue;
        }
        const key = `${path}\0${occurrence.term}`;
        if (!allowances.has(key)) {
          violations.push(`${path}:${lineNumber(content, occurrence.index)} unclassified ${occurrence.term}`);
        } else {
          usedAllowances.add(key);
        }
      }
    }

    for (const key of allowances.keys()) {
      if (!usedAllowances.has(key)) violations.push(`stale allowance ${key.replace("\0", ": ")}`);
    }
    expect(violations).toEqual([]);
  });
});
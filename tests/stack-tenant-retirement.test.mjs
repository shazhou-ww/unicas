import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", ".wrangler", "tests"]);
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|jsonc?|md|ya?ml)$/;

const retiredPaths = [
  "packages/space-protocol/src/v1.ts",
  "packages/space-protocol/openapi/tenant-v1.openapi.json",
  "packages/space-protocol/scripts/generate-openapi.ts",
  "packages/space-client/src/v1.ts",
  "packages/space-browser-cache/src/v1.ts",
  "packages/service/src/v1/tenant-auth.ts",
  "scripts/cas-middleware-smoke.mjs",
];

const retiredSurfacePatterns = [
  /@unicas\/space-(?:protocol|client|browser-cache)\/v1/,
  /tenant-v1\.openapi\.json/,
  /\bcasTenantApiContract\b/,
  /\bcasRoutes\b/,
  /\bCasLeaseDurationHeader\b/,
  /\bCasUpload(?:Id|Length)Header\b/,
  /\bcreateTenantCasClient\b/,
  /\bTenantCas(?:Client|NodeCacheKey)\b/,
  /\bV1StackTenant\w*\b/,
  /\bv1StackOAuthResource\b/,
  /\bv1PermissionFor\b/,
  /\bauthorizeV1StackTenantRequest\b/,
  /\bdispatchV1StackTenantRequest\b/,
  /\bsmoke:v1\b/,
  /cas-middleware-smoke/,
  /UNICAS_SMOKE_(?:STACK|TENANT)_ID/,
];

function maintainedFiles(path) {
  if (!existsSync(path)) return [];
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const child = join(path, entry.name);
    if (entry.isDirectory()) return maintainedFiles(child);
    return TEXT_FILE.test(entry.name) ? [child] : [];
  });
}

function packageJson(packageName) {
  return JSON.parse(readFileSync(join(ROOT, "packages", packageName, "package.json"), "utf8"));
}

describe("Stack/Tenant data-plane retirement", () => {
  test("retired source and generated artifacts remain absent", () => {
    for (const path of retiredPaths) {
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    }
  });

  test("public package export maps expose only App/Space entrypoints", () => {
    for (const packageName of ["space-protocol", "space-client", "space-browser-cache"]) {
      const manifest = packageJson(packageName);
      expect(manifest.exports, packageName).not.toHaveProperty("./v1");
      expect(manifest.exports, packageName).not.toHaveProperty("./v1/openapi.json");
      expect(manifest.publishConfig?.exports, packageName).not.toHaveProperty("./v1");
      expect(manifest.publishConfig?.exports, packageName).not.toHaveProperty("./v1/openapi.json");
      expect(manifest.exports, packageName).toHaveProperty(".");
    }
  });

  test("maintained source, configuration, and current documentation contain no retired surface", () => {
    const roots = [
      ".agents",
      ".github",
      "docs",
      "packages",
      "scripts",
      "stacks",
    ].flatMap((path) => maintainedFiles(join(ROOT, path)));
    const files = [
      ...roots,
      join(ROOT, "package.json"),
      join(ROOT, "README.md"),
      join(ROOT, "GLOSSARY.md"),
    ];
    const violations = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of retiredSurfacePatterns) {
        if (pattern.test(content)) {
          violations.push(`${relative(ROOT, file).replace(/\\/g, "/")}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
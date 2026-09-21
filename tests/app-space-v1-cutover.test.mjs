import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCAN_ROOTS = ["packages", "docs", "scripts", "stacks"];
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".jsonc", ".md"]);
const EXCLUDED_DIRECTORIES = new Set(["dist", "node_modules", "tests", ".wrangler"]);
const FORBIDDEN_PUBLIC_ARTIFACTS = [
  /\/v2\/apps/,
  /space-v2-contract/,
  /space-v2\.openapi\.json/,
  /@unicas\/space-protocol\/openapi-v2\.json/,
  /readSpaceContent/,
  /readSpaceMetadata/,
  /leaseSpaceNode/,
  /getSpaceUsage/,
  /runSpaceGc/,
  /listSpaceRootRefs/,
  /updateSpaceRootRefs/,
  /CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE/,
  /legacyV2IssuedBefore/,
  /X-CAS-Api-Version/,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && INCLUDED_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

describe("App/Space v1 cutover", () => {
  test("maintained surfaces contain no prototype public API artifacts", async () => {
    const files = (await Promise.all(SCAN_ROOTS.map((root) => sourceFiles(join(ROOT, root))))).flat();
    const violations = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_PUBLIC_ARTIFACTS) {
        if (forbidden.test(content)) {
          violations.push(`${relative(ROOT, file).replaceAll("\\", "/")}: ${forbidden.source}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
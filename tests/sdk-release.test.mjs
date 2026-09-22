import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeGzipOs } from "../scripts/prepare-sdk-release.mjs";

const ROOT = join(import.meta.dirname, "..");
const matrix = readJson("sdk/package-matrix.json");
const packageNames = new Set(matrix.packages.map(({ name }) => name));

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

function packageManifest(entry) {
  return readJson(`${entry.directory}/package.json`);
}

function exportKeys(exports) {
  return Object.keys(exports ?? {}).sort();
}

describe("App-user SDK release matrix", () => {
  test("defines one canonical unified-version release set", () => {
    expect(matrix).toMatchObject({
      schemaVersion: 1,
      releaseKey: "app-user-sdk",
      version: "0.0.0-bootstrap.0",
      distTag: "bootstrap",
      tagPrefix: "npm/app-user-sdk/v",
    });
    expect(matrix.packages).toHaveLength(6);
    expect(packageNames.size).toBe(matrix.packages.length);
    expect(new Set(matrix.packages.map(({ directory }) => directory)).size)
      .toBe(matrix.packages.length);
    expect(matrix.packages.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test.each(matrix.packages.map((entry) => [entry.name, entry]))(
    "%s manifest matches the public release contract",
    (_name, entry) => {
      const manifest = packageManifest(entry);
      expect(manifest.name).toBe(entry.name);
      expect(manifest.version).toBe(matrix.version);
      expect(manifest.private).not.toBe(true);
      expect(manifest.type).toBe("module");
      expect(manifest.license).toBe("MIT");
      expect(manifest.sideEffects).toBe(false);
      expect(manifest.engines).toEqual({ node: ">=24" });
      expect(manifest.repository).toEqual({
        type: "git",
        url: "git+https://github.com/shazhou-ww/unicas.git",
        directory: entry.directory,
      });
      expect(manifest.bugs).toEqual({ url: "https://github.com/shazhou-ww/unicas/issues" });
      expect(manifest.homepage).toBe("https://docs.unicas.work/app-user-api/");
      expect(manifest.publishConfig?.access).toBe("public");
      expect(manifest.publishConfig?.tag).toBeUndefined();
      expect(manifest.main).toBe("./src/index.ts");
      expect(manifest.types).toBe("./src/index.ts");
      expect(manifest.publishConfig?.main).toBe("./dist/index.js");
      expect(manifest.publishConfig?.types).toBe("./dist/index.d.ts");
      expect(existsSync(join(ROOT, entry.directory, "README.md"))).toBe(true);
      expect(exportKeys(manifest.exports)).toEqual([...entry.exports].sort());
      expect(exportKeys(manifest.publishConfig?.exports)).toEqual([...entry.exports].sort());
      expect(JSON.stringify(manifest.publishConfig?.exports)).not.toContain("/src/");
    },
  );

  test("internal dependencies follow the reviewed topological order", () => {
    const order = new Map(matrix.packages.map(({ name, order }) => [name, order]));
    for (const entry of matrix.packages) {
      const manifest = packageManifest(entry);
      const internal = Object.entries(manifest.dependencies ?? {})
        .filter(([name]) => packageNames.has(name));
      expect(internal.map(([name]) => name).sort()).toEqual([...entry.dependencies].sort());
      for (const [name, range] of internal) {
        expect(range).toBe("workspace:*");
        expect(order.get(name)).toBeLessThan(entry.order);
      }
    }
  });

  test("release builds omit source and declaration maps", () => {
    for (const entry of matrix.packages) {
      const tsconfig = readJson(`${entry.directory}/tsconfig.json`);
      expect(tsconfig.compilerOptions?.sourceMap).toBe(false);
      expect(tsconfig.compilerOptions?.declarationMap).toBe(false);
      expect(tsconfig.compilerOptions?.newLine).toBe("lf");
    }
  });

  test("the OpenAPI generator is not a protocol consumer dependency", () => {
    const protocol = packageManifest(matrix.packages.find(({ name }) => name === "@unicas/space-protocol"));
    expect(protocol.dependencies?.["@orpc/openapi"]).toBeUndefined();
    expect(protocol.devDependencies?.["@orpc/openapi"]).toBe("1.15.0");
  });

  test("normalizes host-specific gzip metadata without changing the payload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "unicas-sdk-gzip-"));
    const archivePath = join(directory, "package.tgz");
    const archive = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x0a, 0xaa, 0xbb]);
    try {
      writeFileSync(archivePath, archive);
      await normalizeGzipOs(archivePath);
      const normalized = readFileSync(archivePath);
      expect(normalized[9]).toBe(0x03);
      expect(normalized.subarray(0, 9)).toEqual(archive.subarray(0, 9));
      expect(normalized.subarray(10)).toEqual(archive.subarray(10));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

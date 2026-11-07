import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function normalizeDeclaration(source) {
  return `${source.replaceAll("\r\n", "\n").trimEnd()}\n`;
}

function declarationName(packageName) {
  return `${packageName.slice(packageName.indexOf("/") + 1)}.d.ts`;
}

export async function syncSdkApiBaseline(root, matrix, mode) {
  if (mode !== "write" && mode !== "check") throw new Error(`unknown API baseline mode: ${mode}`);
  const apiDirectory = join(root, "release", "app-user-sdk", "api");
  await mkdir(apiDirectory, { recursive: true });
  const packages = [];
  for (const entry of matrix.packages) {
    const declaration = normalizeDeclaration(
      await readFile(join(root, entry.directory, "dist", "index.d.ts"), "utf8"),
    );
    const file = declarationName(entry.name);
    const path = join(apiDirectory, file);
    if (mode === "write") {
      await writeFile(path, declaration, "utf8");
    } else {
      const expected = await readFile(path, "utf8").catch(() => "");
      if (expected !== declaration) {
        throw new Error(`${entry.name}: public API baseline differs; review the change and run pnpm release:sdk:prepare`);
      }
    }
    packages.push({
      name: entry.name,
      version: matrix.version,
      declaration: `release/app-user-sdk/api/${file}`,
      sha256: createHash("sha256").update(declaration).digest("hex"),
      exports: entry.exports,
    });
  }
  const manifest = canonicalJson({
    schemaVersion: 1,
    releaseKey: matrix.releaseKey,
    version: matrix.version,
    packages,
  });
  const manifestPath = join(apiDirectory, "manifest.json");
  if (mode === "write") {
    await writeFile(manifestPath, manifest, "utf8");
  } else if (await readFile(manifestPath, "utf8").catch(() => "") !== manifest) {
    throw new Error("release/app-user-sdk/api/manifest.json differs; review the API change and run pnpm release:sdk:prepare");
  }
  const expectedFiles = new Set([
    "README.md",
    "manifest.json",
    ...packages.map(({ declaration }) => basename(declaration)),
  ]);
  const unexpected = (await readdir(apiDirectory)).filter((file) => !expectedFiles.has(file));
  if (unexpected.length > 0) {
    throw new Error(`release/app-user-sdk/api contains unexpected files: ${unexpected.join(", ")}`);
  }
  return packages;
}

async function main() {
  const [arg] = process.argv.slice(2);
  const mode = arg === "--write" ? "write" : arg === "--check" ? "check" : null;
  if (mode === null) throw new Error("one of --write or --check is required");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const matrix = JSON.parse(
    await readFile(join(root, "release", "app-user-sdk", "package-matrix.json"), "utf8"),
  );
  await syncSdkApiBaseline(root, matrix, mode);
  console.log(`SDK API BASELINE ${mode.toUpperCase()} PASS`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

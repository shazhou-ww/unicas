import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { stringify as stringifyYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MATRIX_PATH = join(ROOT, "sdk", "package-matrix.json");
const RELEASE_MANIFEST_PATH = join(ROOT, "sdk", "release-manifest.json");
const CONSUMER_FIXTURE = join(ROOT, "tests", "fixtures", "sdk-consumer");
const PNPM = resolvePnpmCommand();
const TAR = process.platform === "win32" ? "tar.exe" : "tar";

function resolvePnpmCommand() {
  if (process.platform !== "win32") return "pnpm";
  const located = spawnSync("where.exe", ["pnpm.CMD"], { encoding: "utf8" });
  if (located.status !== 0) throw new Error("pnpm.CMD is not available on PATH");
  const shim = located.stdout.split(/\r?\n/u).find(Boolean);
  const match = /@"([^"]+pnpm\.exe)"/iu.exec(readFileSync(shim, "utf8"));
  if (!match) throw new Error(`cannot resolve pnpm executable from ${shim}`);
  return resolve(match[1].replace(/^%~dp0/iu, `${dirname(shim)}${sep}`));
}

function parseArgs(argv) {
  const options = { mode: null, outputDir: null, keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") options.mode = "write";
    else if (arg === "--check") options.mode = "check";
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--output-dir") {
      options.outputDir = argv[++index];
      if (!options.outputDir) throw new Error("--output-dir requires a path");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.mode === null) throw new Error("one of --write or --check is required");
  return options;
}

function run(command, args, { cwd = ROOT, env = process.env, stdio = "pipe", encoding = "utf8" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio,
    encoding,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "";
    const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr?.toString("utf8") ?? "";
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${stdout}${stderr}`.trim());
  }
  return result.stdout;
}

function runPnpm(args, options) {
  return run(PNPM, args, options);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

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

function parsePackJson(output) {
  const text = String(output);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`pnpm pack returned no JSON: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

function archiveBytes(archivePath, member) {
  return run(TAR, ["-xOf", archivePath, member], { encoding: null });
}

function archiveFiles(archivePath) {
  return String(run(TAR, ["-tf", archivePath]))
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.endsWith("/"))
    .map((entry) => entry.replace(/^package\//u, ""))
    .sort();
}

function sha512(buffer) {
  return createHash("sha512").update(buffer).digest();
}

async function normalizeGzipOs(archivePath) {
  const archive = await readFile(archivePath);
  assert(
    archive.length >= 10 && archive[0] === 0x1f && archive[1] === 0x8b && archive[2] === 0x08,
    `${basename(archivePath)}: pnpm pack output is not a gzip archive`,
  );
  assert((archive[3] & 0x02) === 0, `${basename(archivePath)}: gzip header CRC prevents OS normalization`);
  // pnpm's advisory gzip OS byte varies by host and is outside the payload checksum.
  archive[9] = 0x03;
  await writeFile(archivePath, archive);
}

function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportTargets);
}

function sortRecord(record = {}) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanPackage(entry) {
  const directory = join(ROOT, entry.directory);
  await rm(join(directory, "dist"), { recursive: true, force: true });
  for (const name of await readdir(directory)) {
    if (name.endsWith(".tsbuildinfo")) await rm(join(directory, name), { force: true });
  }
}

async function buildPackages(matrix) {
  console.log("sdk: generate and validate OpenAPI");
  runPnpm(["--filter", "@unicas/space-protocol", "docs:generate"], { stdio: "inherit" });
  runPnpm(["check:openapi"], { stdio: "inherit" });
  await Promise.all(matrix.packages.map(cleanPackage));
  const filters = matrix.packages.flatMap(({ name }) => ["--filter", name]);
  console.log("sdk: build public packages");
  runPnpm([...filters, "-r", "build"], { stdio: "inherit" });
}

async function packRound(matrix, destination) {
  await mkdir(destination, { recursive: true });
  const artifacts = [];
  for (const entry of matrix.packages) {
    const output = runPnpm(
      ["pack", "--pack-destination", destination, "--json"],
      { cwd: join(ROOT, entry.directory) },
    );
    const info = parsePackJson(output);
    const archivePath = resolve(info.filename);
    await normalizeGzipOs(archivePath);
    artifacts.push({ entry, info, archivePath });
  }
  return artifacts;
}

async function validateArtifact(matrix, artifact, rootLicense, openApiBytes) {
  const { entry, info, archivePath } = artifact;
  const archiveBuffer = await readFile(archivePath);
  const packedManifest = JSON.parse(archiveBytes(archivePath, "package/package.json").toString("utf8"));
  const reportedFiles = info.files.map(({ path }) => normalizePath(path)).sort();
  const actualFiles = archiveFiles(archivePath);
  assert(JSON.stringify(actualFiles) === JSON.stringify(reportedFiles), `${entry.name}: archive inventory differs from pnpm JSON`);
  assert(info.name === entry.name && packedManifest.name === entry.name, `${entry.name}: packed name mismatch`);
  assert(info.version === matrix.version && packedManifest.version === matrix.version, `${entry.name}: packed version mismatch`);
  assert(packedManifest.main === "./dist/index.js", `${entry.name}: packed main is not dist/index.js`);
  assert(packedManifest.types === "./dist/index.d.ts", `${entry.name}: packed types is not dist/index.d.ts`);
  assert(packedManifest.private !== true, `${entry.name}: packed package is private`);
  assert(packedManifest.publishConfig?.access === "public", `${entry.name}: packed access is not public`);
  assert(!JSON.stringify(packedManifest).includes("workspace:"), `${entry.name}: packed manifest contains workspace range`);

  const allowed = (path) => path === "package.json"
    || path === "LICENSE"
    || path === "README.md"
    || /^dist\/.+\.(?:js|d\.ts)$/u.test(path)
    || (entry.name === "@unicas/space-protocol" && path === "openapi/app-space-v1.openapi.json");
  const unexpected = actualFiles.filter((path) => !allowed(path));
  assert(unexpected.length === 0, `${entry.name}: unexpected packed files: ${unexpected.join(", ")}`);
  for (const required of ["package.json", "LICENSE", "README.md", "dist/index.js", "dist/index.d.ts"]) {
    assert(actualFiles.includes(required), `${entry.name}: missing ${required}`);
  }
  assert(actualFiles.every((path) => !path.endsWith(".map")), `${entry.name}: source or declaration map was packed`);
  assert(actualFiles.every((path) => !path.startsWith("src/")), `${entry.name}: source file was packed`);

  for (const target of exportTargets(packedManifest.exports)) {
    const path = target.replace(/^\.\//u, "");
    assert(actualFiles.includes(path), `${entry.name}: export target ${target} is absent`);
  }

  assert(Buffer.compare(archiveBytes(archivePath, "package/LICENSE"), rootLicense) === 0, `${entry.name}: LICENSE bytes differ`);
  if (entry.name === "@unicas/space-protocol") {
    assert(actualFiles.includes("openapi/app-space-v1.openapi.json"), `${entry.name}: OpenAPI file is absent`);
    assert(
      Buffer.compare(archiveBytes(archivePath, "package/openapi/app-space-v1.openapi.json"), openApiBytes) === 0,
      `${entry.name}: OpenAPI bytes differ`,
    );
  }

  const packageNames = new Set(matrix.packages.map(({ name }) => name));
  const internalDependencies = Object.entries(packedManifest.dependencies ?? {})
    .filter(([name]) => packageNames.has(name));
  assert(
    JSON.stringify(internalDependencies.map(([name]) => name).sort()) === JSON.stringify([...entry.dependencies].sort()),
    `${entry.name}: packed internal dependencies differ from the matrix`,
  );
  for (const [name, version] of internalDependencies) {
    assert(version === matrix.version, `${entry.name}: ${name} is ${version}, expected ${matrix.version}`);
  }
  const forbiddenDependencies = Object.keys(packedManifest.dependencies ?? {})
    .filter((name) => name.startsWith("@unidocs/")
      || /^@unicas\/(?:admin-|service|spaces|docs-site|control-auth)/u.test(name));
  assert(forbiddenDependencies.length === 0, `${entry.name}: forbidden dependencies: ${forbiddenDependencies.join(", ")}`);

  return {
    name: entry.name,
    version: packedManifest.version,
    order: entry.order,
    runtime: entry.runtime,
    tarball: basename(archivePath),
    integrity: `sha512-${sha512(archiveBuffer).toString("base64")}`,
    bytes: (await stat(archivePath)).size,
    files: actualFiles,
    exports: packedManifest.exports,
    dependencies: sortRecord(packedManifest.dependencies),
  };
}

async function verifyInstalledPackages(matrix, consumerDirectory) {
  const consumerRoot = `${await realpath(consumerDirectory)}${sep}`;
  for (const entry of matrix.packages) {
    const [scope, name] = entry.name.split("/");
    const installed = await realpath(join(consumerDirectory, "node_modules", scope, name));
    assert(installed.startsWith(consumerRoot), `${entry.name}: resolved outside the external consumer`);
    assert(!installed.startsWith(`${await realpath(ROOT)}${sep}`), `${entry.name}: resolved to the repository workspace`);
  }
}

async function createConsumer(matrix, artifacts, temporaryRoot) {
  const consumerDirectory = join(temporaryRoot, "consumer");
  await cp(CONSUMER_FIXTURE, consumerDirectory, { recursive: true });
  const dependencies = {};
  const overrides = {};
  for (const artifact of artifacts) {
    const specifier = `file:${normalizePath(relative(consumerDirectory, artifact.archivePath))}`;
    dependencies[artifact.entry.name] = specifier;
    overrides[artifact.entry.name] = specifier;
  }
  await writeFile(join(consumerDirectory, "package.json"), canonicalJson({
    name: "unicas-sdk-external-consumer",
    private: true,
    type: "module",
    packageManager: "pnpm@11.24.0",
    dependencies,
    devDependencies: {
      "@types/node": "24.13.3",
      esbuild: "0.28.2",
      typescript: "5.9.3",
    },
  }));
  await writeFile(
    join(consumerDirectory, "pnpm-workspace.yaml"),
    stringifyYaml({ packages: ["."], overrides }, { lineWidth: 0 }),
  );

  console.log("sdk: install packed artifacts outside the workspace");
  runPnpm(["install", "--ignore-scripts", "--no-frozen-lockfile"], { cwd: consumerDirectory, stdio: "inherit" });
  await verifyInstalledPackages(matrix, consumerDirectory);
  console.log("sdk: typecheck packed declarations");
  runPnpm(["exec", "tsc", "--project", "tsconfig.json"], { cwd: consumerDirectory, stdio: "inherit" });

  await mkdir(join(consumerDirectory, "out"), { recursive: true });
  runPnpm([
    "exec", "esbuild", "node-smoke.ts", "--bundle", "--platform=node", "--format=esm",
    "--outfile=out/node-smoke.mjs",
  ], { cwd: consumerDirectory, stdio: "inherit" });
  run(process.execPath, [join(consumerDirectory, "out", "node-smoke.mjs")], { stdio: "inherit" });

  await mkdir(join(consumerDirectory, "site"), { recursive: true });
  runPnpm([
    "exec", "esbuild", "browser-smoke.ts", "--bundle", "--platform=browser", "--format=esm",
    "--outfile=site/app.js",
  ], { cwd: consumerDirectory, stdio: "inherit" });
  await writeFile(
    join(consumerDirectory, "site", "index.html"),
    "<!doctype html><html><body><script type=\"module\" src=\"/app.js\"></script></body></html>\n",
  );
  await runBrowserSmoke(join(consumerDirectory, "site"));
}

async function runBrowserSmoke(siteDirectory) {
  const server = createServer(async (request, response) => {
    const path = request.url === "/app.js" ? "app.js" : "index.html";
    try {
      const content = await readFile(join(siteDirectory, path));
      response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object", "browser smoke server has no address");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => document.body.dataset.result !== undefined, null, { timeout: 20_000 });
    const result = await page.locator("body").getAttribute("data-result");
    const text = await page.locator("body").innerText();
    assert(result === "pass", `browser consumer failed: ${text}`);
    assert(errors.length === 0, `browser consumer console errors: ${errors.join("; ")}`);
    console.log(text);
  } finally {
    await browser.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function copyArtifacts(artifacts, outputDir) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const artifact of artifacts) {
    await cp(artifact.archivePath, join(outputDir, basename(artifact.archivePath)));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = await readJson(MATRIX_PATH);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "unicas-sdk-release-"));
  console.log(`sdk: temporary release root ${temporaryRoot}`);
  try {
    await buildPackages(matrix);
    const firstRound = await packRound(matrix, join(temporaryRoot, "round-a"));
    const secondRound = await packRound(matrix, join(temporaryRoot, "round-b"));
    const rootLicense = await readFile(join(ROOT, "LICENSE"));
    const openApiBytes = await readFile(join(ROOT, "packages", "space-protocol", "openapi", "app-space-v1.openapi.json"));
    const packageEvidence = [];
    for (let index = 0; index < firstRound.length; index += 1) {
      const first = firstRound[index];
      const second = secondRound[index];
      assert(first.entry.name === second.entry.name, "pack rounds used different package order");
      const firstHash = sha512(await readFile(first.archivePath));
      const secondHash = sha512(await readFile(second.archivePath));
      assert(firstHash.equals(secondHash), `${first.entry.name}: repeated pack was not deterministic`);
      packageEvidence.push(await validateArtifact(matrix, first, rootLicense, openApiBytes));
    }
    const releaseManifest = {
      schemaVersion: 1,
      releaseKey: matrix.releaseKey,
      version: matrix.version,
      distTag: matrix.distTag,
      tag: `${matrix.tagPrefix}${matrix.version}`,
      packages: packageEvidence,
    };
    const candidate = canonicalJson(releaseManifest);
    await createConsumer(matrix, firstRound, temporaryRoot);
    if (options.mode === "write") {
      await writeFile(RELEASE_MANIFEST_PATH, candidate, "utf8");
      console.log(`sdk: wrote ${normalizePath(relative(ROOT, RELEASE_MANIFEST_PATH))}`);
    } else {
      const expected = await readFile(RELEASE_MANIFEST_PATH, "utf8").catch(() => "");
      if (expected !== candidate) {
        const expectedPackages = new Map(
          (JSON.parse(expected || "{}").packages ?? []).map((entry) => [entry.name, entry]),
        );
        const differences = packageEvidence.map(({ name, bytes, integrity }) => ({
          name,
          expectedBytes: expectedPackages.get(name)?.bytes,
          actualBytes: bytes,
          expectedIntegrity: expectedPackages.get(name)?.integrity,
          actualIntegrity: integrity,
        })).filter((entry) => entry.expectedBytes !== entry.actualBytes
          || entry.expectedIntegrity !== entry.actualIntegrity);
        throw new Error(`sdk/release-manifest.json is stale; run pnpm sdk:prepare\n${JSON.stringify(differences, null, 2)}`);
      }
    }
    if (options.outputDir) await copyArtifacts(firstRound, resolve(ROOT, options.outputDir));
    console.log("SDK RELEASE CHECK PASS");
  } finally {
    if (options.keepTemp) console.log(`sdk: retained ${temporaryRoot}`);
    else await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

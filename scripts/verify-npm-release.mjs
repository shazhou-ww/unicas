import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY = "https://registry.npmjs.org";
const CONSUMER_FIXTURE = join(ROOT, "tests", "fixtures", "sdk-consumer");
const NPM = resolveNpmCommand();
const EXPECTED_REPOSITORY = "https://github.com/shazhou-ww/unicas";
const EXPECTED_WORKFLOW_PATH = ".github/workflows/publish-npm.yml";
const EXPECTED_BOOTSTRAP_VERSION = "0.0.0-bootstrap.0";
const EXPECTED_BOOTSTRAP_DEPRECATION = "Bootstrap-only package record; use 0.1.0-beta.1 or later.";

function resolveNpmCommand() {
  if (process.platform !== "win32") return { command: "npm", prefix: [] };
  const located = spawnSync("where.exe", ["npm.CMD"], { encoding: "utf8" });
  if (located.status !== 0) throw new Error("npm.CMD is not available on PATH");
  const shim = located.stdout.split(/\r?\n/u).find(Boolean);
  const cli = join(dirname(shim), "node_modules", "npm", "bin", "npm-cli.js");
  readFileSync(cli);
  return { command: process.execPath, prefix: [cli] };
}

function run(command, args, { cwd = ROOT, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

function runNpm(args, options) {
  run(NPM.command, [...NPM.prefix, ...args], options);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response.json();
}

function sha512(buffer) {
  return `sha512-${createHash("sha512").update(buffer).digest("base64")}`;
}

function gitTagCommit(tag) {
  const result = spawnSync("git", ["rev-parse", `refs/tags/${tag}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
  });
  assert(result.status === 0, `release tag is not available locally: ${tag}`);
  return result.stdout.trim();
}

function verifyProvenance(document, manifest, evidence, expectedCommit) {
  const attestation = document.attestations?.find(
    ({ predicateType }) => predicateType === "https://slsa.dev/provenance/v1",
  );
  assert(attestation, `${evidence.name}: SLSA attestation is absent`);
  const statement = JSON.parse(
    Buffer.from(attestation.bundle?.dsseEnvelope?.payload ?? "", "base64").toString("utf8"),
  );
  const expectedSubject = `pkg:npm/${evidence.name.replace(/^@/u, "%40")}@${evidence.version}`;
  const subject = statement.subject?.find(({ name }) => name === expectedSubject);
  assert(subject, `${evidence.name}: provenance subject differs`);
  const expectedDigest = Buffer.from(evidence.integrity.slice("sha512-".length), "base64").toString("hex");
  assert(subject.digest?.sha512 === expectedDigest, `${evidence.name}: provenance digest differs`);

  const predicate = statement.predicate;
  const workflow = predicate?.buildDefinition?.externalParameters?.workflow;
  const expectedRef = `refs/tags/${manifest.tag}`;
  assert(workflow?.repository === EXPECTED_REPOSITORY, `${evidence.name}: provenance repository differs`);
  assert(workflow?.path === EXPECTED_WORKFLOW_PATH, `${evidence.name}: provenance workflow differs`);
  assert(workflow?.ref === expectedRef, `${evidence.name}: provenance ref differs`);
  const source = predicate?.buildDefinition?.resolvedDependencies?.find(
    ({ digest }) => digest?.gitCommit === expectedCommit,
  );
  assert(source?.uri === `git+${EXPECTED_REPOSITORY}@${expectedRef}`, `${evidence.name}: provenance source differs`);
  assert(
    predicate?.runDetails?.builder?.id === "https://github.com/actions/runner/github-hosted",
    `${evidence.name}: provenance builder differs`,
  );
  const invocationId = predicate?.runDetails?.metadata?.invocationId;
  assert(
    new RegExp(`^${EXPECTED_REPOSITORY}/actions/runs/[0-9]+/attempts/[0-9]+$`, "u").test(invocationId ?? ""),
    `${evidence.name}: provenance invocation differs`,
  );
  return invocationId;
}

async function verifyRegistryPackage(matrix, manifest, evidence, expectedCommit, expectLatest) {
  const encodedName = encodeURIComponent(evidence.name);
  const suffix = `cachebust=${Date.now()}-${evidence.order}`;
  const metadata = await fetchJson(`${REGISTRY}/${encodedName}/${evidence.version}?${suffix}`);
  assert(metadata.name === evidence.name, `${evidence.name}: registry name differs`);
  assert(metadata.version === evidence.version, `${evidence.name}: registry version differs`);
  assert(metadata.dist?.integrity === evidence.integrity, `${evidence.name}: registry integrity differs`);
  assert(
    JSON.stringify(canonicalize(metadata.exports)) === JSON.stringify(canonicalize(evidence.exports)),
    `${evidence.name}: registry exports differ`,
  );
  assert(
    JSON.stringify(canonicalize(metadata.dependencies ?? {}))
      === JSON.stringify(canonicalize(evidence.dependencies ?? {})),
    `${evidence.name}: registry dependencies differ`,
  );
  assert(
    metadata.dist?.attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1",
    `${evidence.name}: SLSA provenance metadata is absent`,
  );
  const attestationDocument = await fetchJson(`${metadata.dist.attestations.url}?${suffix}`);
  const invocationId = verifyProvenance(attestationDocument, manifest, evidence, expectedCommit);

  const tarballResponse = await fetch(metadata.dist.tarball, { headers: { "Cache-Control": "no-cache" } });
  assert(tarballResponse.ok, `${evidence.name}: tarball HTTP ${tarballResponse.status}`);
  const tarball = Buffer.from(await tarballResponse.arrayBuffer());
  assert(sha512(tarball) === evidence.integrity, `${evidence.name}: downloaded tarball integrity differs`);

  const tags = await fetchJson(`${REGISTRY}/-/package/${encodedName}/dist-tags?${suffix}`);
  assert(tags[matrix.distTag] === matrix.version, `${evidence.name}: ${matrix.distTag} tag differs`);
  if (expectLatest) assert(tags.latest === matrix.version, `${evidence.name}: latest tag differs`);
  if (tags.bootstrap !== undefined) {
    assert(tags.bootstrap === EXPECTED_BOOTSTRAP_VERSION, `${evidence.name}: bootstrap tag differs`);
    const bootstrap = await fetchJson(`${REGISTRY}/${encodedName}/${EXPECTED_BOOTSTRAP_VERSION}?${suffix}`);
    assert(
      bootstrap.deprecated === EXPECTED_BOOTSTRAP_DEPRECATION,
      `${evidence.name}: bootstrap deprecation differs`,
    );
  }
  console.log(`registry: verified ${evidence.name}@${evidence.version}`);
  return invocationId;
}

async function verifyInstalledPackages(matrix, consumerDirectory) {
  const consumerRoot = `${await realpath(consumerDirectory)}${sep}`;
  for (const entry of matrix.packages) {
    const [scope, name] = entry.name.split("/");
    const installed = await realpath(join(consumerDirectory, "node_modules", scope, name));
    assert(installed.startsWith(consumerRoot), `${entry.name}: resolved outside the registry consumer`);
    assert(!installed.startsWith(`${await realpath(ROOT)}${sep}`), `${entry.name}: resolved to the workspace`);
  }
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
  assert(address && typeof address === "object", "registry consumer server has no address");
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
    assert(result === "pass", `registry browser consumer failed: ${text}`);
    assert(errors.length === 0, `registry browser consumer errors: ${errors.join("; ")}`);
    console.log(text);
  } finally {
    await browser.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function verifyRegistryConsumer(matrix) {
  const consumerDirectory = await mkdtemp(join(tmpdir(), "unicas-sdk-registry-consumer-"));
  try {
    await cp(CONSUMER_FIXTURE, consumerDirectory, { recursive: true });
    const dependencies = Object.fromEntries(matrix.packages.map(({ name }) => [name, matrix.version]));
    await writeFile(join(consumerDirectory, "package.json"), canonicalJson({
      name: "unicas-sdk-registry-consumer",
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
    const userConfig = join(consumerDirectory, ".npmrc");
    const globalConfig = join(consumerDirectory, "global.npmrc");
    const cacheDirectory = join(consumerDirectory, "npm-cache");
    await writeFile(userConfig, `registry=${REGISTRY}\n`, "utf8");
    await writeFile(globalConfig, "", "utf8");
    const env = {
      ...process.env,
      NPM_CONFIG_USERCONFIG: userConfig,
      npm_config_userconfig: userConfig,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      npm_config_globalconfig: globalConfig,
      NPM_CONFIG_REGISTRY: REGISTRY,
      npm_config_registry: REGISTRY,
      NPM_CONFIG_CACHE: cacheDirectory,
      npm_config_cache: cacheDirectory,
    };
    delete env.NODE_AUTH_TOKEN;
    delete env.NPM_TOKEN;
    delete env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
    delete env.npm_config_manage_package_manager_versions;

    runNpm(["install", "--ignore-scripts", "--prefer-online"], {
      cwd: consumerDirectory,
      env,
    });
    await verifyInstalledPackages(matrix, consumerDirectory);
    run(process.execPath, [
      join(consumerDirectory, "node_modules", "typescript", "bin", "tsc"),
      "--project", "tsconfig.json",
    ], { cwd: consumerDirectory, env });

    await mkdir(join(consumerDirectory, "out"), { recursive: true });
    run(process.execPath, [
      join(consumerDirectory, "node_modules", "esbuild", "bin", "esbuild"),
      "node-smoke.ts", "--bundle", "--platform=node", "--format=esm",
      "--outfile=out/node-smoke.mjs",
    ], { cwd: consumerDirectory, env });
    run(process.execPath, [join(consumerDirectory, "out", "node-smoke.mjs")], { cwd: consumerDirectory, env });

    await mkdir(join(consumerDirectory, "site"), { recursive: true });
    run(process.execPath, [
      join(consumerDirectory, "node_modules", "esbuild", "bin", "esbuild"),
      "browser-smoke.ts", "--bundle", "--platform=browser", "--format=esm",
      "--outfile=site/app.js",
    ], { cwd: consumerDirectory, env });
    await writeFile(
      join(consumerDirectory, "site", "index.html"),
      "<!doctype html><html><body><script type=\"module\" src=\"/app.js\"></script></body></html>\n",
    );
    await runBrowserSmoke(join(consumerDirectory, "site"));
    runNpm(["audit", "signatures"], { cwd: consumerDirectory, env });
    console.log("registry: external consumer passed");
  } finally {
    await rm(consumerDirectory, { recursive: true, force: true });
  }
}

export function workflowRunFromInvocationId(invocationId) {
  const workflowRun = invocationId.replace(/\/attempts\/[0-9]+$/u, "");
  assert(workflowRun !== invocationId, `invalid provenance invocation ID: ${invocationId}`);
  return workflowRun;
}

async function main() {
  const expectLatest = process.argv.slice(2).includes("--expect-latest");
  const matrix = await readJson(join(ROOT, "sdk", "package-matrix.json"));
  const manifest = await readJson(join(ROOT, "sdk", "release-manifest.json"));
  assert(manifest.version === matrix.version, "release manifest version differs from matrix");
  assert(manifest.distTag === matrix.distTag, "release manifest dist-tag differs from matrix");
  assert(manifest.packages.length === matrix.packages.length, "release manifest package count differs");
  const expectedCommit = gitTagCommit(manifest.tag);
  const invocationIds = new Set();
  const workflowRuns = new Set();
  for (const evidence of [...manifest.packages].sort((left, right) => left.order - right.order)) {
    const invocationId = await verifyRegistryPackage(
      matrix,
      manifest,
      evidence,
      expectedCommit,
      expectLatest,
    );
    invocationIds.add(invocationId);
    workflowRuns.add(workflowRunFromInvocationId(invocationId));
  }
  assert(workflowRuns.size === 1, "packages were not published by one workflow run");
  console.log(
    `registry: provenance commit ${expectedCommit} run ${[...workflowRuns][0]} `
    + `across ${invocationIds.size} attempt(s)`,
  );
  await verifyRegistryConsumer(matrix);
  console.log(`NPM RELEASE VERIFIED ${matrix.releaseKey}@${matrix.version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

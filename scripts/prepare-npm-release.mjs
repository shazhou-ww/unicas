import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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

function sameStructuredValue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function releaseVersionFromTag(tag, matrix) {
  assert(tag.startsWith(matrix.tagPrefix), `tag must start with ${matrix.tagPrefix}`);
  const version = tag.slice(matrix.tagPrefix.length);
  assert(semver.valid(version) === version, `tag version is not canonical SemVer: ${version}`);
  assert(version === matrix.version, `tag version ${version} does not match package-set version ${matrix.version}`);
  return version;
}

export function validatePackageSet(matrix, releaseManifest, manifests) {
  assert(matrix.releaseKey === "app-user-sdk", "unexpected SDK release key");
  assert(releaseManifest.releaseKey === matrix.releaseKey, "release manifest key differs from matrix");
  assert(releaseManifest.version === matrix.version, "release manifest version differs from matrix");
  assert(releaseManifest.distTag === matrix.distTag, "release manifest dist-tag differs from matrix");
  assert(releaseManifest.tag === `${matrix.tagPrefix}${matrix.version}`, "release manifest tag differs from matrix");
  assert(manifests.length === matrix.packages.length, "public package manifest count differs from matrix");

  const manifestByName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const evidenceByName = new Map(releaseManifest.packages.map((entry) => [entry.name, entry]));
  assert(manifestByName.size === matrix.packages.length, "public package names are not unique");
  assert(evidenceByName.size === matrix.packages.length, "release manifest package names are not unique");

  for (const entry of matrix.packages) {
    const manifest = manifestByName.get(entry.name);
    const evidence = evidenceByName.get(entry.name);
    assert(manifest, `${entry.name}: source manifest is absent`);
    assert(evidence, `${entry.name}: release evidence is absent`);
    assert(manifest.version === matrix.version, `${entry.name}: source version is not ${matrix.version}`);
    assert(evidence.version === matrix.version, `${entry.name}: evidence version is not ${matrix.version}`);
    assert(evidence.order === entry.order, `${entry.name}: publication order differs from matrix`);
    assert(evidence.tarball.endsWith(`-${matrix.version}.tgz`), `${entry.name}: tarball version differs from matrix`);
    assert(evidence.integrity.startsWith("sha512-"), `${entry.name}: SRI SHA-512 evidence is absent`);
    for (const dependency of entry.dependencies) {
      assert(
        evidence.dependencies?.[dependency] === matrix.version,
        `${entry.name}: ${dependency} is not pinned to ${matrix.version}`,
      );
    }
  }
}

export function buildReleasePlan({ tag, commit, matrix, releaseManifest, manifests, registryPackages }) {
  const version = releaseVersionFromTag(tag, matrix);
  validatePackageSet(matrix, releaseManifest, manifests);
  assert(/^[0-9a-f]{40}$/u.test(commit), "release commit must be a full lowercase SHA-1 commit ID");

  const evidenceByName = new Map(releaseManifest.packages.map((entry) => [entry.name, entry]));
  return {
    schemaVersion: 1,
    releaseKey: matrix.releaseKey,
    tag,
    commit,
    version,
    distTag: matrix.distTag,
    packages: [...matrix.packages]
      .sort((left, right) => left.order - right.order)
      .map((entry) => {
        const evidence = evidenceByName.get(entry.name);
        const published = registryPackages[entry.name];
        if (published !== null) {
          assert(published.metadata.name === entry.name, `${entry.name}: registry name differs from release evidence`);
          assert(published.metadata.version === version, `${entry.name}: registry version differs from release evidence`);
          assert(
            published.metadata.dist?.integrity === evidence.integrity,
            `${entry.name}@${version}: registry integrity differs from release evidence`,
          );
          assert(
            sameStructuredValue(published.metadata.exports, evidence.exports),
            `${entry.name}@${version}: registry exports differ from release evidence`,
          );
          assert(
            sameStructuredValue(published.metadata.dependencies ?? {}, evidence.dependencies ?? {}),
            `${entry.name}@${version}: registry dependencies differ from release evidence`,
          );
          assert(
            published.distTags[matrix.distTag] === version,
            `${entry.name}: registry ${matrix.distTag} tag differs from ${version}`,
          );
        }
        return {
          name: entry.name,
          version,
          order: entry.order,
          action: published === null ? "publish" : "verified",
          tarball: evidence.tarball,
          integrity: evidence.integrity,
        };
      }),
  };
}

export async function fetchRegistryPackages(matrix, registry = DEFAULT_REGISTRY, fetchImpl = fetch) {
  const state = {};
  for (const { name } of matrix.packages) {
    const encoded = encodeURIComponent(name);
    const cacheBust = `${Date.now()}-${encodeURIComponent(name)}`;
    const base = registry.replace(/\/$/u, "");
    const response = await fetchImpl(`${base}/${encoded}/${matrix.version}?cachebust=${cacheBust}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (response.status === 404) {
      state[name] = null;
      continue;
    }
    if (!response.ok) throw new Error(`npm preflight for ${name} failed: HTTP ${response.status}`);
    const metadata = await response.json();
    const tagsResponse = await fetchImpl(`${base}/-/package/${encoded}/dist-tags?cachebust=${cacheBust}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!tagsResponse.ok) throw new Error(`npm dist-tag preflight for ${name} failed: HTTP ${tagsResponse.status}`);
    state[name] = { metadata, distTags: await tagsResponse.json() };
  }
  return state;
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

export function verifyGitRelease(tag, commit, git = runGit) {
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  assert(head === commit, `checked-out commit ${head} differs from release commit ${commit}`);
  const tagTarget = git(["rev-parse", `refs/tags/${tag}^{commit}`]).stdout.trim();
  assert(tagTarget === commit, `tag ${tag} targets ${tagTarget}, not ${commit}`);
  const ancestry = git(["merge-base", "--is-ancestor", commit, "origin/main"], { allowFailure: true });
  assert(ancestry.status === 0, `release commit ${commit} is not reachable from origin/main`);
}

export function verifyReleaseCandidate(tag, commit, git = runGit) {
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const primary = git(["rev-parse", "origin/main"]).stdout.trim();
  assert(head === commit, `checked-out commit ${head} differs from release commit ${commit}`);
  assert(primary === commit, `origin/main ${primary} differs from release commit ${commit}`);
  const existing = git(["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], { allowFailure: true });
  assert(existing.status !== 0, `release tag already exists: ${tag}`);
}

function parseArgs(argv) {
  const options = { tag: null, commit: null, output: null, candidate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") options.tag = argv[++index];
    else if (arg === "--commit") options.commit = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--candidate") options.candidate = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function localTagExists(tag) {
  return runGit(["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], { allowFailure: true }).status === 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tag = required(options.tag, "--tag");
  const commit = required(options.commit, "--commit");
  const matrix = await readJson(join(ROOT, "sdk", "package-matrix.json"));
  const releaseManifest = await readJson(join(ROOT, "sdk", "release-manifest.json"));
  const manifests = await Promise.all(matrix.packages.map(({ directory }) => readJson(join(ROOT, directory, "package.json"))));
  releaseVersionFromTag(tag, matrix);
  validatePackageSet(matrix, releaseManifest, manifests);
  if (options.candidate || !localTagExists(tag)) verifyReleaseCandidate(tag, commit);
  else verifyGitRelease(tag, commit);
  const registryPackages = await fetchRegistryPackages(matrix);
  const plan = buildReleasePlan({ tag, commit, matrix, releaseManifest, manifests, registryPackages });
  if (options.output) {
    const output = resolve(ROOT, options.output);
    await writeFile(output, canonicalJson(plan), "utf8");
    console.log(`Prepared ${plan.releaseKey}@${plan.version} from ${plan.commit}`);
  } else {
    process.stdout.write(canonicalJson(plan));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

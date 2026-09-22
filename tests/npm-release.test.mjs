import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  buildReleasePlan,
  releaseVersionFromTag,
  validatePackageSet,
  verifyGitRelease,
  verifyReleaseCandidate,
} from "../scripts/prepare-npm-release.mjs";

const ROOT = join(import.meta.dirname, "..");
const matrix = readJson("sdk/package-matrix.json");
const releaseManifest = readJson("sdk/release-manifest.json");
const manifests = matrix.packages.map(({ directory }) => readJson(`${directory}/package.json`));

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

function registryState(version = null) {
  return Object.fromEntries(matrix.packages.map(({ name }) => [name, version === null ? [] : [version]]));
}

describe("App-user SDK npm release planner", () => {
  test("accepts only the canonical unified-version tag", () => {
    expect(releaseVersionFromTag("npm/app-user-sdk/v0.1.0-beta.1", matrix)).toBe("0.1.0-beta.1");
    for (const tag of [
      "npm/app-user-sdk/0.1.0-beta.1",
      "npm/codec/v0.1.0-beta.1",
      "npm/app-user-sdk/v0.1.0",
      "npm/app-user-sdk/vv0.1.0-beta.1",
      "npm/app-user-sdk/v01.0.0-beta.1",
    ]) {
      expect(() => releaseVersionFromTag(tag, matrix), tag).toThrow();
    }
  });

  test("builds one dependency-ordered plan when every immutable version is absent", () => {
    const plan = buildReleasePlan({
      tag: releaseManifest.tag,
      commit: "a".repeat(40),
      matrix,
      releaseManifest,
      manifests,
      registryVersions: registryState(),
    });
    expect(plan).toMatchObject({
      releaseKey: "app-user-sdk",
      version: "0.1.0-beta.1",
      distTag: "beta",
      commit: "a".repeat(40),
    });
    expect(plan.packages.map(({ name }) => name)).toEqual(matrix.packages.map(({ name }) => name));
    expect(plan.packages.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("fails closed on an existing version or mixed source version", () => {
    expect(() => buildReleasePlan({
      tag: releaseManifest.tag,
      commit: "a".repeat(40),
      matrix,
      releaseManifest,
      manifests,
      registryVersions: registryState(matrix.version),
    })).toThrow("immutable npm versions already exist");

    const mixed = manifests.map((manifest, index) => index === 5
      ? { ...manifest, version: "0.1.0-beta.2" }
      : manifest);
    expect(() => validatePackageSet(matrix, releaseManifest, mixed)).toThrow("source version");
  });

  test("fails closed when release evidence is incomplete or stale", () => {
    expect(() => validatePackageSet(matrix, {
      ...releaseManifest,
      packages: releaseManifest.packages.slice(0, -1),
    }, manifests)).toThrow("release manifest package names");
    expect(() => validatePackageSet(matrix, {
      ...releaseManifest,
      version: "0.1.0-beta.2",
    }, manifests)).toThrow("version differs");
  });

  test("requires the checked-out tag target to be reachable from primary", () => {
    const commit = "a".repeat(40);
    const tag = releaseManifest.tag;
    const successfulGit = (args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { status: 0, stdout: `${commit}\n` };
      if (args[0] === "rev-parse") return { status: 0, stdout: `${commit}\n` };
      if (args[0] === "merge-base") return { status: 0, stdout: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    };
    expect(() => verifyGitRelease(tag, commit, successfulGit)).not.toThrow();
    expect(() => verifyGitRelease(tag, commit, (args) => {
      const result = successfulGit(args);
      return args[0] === "merge-base" ? { ...result, status: 1 } : result;
    })).toThrow("not reachable from origin/main");
    expect(() => verifyGitRelease(tag, commit, (args) => {
      const result = successfulGit(args);
      return args[0] === "rev-parse" && args[1] !== "HEAD"
        ? { ...result, stdout: `${"b".repeat(40)}\n` }
        : result;
    })).toThrow("not");
  });

  test("plans an untagged candidate only at exact primary", () => {
    const commit = "a".repeat(40);
    const tag = releaseManifest.tag;
    const successfulGit = (args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${commit}\n` };
      if (args[0] === "show-ref") return { status: 1, stdout: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    };
    expect(() => verifyReleaseCandidate(tag, commit, successfulGit)).not.toThrow();
    expect(() => verifyReleaseCandidate(tag, commit, (args) => {
      const result = successfulGit(args);
      return args[0] === "show-ref" ? { ...result, status: 0 } : result;
    })).toThrow("release tag already exists");
    expect(() => verifyReleaseCandidate(tag, commit, (args) => {
      const result = successfulGit(args);
      return args[0] === "rev-parse" && args[1] === "origin/main"
        ? { ...result, stdout: `${"b".repeat(40)}\n` }
        : result;
    })).toThrow("origin/main");
  });
});

describe("tag-triggered npm publication workflow", () => {
  const source = readFileSync(join(ROOT, ".github", "workflows", "publish-npm.yml"), "utf8");
  const workflow = parseYaml(source);
  const validationJob = workflow.jobs.validate;
  const job = workflow.jobs.publish;
  const serialized = JSON.stringify(workflow);

  test("has one tag-only trigger and no manual or branch publication path", () => {
    expect(workflow.on).toEqual({ push: { tags: ["npm/app-user-sdk/v*"] } });
    expect(workflow.on).not.toHaveProperty("workflow_dispatch");
    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.on.push).not.toHaveProperty("branches");
  });

  test("uses the protected least-privilege trusted-publishing boundary", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "npm-${{ github.ref }}", "cancel-in-progress": false });
    expect(validationJob.environment).toBeUndefined();
    expect(validationJob.permissions).toEqual({ contents: "read" });
    expect(validationJob.permissions).not.toHaveProperty("id-token");
    expect(job.needs).toBe("validate");
    expect(job.environment).toBe("npm");
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(serialized).not.toContain("NPM_TOKEN");
    expect(serialized).not.toContain("NODE_AUTH_TOKEN");
    expect(serialized).not.toContain("contents\":\"write");
  });

  test("validates exact primary artifacts before the sole publish command", () => {
    const runs = [validationJob, job]
      .flatMap((currentJob) => currentJob.steps)
      .flatMap((step) => typeof step.run === "string" ? [step.run] : []);
    const combined = runs.join("\n");
    expect(combined).toContain("git fetch --no-tags origin main:refs/remotes/origin/main");
    expect(combined).toContain("pnpm sdk:artifacts");
    expect(combined).toContain("scripts/prepare-npm-release.mjs");
    expect(combined).toContain("--tag \"$GITHUB_REF_NAME\"");
    expect(combined).toContain("--commit \"$GITHUB_SHA\"");
    expect(combined).not.toContain("--candidate");
    expect(combined.match(/pnpm sdk:artifacts/gu)).toHaveLength(2);
    expect(combined.match(/prepare-npm-release\.mjs/gu)).toHaveLength(2);
    expect(combined.match(/npm publish/gu)).toHaveLength(1);
    expect(combined).toContain("--access public");
    expect(combined).toContain("--tag \"$dist_tag\"");
    expect(combined).toContain("--provenance");
    expect(source.indexOf("pnpm sdk:artifacts")).toBeLessThan(source.indexOf("npm publish"));
    expect(source.indexOf("prepare-npm-release.mjs")).toBeLessThan(source.indexOf("npm publish"));
  });

  test("does not place a registry-write command in local release scripts", () => {
    const localScripts = [
      readFileSync(join(ROOT, "scripts", "prepare-sdk-release.mjs"), "utf8"),
      readFileSync(join(ROOT, "scripts", "prepare-npm-release.mjs"), "utf8"),
    ].join("\n");
    expect(localScripts).not.toMatch(/\bnpm\s+publish\b/u);
    expect(localScripts).not.toMatch(/\bpnpm\s+publish\b/u);
  });
});

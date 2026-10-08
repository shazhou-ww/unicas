import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  buildReleasePlan,
  fetchRegistryPackages,
  releaseVersionFromTag,
  validatePackageSet,
  verifyGitRelease,
  verifyReleaseCandidate,
} from "../scripts/prepare-npm-release.mjs";
import { workflowRunFromInvocationId } from "../scripts/verify-npm-release.mjs";

const ROOT = join(import.meta.dirname, "..");
const matrix = readJson("sdk/package-matrix.json");
const releaseManifest = readJson("sdk/release-manifest.json");
const manifests = matrix.packages.map(({ directory }) => readJson(`${directory}/package.json`));

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

function emptyRegistryState() {
  return Object.fromEntries(matrix.packages.map(({ name }) => [name, null]));
}

function matchingRegistryState(names = matrix.packages.map(({ name }) => name)) {
  const included = new Set(names);
  const evidenceByName = new Map(releaseManifest.packages.map((entry) => [entry.name, entry]));
  return Object.fromEntries(matrix.packages.map(({ name }) => {
    if (!included.has(name)) return [name, null];
    const evidence = evidenceByName.get(name);
    return [name, {
      metadata: {
        name,
        version: matrix.version,
        dist: { integrity: evidence.integrity },
        exports: evidence.exports,
        dependencies: evidence.dependencies,
      },
      distTags: { [matrix.distTag]: matrix.version },
    }];
  }));
}

describe("App-user SDK npm release planner", () => {
  test("treats safe retries as attempts of the same protected workflow run", () => {
    const run = "https://github.com/shazhou-ww/unicas/actions/runs/123";
    expect(workflowRunFromInvocationId(`${run}/attempts/1`)).toBe(run);
    expect(workflowRunFromInvocationId(`${run}/attempts/2`)).toBe(run);
    expect(() => workflowRunFromInvocationId(run)).toThrow("invalid provenance invocation ID");
  });

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
      registryPackages: emptyRegistryState(),
    });
    expect(plan).toMatchObject({
      releaseKey: "app-user-sdk",
      version: "0.1.0-beta.1",
      distTag: "beta",
      commit: "a".repeat(40),
    });
    expect(plan.packages.map(({ name }) => name)).toEqual(matrix.packages.map(({ name }) => name));
    expect(plan.packages.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.packages.map(({ action }) => action)).toEqual(Array(6).fill("publish"));
  });

  test("verifies matching existing packages and resumes a partial publication", () => {
    const complete = buildReleasePlan({
      tag: releaseManifest.tag,
      commit: "a".repeat(40),
      matrix,
      releaseManifest,
      manifests,
      registryPackages: matchingRegistryState(),
    });
    expect(complete.packages.map(({ action }) => action)).toEqual(Array(6).fill("verified"));

    const partial = buildReleasePlan({
      tag: releaseManifest.tag,
      commit: "a".repeat(40),
      matrix,
      releaseManifest,
      manifests,
      registryPackages: matchingRegistryState(matrix.packages.slice(0, 3).map(({ name }) => name)),
    });
    expect(partial.packages.map(({ action }) => action)).toEqual([
      "verified", "verified", "verified", "publish", "publish", "publish",
    ]);
  });

  test("queries exact registry evidence and dist-tags without treating absence as a conflict", async () => {
    const codec = matchingRegistryState(["@unicas/codec"])["@unicas/codec"];
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url);
      if (url.includes("/-/package/")) return Response.json(codec.distTags);
      if (url.includes(encodeURIComponent("@unicas/codec"))) return Response.json(codec.metadata);
      return new Response(null, { status: 404 });
    };
    const state = await fetchRegistryPackages(matrix, "https://registry.example", fetchImpl);
    expect(state["@unicas/codec"]).toEqual(codec);
    expect(state["@unicas/space-protocol"]).toBeNull();
    expect(requests).toContainEqual(expect.stringContaining(
      `${encodeURIComponent("@unicas/codec")}/${matrix.version}?cachebust=`,
    ));
    expect(requests).toContainEqual(expect.stringContaining(
      `/-/package/${encodeURIComponent("@unicas/codec")}/dist-tags?cachebust=`,
    ));
  });

  test("can limit an immediate registry check to one package", async () => {
    const requests = [];
    const state = await fetchRegistryPackages(
      matrix,
      "https://registry.example",
      async (url) => {
        requests.push(url);
        return new Response(null, { status: 404 });
      },
      ["@unicas/space-client"],
    );
    expect(state).toEqual({ "@unicas/space-client": null });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(encodeURIComponent("@unicas/space-client"));
  });

  test("fails closed on mismatched immutable registry state or source versions", () => {
    const matching = matchingRegistryState();
    const mismatches = [
      {
        message: "registry integrity differs",
        state: {
          ...matching,
          "@unicas/codec": {
            ...matching["@unicas/codec"],
            metadata: {
              ...matching["@unicas/codec"].metadata,
              dist: { integrity: `sha512-${"A".repeat(88)}` },
            },
          },
        },
      },
      {
        message: "registry exports differ",
        state: {
          ...matching,
          "@unicas/codec": {
            ...matching["@unicas/codec"],
            metadata: { ...matching["@unicas/codec"].metadata, exports: { ".": "./wrong.js" } },
          },
        },
      },
      {
        message: "registry dependencies differ",
        state: {
          ...matching,
          "@unicas/space-client": {
            ...matching["@unicas/space-client"],
            metadata: { ...matching["@unicas/space-client"].metadata, dependencies: {} },
          },
        },
      },
      {
        message: "registry beta tag differs",
        state: {
          ...matching,
          "@unicas/codec": {
            ...matching["@unicas/codec"],
            distTags: { beta: "0.0.0-bootstrap.0" },
          },
        },
      },
    ];
    for (const { message, state } of mismatches) {
      expect(() => buildReleasePlan({
        tag: releaseManifest.tag,
        commit: "a".repeat(40),
        matrix,
        releaseManifest,
        manifests,
        registryPackages: state,
      }), message).toThrow(message);
    }

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
    expect(Object.keys(workflow.jobs)).toEqual(["publish"]);
    expect(job.environment).toBe("npm");
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(serialized).not.toContain("NPM_TOKEN");
    expect(serialized).not.toContain("NODE_AUTH_TOKEN");
    expect(serialized).not.toContain("contents\":\"write");
  });

  test("validates exact primary artifacts and resumes safely before the sole publish command", () => {
    const runs = [job]
      .flatMap((currentJob) => currentJob.steps)
      .flatMap((step) => typeof step.run === "string" ? [step.run] : []);
    const combined = runs.join("\n");
    const publishRun = job.steps.find(({ name }) => name === "Publish package set in dependency order").run;
    expect(combined).toContain("git fetch --no-tags origin main:refs/remotes/origin/main");
    expect(combined).toContain("pnpm sdk:artifacts");
    expect(combined).toContain("scripts/prepare-npm-release.mjs");
    expect(combined).toContain("--tag \"$GITHUB_REF_NAME\"");
    expect(combined).toContain("--commit \"$GITHUB_SHA\"");
    expect(combined).not.toContain("--candidate");
    expect(combined.match(/pnpm sdk:artifacts/gu)).toHaveLength(1);
    expect(combined.match(/prepare-npm-release\.mjs/gu)).toHaveLength(2);
    expect(combined.match(/npm publish/gu)).toHaveLength(1);
    expect(combined).toContain("--access public");
    expect(combined).toContain("--tag \"$dist_tag\"");
    expect(combined).toContain("--provenance");
    expect(publishRun).toContain("while IFS= read -r package_name");
    expect(publishRun).toContain("--package \"$package_name\"");
    expect(publishRun).toContain("entry.action");
    expect(publishRun).toContain("verified)");
    expect(publishRun).toContain("Verified existing ${package_name}");
    expect(publishRun).toContain("Unknown release action");
    expect(publishRun.indexOf("while IFS= read -r package_name"))
      .toBeLessThan(publishRun.indexOf("scripts/prepare-npm-release.mjs"));
    expect(publishRun.indexOf("scripts/prepare-npm-release.mjs"))
      .toBeLessThan(publishRun.indexOf("npm publish"));
    expect(source.indexOf("pnpm sdk:artifacts")).toBeLessThan(source.indexOf("npm publish"));
    expect(source.indexOf("prepare-npm-release.mjs")).toBeLessThan(source.indexOf("npm publish"));
    expect(combined).toContain("pnpm verify:npm-release");
  });

  test("does not place a registry-write command in local release scripts", () => {
    const localScripts = [
      readFileSync(join(ROOT, "scripts", "prepare-sdk-release.mjs"), "utf8"),
      readFileSync(join(ROOT, "scripts", "prepare-npm-release.mjs"), "utf8"),
      readFileSync(join(ROOT, "scripts", "verify-npm-release.mjs"), "utf8"),
    ].join("\n");
    expect(localScripts).not.toMatch(/\bnpm\s+publish\b/u);
    expect(localScripts).not.toMatch(/\bpnpm\s+publish\b/u);
  });
});

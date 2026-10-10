import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  hooksStatus,
  installHooks,
  uninstallHooks,
} from "../scripts/git/git-hooks.mjs";
import {
  parsePrePushInput,
  runMainPrePush,
} from "../scripts/git/pre-push-main.mjs";

const ROOT = join(import.meta.dirname, "..");
const ZERO_OBJECT_ID = "0".repeat(40);

function git(cwd, args, { env = process.env } = {}) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${`${result.stdout}${result.stderr}`.trim()}`);
  }
  return result.stdout.trim();
}

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "unicas-release-gated-ci-"));
  git(directory, ["init", "--initial-branch=main"]);
  git(directory, ["config", "user.email", "ci@example.invalid"]);
  git(directory, ["config", "user.name", "CI Test"]);
  writeFileSync(join(directory, "tracked.txt"), "first\n");
  git(directory, ["add", "tracked.txt"]);
  git(directory, ["commit", "-m", "first"]);
  return directory;
}

function updateLine(localObject, remoteRef = "refs/heads/main", remoteObject = ZERO_OBJECT_ID) {
  return `HEAD ${localObject} ${remoteRef} ${remoteObject}`;
}

describe("release-gated workflow triggers", () => {
  const ci = parseYaml(
    readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8"),
  );
  const security = parseYaml(
    readFileSync(join(ROOT, ".github", "workflows", "security.yml"), "utf8"),
  );

  test("runs full CI only for release pushes or explicit preflight", () => {
    expect(Object.keys(ci.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(ci.on.push).toEqual({ branches: ["release"] });
    const commands = ci.jobs.validate.steps.map(({ run }) => run).filter(Boolean);
    expect(commands).toContain("pnpm validate:release");
    expect(commands).not.toContain("pnpm validate");
    expect(commands).not.toContain("pnpm check:ideas:remote");
    expect(ci.jobs["deploy-production"].needs).toBe("validate");
  });

  test("retains PR dependency review and release, scheduled, and manual CodeQL", () => {
    expect(Object.keys(security.on).sort()).toEqual([
      "pull_request",
      "push",
      "schedule",
      "workflow_dispatch",
    ]);
    expect(security.on.push).toEqual({ branches: ["release"] });
    expect(security.jobs["dependency-review"].if).toBe(
      "github.event_name == 'pull_request'",
    );
    expect(security.jobs.codeql.permissions).toEqual({
      contents: "read",
      "security-events": "write",
    });
  });
});

describe("main pre-push validation", () => {
  test("parses every stdin row and rejects malformed input", () => {
    expect(parsePrePushInput(
      `${updateLine("1".repeat(40), "refs/heads/topic")}\n${updateLine("2".repeat(40))}\n`,
    )).toHaveLength(2);
    expect(() => parsePrePushInput("HEAD only-three fields")).toThrow(
      "exactly four fields",
    );
  });

  test("skips non-main pushes and validates a clean checked-out main SHA once", () => {
    const directory = createRepository();
    try {
      const revision = git(directory, ["rev-parse", "HEAD"]);
      let validations = 0;
      const skipped = runMainPrePush({
        input: updateLine(revision, "refs/heads/topic"),
        cwd: directory,
        validate: () => {
          validations += 1;
        },
        log: () => {},
      });
      expect(skipped).toEqual({ validated: false, reason: "no-main-update" });

      const result = runMainPrePush({
        input: [
          updateLine(revision, "refs/heads/topic"),
          updateLine(revision),
          updateLine(revision, "refs/heads/another"),
        ].join("\n"),
        cwd: directory,
        validate: () => {
          validations += 1;
        },
        log: () => {},
      });
      expect(result).toEqual({ validated: true, localObject: revision });
      expect(validations).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("fails closed for deletion, dirty state, non-HEAD revisions, and validation failure", () => {
    const directory = createRepository();
    try {
      const first = git(directory, ["rev-parse", "HEAD"]);
      expect(() => runMainPrePush({
        input: updateLine("f".repeat(40)),
        cwd: directory,
        validate: () => {},
        log: () => {},
      })).toThrow("not an available commit");

      expect(() => runMainPrePush({
        input: updateLine(ZERO_OBJECT_ID, "refs/heads/main", first),
        cwd: directory,
        validate: () => {},
        log: () => {},
      })).toThrow("deleting refs/heads/main");

      writeFileSync(join(directory, "dirty.txt"), "dirty\n");
      expect(() => runMainPrePush({
        input: updateLine(first),
        cwd: directory,
        validate: () => {},
        log: () => {},
      })).toThrow("worktree is not clean");
      rmSync(join(directory, "dirty.txt"));

      writeFileSync(join(directory, "tracked.txt"), "second\n");
      git(directory, ["add", "tracked.txt"]);
      git(directory, ["commit", "-m", "second"]);
      expect(() => runMainPrePush({
        input: updateLine(first),
        cwd: directory,
        validate: () => {},
        log: () => {},
      })).toThrow("checked-out HEAD");

      const second = git(directory, ["rev-parse", "HEAD"]);
      expect(() => runMainPrePush({
        input: updateLine(second),
        cwd: directory,
        validate: () => {
          throw new Error("synthetic validation failure");
        },
        log: () => {},
      })).toThrow("synthetic validation failure");

      expect(() => runMainPrePush({
        input: updateLine(second),
        cwd: directory,
        validate: () => {
          writeFileSync(join(directory, "generated.txt"), "generated\n");
        },
        log: () => {},
      })).toThrow("after validation: the worktree is not clean");
      rmSync(join(directory, "generated.txt"));

      expect(() => runMainPrePush({
        input: updateLine(second),
        cwd: directory,
        validate: () => {
          writeFileSync(join(directory, "tracked.txt"), "third\n");
          git(directory, ["add", "tracked.txt"]);
          git(directory, ["commit", "-m", "third"]);
        },
        log: () => {},
      })).toThrow("HEAD changed");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("repository hook lifecycle", () => {
  test("installs and removes the local hooks path idempotently", () => {
    const directory = createRepository();
    try {
      mkdirSync(join(directory, ".githooks"));
      writeFileSync(join(directory, ".githooks", "pre-push"), "#!/bin/sh\n");
      expect(installHooks({ cwd: directory, log: () => {} }).changed).toBe(true);
      expect(git(directory, ["config", "--local", "--get", "core.hooksPath"])).toBe(
        ".githooks",
      );
      expect(installHooks({ cwd: directory, log: () => {} }).changed).toBe(false);
      expect(uninstallHooks({ cwd: directory, log: () => {} }).changed).toBe(true);
      expect(hooksStatus({ cwd: directory }).state).toBe("uninstalled");
      expect(uninstallHooks({ cwd: directory, log: () => {} }).changed).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("preserves local and inherited hook configuration conflicts", () => {
    const directory = createRepository();
    const globalConfig = join(directory, "global.gitconfig");
    try {
      mkdirSync(join(directory, ".githooks"));
      writeFileSync(join(directory, ".githooks", "pre-push"), "#!/bin/sh\n");
      git(directory, ["config", "--local", "core.hooksPath", "personal-hooks"]);
      expect(() => installHooks({ cwd: directory, log: () => {} })).toThrow(
        "existing hook configuration was preserved",
      );
      expect(git(directory, ["config", "--local", "--get", "core.hooksPath"])).toBe(
        "personal-hooks",
      );

      git(directory, ["config", "--local", "--unset-all", "core.hooksPath"]);
      writeFileSync(globalConfig, "[core]\n\thooksPath = inherited-hooks\n");
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: globalConfig,
        GIT_CONFIG_NOSYSTEM: "1",
      };
      expect(hooksStatus({ cwd: directory, env }).state).toBe("inherited-conflict");
      expect(() => installHooks({ cwd: directory, env, log: () => {} })).toThrow(
        "existing hook configuration was preserved",
      );
      const local = spawnSync(
        "git",
        ["config", "--local", "--get", "core.hooksPath"],
        { cwd: directory, env, encoding: "utf8" },
      );
      expect(local.status).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

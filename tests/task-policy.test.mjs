import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const DOCS = join(ROOT, "docs");
const AGENT_INSTRUCTIONS = join(ROOT, "AGENTS.md");
const PACKAGE_JSON = join(ROOT, "package.json");
const REPOLEDGER_CONFIG = join(ROOT, "repoledger.json");
const TASK_PROFILE = join(ROOT, "tasks", "README.md");
const TASK_SKILL = join(
  ROOT,
  ".agents",
  "skills",
  "repository-task-ledger",
  "SKILL.md",
);
const SKILLS_LOCK = join(ROOT, "skills-lock.json");

function markdownFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) markdownFiles(path, files);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

describe("repository task policy", () => {
  test("requires the installed task skill from global agent instructions", () => {
    expect(existsSync(AGENT_INSTRUCTIONS)).toBe(true);
    expect(existsSync(join(ROOT, ".github", "copilot-instructions.md"))).toBe(false);
    const instructions = readFileSync(AGENT_INSTRUCTIONS, "utf8");
    for (const required of [
      ".agents/skills/repository-task-ledger/SKILL.md",
      "`repository-task-ledger` skill",
      "tasks/README.md",
      "tasks/backlog/",
      "tasks/ongoing/<identity>/",
      "task-ledger.identity",
      "task-ledger.defaultIdentity",
      "Progress.md",
      "tasks/archived/",
      "Reserve `docs/`",
      "pnpm check:tasks",
      "pnpm exec repoledger doctor",
    ]) {
      expect(instructions).toContain(required);
    }
  });

  test("pins and composes repoledger validation", () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
    expect(packageJson.devDependencies?.repoledger).toBe("0.1.0");
    expect(packageJson.scripts?.["check:tasks"]).toBe(
      "repoledger check && vitest run tests/task-policy.test.mjs",
    );
    expect(packageJson.scripts?.["check:repo"]).toContain("pnpm check:tasks");
    expect(packageJson.scripts?.test).toContain("pnpm check:repo");

    const config = JSON.parse(readFileSync(REPOLEDGER_CONFIG, "utf8"));
    expect(config).toEqual({
      $schema: "./node_modules/repoledger/schema/v1.json",
      tasksDirectory: "tasks",
      remote: "origin",
      branch: "main",
    });
  });

  test("pins the installed task skill to its shared source", () => {
    expect(existsSync(TASK_SKILL)).toBe(true);
    const skill = readFileSync(TASK_SKILL, "utf8");
    expect(skill).toContain("name: repository-task-ledger");
    expect(skill).toContain("extensions.worktreeConfig");
    expect(skill).toContain("task-ledger.identity");

    expect(existsSync(SKILLS_LOCK)).toBe(true);
    const lock = JSON.parse(readFileSync(SKILLS_LOCK, "utf8"));
    expect(lock.skills?.["repository-task-ledger"]).toMatchObject({
      source: "shazhou-ww/skills",
      sourceType: "github",
      skillPath: "skills/repository-task-ledger/SKILL.md",
    });
  });

  test("documents the worktree-local identity binding", () => {
    const profile = readFileSync(TASK_PROFILE, "utf8").replace(/\s+/g, " ");
    for (const required of [
      "extensions.worktreeConfig",
      "git config --worktree --get task-ledger.identity",
      "git config --worktree task-ledger.identity <identity>",
      "git config --global task-ledger.defaultIdentity <identity>",
      "do not store it in `.env`",
      "pnpm exec repoledger doctor",
      "Do not run `doctor` in CI",
    ]) {
      expect(profile).toContain(required);
    }
  });

  test("keeps task artifacts out of finalized documentation", () => {
    const violations = readdirSync(DOCS)
      .filter((name) => /(?:^|[-_])(plan|task|progress)\.md$/i.test(name))
      .sort();
    expect(violations).toEqual([]);
  });

  test("resolves local links in finalized documentation", () => {
    const broken = [];
    for (const file of markdownFiles(DOCS)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split("#", 1)[0];
        if (!target || /^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
        const decoded = decodeURIComponent(target);
        const path = isAbsolute(decoded)
          ? join(ROOT, decoded.replace(/^[/\\]+/, ""))
          : resolve(dirname(file), decoded);
        if (!existsSync(path)) broken.push(`${file.slice(ROOT.length + 1)}: ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
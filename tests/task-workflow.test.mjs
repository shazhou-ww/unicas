import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TASKS = join(ROOT, "tasks");
const DOCS = join(ROOT, "docs");
const AGENT_INSTRUCTIONS = join(ROOT, "AGENTS.md");
const TASK_SKILL = join(
  ROOT,
  ".agents",
  "skills",
  "repository-task-ledger",
  "SKILL.md",
);
const SKILLS_LOCK = join(ROOT, "skills-lock.json");
const STATES = ["backlog", "ongoing", "archived"];
const PORTABLE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_TASK_HEADINGS = [
  "## Goal",
  "## Context",
  "## Scope",
  "## Out of scope",
  "## Acceptance criteria",
  "## Constraints",
  "## References",
];

function stateEntries(state) {
  const directory = join(TASKS, state);
  return readdirSync(directory)
    .filter((name) => name !== ".gitkeep")
    .map((name) => ({ name, path: join(directory, name) }));
}

function ongoingIdentities() {
  return stateEntries("ongoing");
}

function taskDirectories(state) {
  if (state !== "ongoing") return stateEntries(state);

  return ongoingIdentities().flatMap((identity) => {
    if (!statSync(identity.path).isDirectory()) return [];
    return readdirSync(identity.path)
      .filter((name) => name !== ".gitkeep")
      .map((name) => ({
        identity: identity.name,
        name,
        path: join(identity.path, name),
      }));
  });
}

function taskLabel(task) {
  return relative(TASKS, task.path).replaceAll("\\", "/");
}

function markdownFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) markdownFiles(path, files);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

describe("repository task workflow", () => {
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
      "Progress.md",
      "tasks/archived/",
      "Reserve `docs/`",
      "pnpm check:tasks",
    ]) {
      expect(instructions).toContain(required);
    }
  });

  test("pins the installed task skill to its shared source", () => {
    expect(existsSync(TASK_SKILL)).toBe(true);
    const skill = readFileSync(TASK_SKILL, "utf8");
    expect(skill).toContain("name: repository-task-ledger");

    expect(existsSync(SKILLS_LOCK)).toBe(true);
    const lock = JSON.parse(readFileSync(SKILLS_LOCK, "utf8"));
    expect(lock.skills?.["repository-task-ledger"]).toMatchObject({
      source: "shazhou-ww/skills",
      sourceType: "github",
      skillPath: "skills/repository-task-ledger/SKILL.md",
    });
  });

  test("uses the three canonical status directories", () => {
    expect(existsSync(join(TASKS, "archieved"))).toBe(false);
    expect(STATES.filter((state) => !existsSync(join(TASKS, state)))).toEqual([]);
  });

  test("keeps task artifacts out of finalized documentation", () => {
    const violations = readdirSync(DOCS)
      .filter((name) => /(?:^|[-_])(plan|task|progress)\.md$/i.test(name))
      .sort();
    expect(violations).toEqual([]);
  });

  test("registers portable ongoing identities", () => {
    const violations = [];
    for (const identity of ongoingIdentities()) {
      if (!statSync(identity.path).isDirectory()) {
        violations.push(`ongoing/${identity.name} must be an identity directory`);
        continue;
      }
      if (!PORTABLE_NAME.test(identity.name)) {
        violations.push(`ongoing/${identity.name} must use lowercase kebab-case`);
      }
      if (!existsSync(join(identity.path, ".gitkeep"))) {
        violations.push(`ongoing/${identity.name} is missing .gitkeep`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("resolves local links in task and finalized documentation", () => {
    const broken = [];
    for (const file of [...markdownFiles(TASKS), ...markdownFiles(DOCS)]) {
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

  for (const state of STATES) {
    test(`${state} tasks have valid folders and required files`, () => {
      const violations = [];
      for (const task of taskDirectories(state)) {
        const label = taskLabel(task);
        if (!statSync(task.path).isDirectory()) {
          violations.push(`${label} must be a directory`);
          continue;
        }
        if (!PORTABLE_NAME.test(task.name)) {
          violations.push(`${label} must use lowercase kebab-case`);
        }
        const taskPath = join(task.path, "Task.md");
        if (!existsSync(taskPath)) {
          violations.push(`${label} is missing Task.md`);
          continue;
        }
        const taskText = readFileSync(taskPath, "utf8");
        for (const heading of REQUIRED_TASK_HEADINGS) {
          if (!taskText.includes(heading)) {
            violations.push(`${label}/Task.md is missing ${heading}`);
          }
        }

        const progressPath = join(task.path, "Progress.md");
        if (state === "backlog" && existsSync(progressPath)) {
          violations.push(`${label} must not have Progress.md before work starts`);
        }
        if (state !== "backlog" && !existsSync(progressPath)) {
          violations.push(`${label} is missing Progress.md`);
        }
        if (state === "archived" && existsSync(progressPath)) {
          const progressText = readFileSync(progressPath, "utf8");
          if (!progressText.includes("## Outcome")) {
            violations.push(`${label}/Progress.md is missing ## Outcome`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
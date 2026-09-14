import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TASKS = join(ROOT, "tasks");
const DOCS = join(ROOT, "docs");
const STATES = ["backlog", "ongoing", "archived"];
const REQUIRED_TASK_HEADINGS = [
  "## Goal",
  "## Context",
  "## Scope",
  "## Out of scope",
  "## Acceptance criteria",
  "## Constraints",
  "## References",
];

function taskDirectories(state) {
  const directory = join(TASKS, state);
  return readdirSync(directory)
    .filter((name) => name !== ".gitkeep")
    .map((name) => ({ name, path: join(directory, name) }));
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
        if (!statSync(task.path).isDirectory()) {
          violations.push(`${state}/${task.name} must be a directory`);
          continue;
        }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.name)) {
          violations.push(`${state}/${task.name} must use lowercase kebab-case`);
        }
        const taskPath = join(task.path, "Task.md");
        if (!existsSync(taskPath)) {
          violations.push(`${state}/${task.name} is missing Task.md`);
          continue;
        }
        const taskText = readFileSync(taskPath, "utf8");
        for (const heading of REQUIRED_TASK_HEADINGS) {
          if (!taskText.includes(heading)) {
            violations.push(`${state}/${task.name}/Task.md is missing ${heading}`);
          }
        }

        const progressPath = join(task.path, "Progress.md");
        if (state === "backlog" && existsSync(progressPath)) {
          violations.push(`${state}/${task.name} must not have Progress.md before work starts`);
        }
        if (state !== "backlog" && !existsSync(progressPath)) {
          violations.push(`${state}/${task.name} is missing Progress.md`);
        }
        if (state === "archived" && existsSync(progressPath)) {
          const progressText = readFileSync(progressPath, "utf8");
          if (!progressText.includes("## Outcome")) {
            violations.push(`${state}/${task.name}/Progress.md is missing ## Outcome`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
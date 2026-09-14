import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TASKS = join(ROOT, "tasks");
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

describe("repository task workflow", () => {
  test("uses the three canonical status directories", () => {
    expect(existsSync(join(TASKS, "archieved"))).toBe(false);
    expect(STATES.filter((state) => !existsSync(join(TASKS, state)))).toEqual([]);
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
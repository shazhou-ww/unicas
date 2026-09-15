# Adopt the repository task ledger skill

Created: 2026-09-15

## Goal

Adopt the shared `repository-task-ledger` skill as UniCAS's required workflow
for accepted, planned, or multi-step work.

## Context

UniCAS already stores tasks in the repository, but the workflow is duplicated
locally and active tasks have no identity lane. The shared skill packages the
method so projects, worktrees, people, and agents can use the same lifecycle
without depending on a particular code hosting platform.

## Scope

- Install and reference the shared skill from this repository.
- Require agents to load the skill for task triage and planned or multi-step
  work.
- Add per-worktree identity lanes below `tasks/ongoing/`.
- Migrate the existing active task without losing its Git history.
- Update local documentation and structural validation for the revised layout.

## Out of scope

- Replacing GitHub Issues as the public problem and request intake surface.
- Providing a distributed lock or guaranteeing conflict-free implementation.
- Automating Issue triage or task creation.

## Acceptance criteria

- [x] The shared skill is installable from `shazhou-ww/skills` and referenced
  by a reproducible project lock file.
- [x] Project instructions require the skill at the relevant workflow entry
  points.
- [x] Active tasks use `tasks/ongoing/<identity>/<task-name>`.
- [x] A new identity is visibly reserved on `main` before it is used.
- [x] Existing active task history and content are preserved.
- [x] `pnpm check:tasks` validates the new structure and passes.

## Constraints

- An identity may represent a person, agent, team, or other team-defined actor.
- Treat identity registration and task claims as early conflict signals, not
  absolute locks.
- Preserve unrelated local commits and working-tree changes.

## References

- [Shared repository-task-ledger skill](https://github.com/shazhou-ww/skills/tree/main/skills/repository-task-ledger)
- [Local task workflow](../../../README.md)
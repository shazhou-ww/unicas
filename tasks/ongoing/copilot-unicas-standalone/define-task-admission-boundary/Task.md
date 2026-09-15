# Define the repository task admission boundary

Created: 2026-09-15

## Goal

Require a repository task only when accepted work is expected to modify at
least one tracked file outside `tasks/**`.

## Context

The current shared skill triggers on planned or multi-step work broadly enough
that learning the skill, inspecting repository state, or maintaining the task
ledger itself can recursively create tasks. The ledger should coordinate
implementation work, not record every use of the workflow.

## Scope

- Define the admission rule in the shared `repository-task-ledger` skill and
  adoption guide.
- Exclude read-only learning, investigation, planning, review, validation,
  answers, and changes confined to `tasks/**` from new-task creation.
- Require late-discovered implementation work to be triaged and claimed before
  the first edit outside `tasks/**`.
- Publish the shared skill update and restore it into UniCAS.
- Update UniCAS instructions, task profile, and regression checks.

## Out of scope

- Changing identity registration, claim, handoff, archive, or overlap rules
  after a task has been admitted.
- Removing completed task history from `tasks/archived/`.
- Treating production operations or external tracker activity as repository
  file modifications when they do not change tracked files.

## Acceptance criteria

- [ ] The shared skill defines task admission by expected edits outside
      `tasks/**`, not by complexity or duration alone.
- [ ] The skill explicitly says that learning or using the skill does not by
      itself require a task.
- [ ] Read-only work and task-ledger-only maintenance remain task-free unless
      implementation edits become necessary.
- [ ] The adoption guide and UniCAS profile use the same boundary.
- [ ] The published shared skill, installed copy, and lock file agree.
- [ ] Shared-skill checks and UniCAS task-workflow tests pass.

## Constraints

- Keep the rule mechanical enough for an agent to decide before editing.
- Treat any tracked file outside `tasks/**`, including docs, configuration,
  workflows, tests, instructions, and skills, as implementation-bearing.
- Preserve the completed worktree-identity task in archived history.
- Preserve unrelated changes in both repositories.

## References

- [Shared repository-task-ledger skill](https://github.com/shazhou-ww/skills/tree/main/skills/repository-task-ledger)
- [UniCAS task workflow](../../../README.md)
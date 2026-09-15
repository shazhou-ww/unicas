# Progress

Updated: 2026-09-15

## Checklist

- [x] Verify the worktree identity and check for overlapping active work.
- [ ] Add the protected production deployment path and regression coverage.
- [ ] Document production setup, release, recovery, rotation, and rollback.
- [ ] Run the full acceptance validation and archive the completed task.

## Current state

The task is claimed by `copilot-unicas-standalone`. Existing CI validates all
pushes, pull requests, and manual runs but has no production deployment job.
The next action is to map the existing deployment and smoke configuration into
the smallest protected GitHub Actions job and its regression tests.

## Decisions

- Use the repository-owned deployment commands and keep `pnpm deploy` as a
  refusal path, as required by the task.

## Validation

- `git fetch origin main`: identity lane exists and no overlapping active task
  is present on `origin/main`.

## Blockers

- None.

## Outcome

In progress.
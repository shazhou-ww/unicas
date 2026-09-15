# Progress

Updated: 2026-09-15

## Checklist

- [ ] Inspect the production workflow, repository policy, regression tests, and operator guidance.
- [ ] Add the post-deployment production tag job with narrow permissions and fail-closed idempotency.
- [ ] Protect the `production-*` namespace without blocking workflow-created tags.
- [ ] Add regression coverage and operator recovery documentation.
- [ ] Run the required validation and publish the completed task.

## Current state

The task is claimed by `copilot-unicas-standalone` from current `origin/main`.
The configured identity lane is registered, and no overlapping active task was
found. Next, inspect the existing deployment workflow and its regression tests
to identify the smallest testable implementation.

## Decisions

- Keep the two unrelated modified deployment-smoke fixture files outside this
  task's commits.

## Validation

- `git fetch origin main --prune`: shared `main` refreshed before the claim.
- Identity and ledger checks: worktree-scoped identity is registered on
  `origin/main`; the task existed only in backlog and had no active overlap.
- `pnpm check:tasks`: passed (10 tests) after repairing references for the
  claimed task's additional directory depth.

## Blockers

- None.

## Outcome

In progress.
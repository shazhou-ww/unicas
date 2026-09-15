# Progress

Updated: 2026-09-15

## Checklist

- [x] Inspect the production workflow, repository policy, regression tests, and operator guidance.
- [x] Add the post-deployment production tag job with narrow permissions and fail-closed idempotency.
- [x] Protect the `production-*` namespace without blocking workflow-created tags.
- [x] Add regression coverage and operator recovery documentation.
- [ ] Run the required validation and publish the completed task.

## Current state

The workflow, tagging utility, regression coverage, and operator documentation
are implemented locally. GitHub ruleset `23425969` actively protects updates
and deletions under `refs/tags/production-*` without restricting creation or
allowing bypass. Full local validation passes. Next, publish to `main`, confirm
GitHub CI, then promote through `release` and observe the first automatic
production tag.

## Decisions

- Keep the two unrelated modified deployment-smoke fixture files outside this
  task's commits.
- Use an annotated tag so its immutable object records the workflow run URL,
  while the tag name remains deterministic from the original run timestamp and
  run number.
- Read the run's original `created_at` through the Actions API with
  `actions: read`; grant `contents: write` only to the dependent tagging job.
- Limit workflow push triggers to branches so the production tag does not
  start a recursive validation run.
- Protect the namespace with update and deletion rules only; a creation rule
  would also block the workflow's first push.

## Validation

- `git fetch origin main --prune`: shared `main` refreshed before the claim.
- Identity and ledger checks: worktree-scoped identity is registered on
  `origin/main`; the task existed only in backlog and had no active overlap.
- `pnpm check:tasks`: passed (10 tests) after repairing references for the
  claimed task's additional directory depth.
- `pnpm exec vitest run tests/deploy-plan.test.mjs --reporter=dot`: passed (26
  tests), including a temporary Git remote covering creation, metadata,
  idempotent reruns, and conflicting targets.
- VS Code diagnostics: no errors in the workflow, tagging utility, or
  deployment regression test.
- GitHub ruleset `23425969`: active tag target with include
  `refs/tags/production-*`, update and deletion rules, no creation rule, no
  bypass actors, and `current_user_can_bypass: never`.
- `pnpm check:repo`: passed (5 files, 124 tests).
- `pnpm docs:build`: passed; built 18 documentation pages.
- `pnpm build`: passed for all workspace projects.
- `pnpm typecheck`: passed for all workspace projects.
- `git diff --check`: passed; editor diagnostics reported no errors across all
  changed task files. `actionlint` was unavailable locally, so GitHub CI remains
  the workflow-parser validation.
- Focused read-only implementation review: no correctness or security findings;
  live workflow execution and the first automatic tag remain to be observed.

## Blockers

- None.

## Outcome

In progress.
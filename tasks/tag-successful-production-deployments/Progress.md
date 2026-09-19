# Progress

Updated: 2026-09-15

## Checklist

- [x] Inspect the production workflow, repository policy, regression tests, and operator guidance.
- [x] Add the post-deployment production tag job with narrow permissions and fail-closed idempotency.
- [x] Protect the `production-*` namespace without blocking workflow-created tags.
- [x] Add regression coverage and operator recovery documentation.
- [x] Run the required validation and publish the implementation.
- [x] Archive and publish the completed task.

## Current state

Implementation commit `198c7b3` is published on `origin/main` and was promoted
through pull request #1 as release commit `cf01559`. GitHub Actions run
`34948560913` completed validation, production deployment, canonical smoke,
every public-origin probe, and automatic tag creation. The resulting annotated
tag `production-20260915-48` points to `cf01559` and records that run's URL.
A tag-job-only rerun succeeded without changing the tag object or redeploying
production. The completed task is archived for final publication on `main`.

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
- Use repository-root task links beginning with `/`, as declared by the UniCAS
  task profile, so references remain valid across lifecycle moves.

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
- Main CI run `34948144004`: validation passed for `198c7b3`; production and
  tagging correctly skipped on `main`.
- Pull request #1 validation run `34948355836`: passed before the protected
  merge from `main` to `release`.
- Release run `34948560913` (run number 48, original `created_at`
  `2026-09-15T08:43:49Z`): validation and deployment passed for exact SHA
  `cf01559d8ba9604399fa3a516760241b63900beb`; service smoke, key cleanup,
  product and documentation deploys, and all four public-origin probes passed
  before the tag job started.
- Automatic tag `production-20260915-48`: annotated object
  `f7e32959334a45374f826138c09dbe08989913da` targets the exact release commit
  and records `https://github.com/shazhou-ww/unicas/actions/runs/34948560913`.
- Tag job attempt 2 (`104314901255`): passed without rerunning production and
  left the tag object SHA unchanged, proving live idempotency.
- Workflow runs for deployed SHA `cf01559`: exactly one push-triggered CI run,
  confirming the tag did not create a recursive run.
- `pnpm check:tasks`: passed (10 tests) after declaring repository-root task
  links and changing this task's references to stable `/...` paths.
- `pnpm check:tasks`: passed (10 tests) after the archive move; the ongoing
  source is absent, the archive destination is unique, and root links remain
  valid without rewriting.

## Blockers

- None.

## Outcome

Completed. Every acceptance criterion passed, including a protected production
deployment, one automatic immutable tag, and an idempotent tag-job rerun.
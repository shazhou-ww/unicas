# Progress

Updated: 2026-09-15

## Checklist

- [x] Confirm the current production gate and release-branch prerequisites.
- [x] Change workflow gating, regression coverage, and operator documentation.
- [ ] Switch the protected environment policy and create `release` safely.
- [ ] Verify `main` skips production and `release` deploys successfully.

## Current state

The task is claimed by `copilot-unicas-standalone`. The workflow and regression
tests now gate production on `refs/heads/release`, while validation remains
available to every push and pull request. Operator documentation defines
`main` as development and a reviewed `main` to `release` pull request as the
normal promotion. The next action is to validate and push this policy commit
to `main`, proving its production job skips before changing GitHub policy.

## Decisions

- Keep validation broad and move only the protected production condition from
  `main` to `release`.
- Preserve the archived deployment-automation task as historical evidence of
  the policy it completed; record the new policy in this task and stable
  operator documentation.
- Change the environment branch policy before creating/pushing `release`, so
  production credentials are never intentionally available to both branches.

## Validation

- Worktree identity `copilot-unicas-standalone` is registered and the worktree
  was clean before the claim.
- `git ls-remote --heads origin release`: no remote release branch exists.
- `origin/main` has no active or related backlog task.
- GitHub Actions run `34943777750` completed the final main-based release:
  validation passed in 1m40s and production passed in 1m02s.
- `pnpm exec vitest run tests/deploy-plan.test.mjs`: 21 tests passed after the
  release-only workflow change.
- `pnpm docs:check`: 3 tests passed after updating promotion and recovery
  guidance.
- The `Production` environment currently has one custom deployment branch
  policy named `main`; the repository currently has no rulesets.

## Blockers

- The environment branch policy and remote `release` branch must not change
  until the policy commit is validated on `main` with production skipped.

## Outcome

In progress.
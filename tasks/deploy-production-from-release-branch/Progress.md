# Progress

Updated: 2026-09-15

## Checklist

- [x] Confirm the current production gate and release-branch prerequisites.
- [x] Change workflow gating, regression coverage, and operator documentation.
- [x] Switch the protected environment policy and create `release` safely.
- [x] Verify `main` skips production and `release` deploys successfully.

## Current state

Production now deploys only from `release`. The policy commit passed validation
on `main` with production skipped, then the same exact commit was used to
create `release` and passed the full protected deployment. The `Production`
environment and branch protection both enforce the promotion boundary. The
task is complete and has moved to the repository archive; its publication
commit should validate on `main` with production skipped.

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
- Before cutover, the `Production` environment had one custom deployment branch
  policy named `main`; the repository had no rulesets.
- GitHub Actions run `34944321541` validated policy commit `bcac5fd` on `main`
  in 1m42s and skipped `Deploy production`.
- The `Production` environment custom branch policy was changed by deleting
  `main` before adding `release`, so there was no interval where both branches
  could read production credentials.
- Remote `release` was created at exact validated commit `bcac5fd` without
  rewriting ancestry. Classic branch protection requires strict `validate`
  status, pull requests, and resolved conversations; it applies to admins and
  disallows force pushes and deletion.
- GitHub Actions run `34944561197` passed on `release`: validation completed in
  1m59s and production in 1m20s. It deployed service version
  `79f2084a-8369-43b0-8033-04328bb25497`, product-site version
  `a83f0d56-15fc-48a0-a037-997c064a5539`, and documentation version
  `7e3e3ad7-b7cf-476a-a233-8082dbe59554`; canonical smoke, key cleanup, and
  every public-origin probe passed.
- Final remote reads show one `Production` branch policy named `release`, and
  `main` plus `release` both point to `bcac5fd` at initial cutover.

## Blockers

- None.

## Outcome

Completed. `main` remains the development branch and production deployment now
requires promotion to the protected `release` branch.
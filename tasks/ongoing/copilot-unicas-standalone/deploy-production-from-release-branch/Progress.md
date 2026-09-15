# Progress

Updated: 2026-09-15

## Checklist

- [x] Confirm the current production gate and release-branch prerequisites.
- [ ] Change workflow gating, regression coverage, and operator documentation.
- [ ] Switch the protected environment policy and create `release` safely.
- [ ] Verify `main` skips production and `release` deploys successfully.

## Current state

The task is claimed by `copilot-unicas-standalone`. Production currently gates
on `refs/heads/main`; all branches share one unprivileged validation job, and
no remote `release` branch or overlapping active task exists. The next action
is to publish this coordination claim before changing the workflow gate.

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

## Blockers

- The claim must be published before implementation. Under the current policy,
  that `main` coordination push will cause one final main-based production run.

## Outcome

In progress.
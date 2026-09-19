# Document worktree identity configuration

Created: 2026-09-15

## Goal

Define Git worktree configuration as the local pointer from a worktree to its
registered repository-task-ledger identity.

## Context

The shared skill reserves identity names with
`tasks/ongoing/<identity>/.gitkeep`, but it does not yet define how an agent
determines which registered identity belongs to its current worktree. Using an
application `.env` file would mix workflow metadata with runtime configuration
and could encourage agents to inspect secret-bearing files.

## Scope

- Store the current identity in the worktree-scoped Git key
  `task-ledger.identity`.
- Define initialization, lookup, validation, and failure behavior in the shared
  skill and adoption guide.
- Publish the shared skill update.
- Update UniCAS's installed skill, lock file, and local project profile.

## Out of scope

- Storing identity in application environment variables or `.env` files.
- Automatically choosing identities without checking the shared `main` branch.
- Turning identity registration into a distributed lock.

## Acceptance criteria

- [x] The shared skill distinguishes remote identity registration from the
  local worktree binding.
- [x] Initialization reserves `.gitkeep` on `main` before setting the local
  `task-ledger.identity` value.
- [x] Agents have deterministic commands to read and validate the binding.
- [x] Missing, invalid, or unregistered bindings stop task claims until fixed.
- [x] The shared skill update is published and restored into UniCAS.
- [x] UniCAS task validation passes with the updated skill and lock file.

## Constraints

- Preserve unrelated changes in the active terminology migration task.
- Keep identity values local to each worktree and out of committed runtime
  configuration.
- Continue treating claims as cooperative early-warning signals, not locks.

## References

- [Shared repository-task-ledger skill](https://github.com/shazhou-ww/skills/tree/main/skills/repository-task-ledger)
- [UniCAS task workflow](/README.md)
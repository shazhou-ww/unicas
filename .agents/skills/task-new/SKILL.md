---
name: task-new
description: "Register a repository implementation task only when the user explicitly invokes task-new. Ordinary requests remain task-free."
argument-hint: "[optional task context]"
user-invocable: true
---

# New Repository Task

Load `repoledger`, repository instructions, and the repository task
profile. If the core is unavailable, stop without changing task state.

1. Require explicit `task-new` invocation. Never invoke it because work looks
   large or long-running.
2. Resolve one accepted, testable outcome from the latest explicit direction.
3. Apply the core admission boundary: the outcome must be expected to change at
   least one path outside the configured task directory.
4. Run `repoledger task list` and inspect only plausible semantic overlaps. The
   CLI reports facts; the agent decides conceptual overlap with the user.
5. Plan scope and delivery review. Classify interface, business/data model, and
   architecture review for the actual outcome.
6. Prepare `<tasksDirectory>/<task-name>/Task.md` from the core template.
7. Run `repoledger task register <task-name>`. A new registration is complete
   only after repoledger creates an isolated commit containing the task
   directory and its corresponding status record, pushes that commit non-force
   to primary, refreshes primary, and verifies the published backlog record.
   Do not include unrelated caller-worktree changes or substitute a local-only
   commit for successful registration.

Do not create `Progress.md`, start the task, or implement it unless the user
also explicitly requests execution. Finish by reporting the canonical stable
path and published backlog state.

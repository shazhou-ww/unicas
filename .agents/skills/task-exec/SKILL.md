---
name: task-exec
description: "Start, resume, and finish one existing repository task from canonical primary-branch state."
argument-hint: "[attach Task.md or optionally name a task]"
user-invocable: true
---

# Execute Repository Task

Load `repoledger`, repository instructions, and the repository task
profile. If the core is unavailable, stop without changing task or
implementation files.

## Resolve One Task

1. Prefer one attached canonical `Task.md` as a locator, not a snapshot.
   Otherwise resolve one task from the supplied name or latest explicit context.
2. Run `repoledger task list`, `repoledger status <task-name>`, and
   `repoledger check <task-name> --remote`.
3. Read the latest stable `Task.md` and any existing `Progress.md` from primary.
4. Require one unambiguous task and owning repository. Ask the smallest
   clarification for no match, conflicting locators, or semantic overlap.
5. Route by state:
   - `backlog`: review overlap, then run `repoledger task start <task-name>`.
   - `ongoing`: fetch the advertised source repository and branch, then resume
     from that shared ref without silently changing its locator.
   - `completed` or `abandoned`: report the terminal outcome and stop.

There is no identity claim, takeover, handoff state, or archive move. The
ongoing source ref identifies resumable work but does not assign ownership or
replace primary as the authority for lifecycle state and accepted history.

## Execute

Follow the core lifecycle through source publication, implementation,
validation, human review, primary integration, and completion or abandonment.
Continue until the task is terminal or reaches a genuine external blocker.

Update `Progress.md` only in a commit that also changes a path outside the task
directory. Do not stop merely to create or publish procedural task metadata.
For a human review gate, publish the review artifact to primary, request an
explicit decision, and stop before protected implementation. Scope and
interface review requests must link the canonical `Task.md` so the user can
open it directly; do not ask the user to provide or repeat a commit ID. Bind
the decision to the refreshed authoritative revision internally. Final
delivery approval remains bound to the exact primary commit required by
`repoledger task complete --approved-commit`. Approval alone does not require a
follow-up commit.

Finish by reporting the task, lifecycle state, validation, and primary
publication state. When blocked without an implementation delta, report the
blocker directly instead of manufacturing a Progress update.

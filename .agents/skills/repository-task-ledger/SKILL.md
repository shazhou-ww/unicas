---
name: repository-task-ledger
description: "Authoritative lifecycle for user-invoked task-new and task-exec flows and existing repository tasks. Ordinary implementation requests remain task-free."
user-invocable: false
---

# Repository Task Ledger

Manage explicitly opted-in implementation work as stable repository state on a
shared primary branch. Repoledger validates and publishes lifecycle facts; it
does not decide intent, semantic overlap, human approval, or code correctness.

## Admit Work

- Create a task only after the user explicitly invokes `task-new`.
- Admit only an accepted outcome expected to change at least one tracked path
  outside the configured `tasksDirectory`. Source, tests, docs, configuration,
  workflows, scripts, instructions, and skills all count.
- Do not admit questions, read-only investigation, planning or review without
  implementation, validation-only work, external-only work, or changes confined
  to the task directory.
- Once registered, manage the task until it becomes `completed` or `abandoned`.

For cross-repository work, the repository owning the primary implementation
owns the source task. Create a linked task only when another repository owns an
independent implementation outcome.

## Prepare Task Work

1. Read repository instructions and the repository task profile.
2. Run `repoledger task list` to inventory current primary state and read only
   plausible overlaps.
3. Run `repoledger status <task-name>` and
   `repoledger check <task-name> --remote` before resuming one task.
4. Read its stable `Task.md` and any existing `Progress.md` from primary.
5. Preserve unrelated work and stop on semantic overlap or same-task conflicts.

The configured remote primary branch is authoritative. Task records never
encode a person, device, worktree, or source branch. Optional contributor
branches and pull requests are repository policy outside the ledger; accepted
work must return to primary.

## Create And Start

After `task-new` admission:

1. Prepare `<tasksDirectory>/<task-name>/Task.md` from the task template.
2. Run `repoledger task register <task-name>`. It snapshots that local task
   directory and publishes the backlog record and artifacts to primary.
3. Do not start or implement unless the user also requested execution.

When execution begins, run `repoledger task start <task-name>`. Repoledger
publishes `backlog -> ongoing` to primary. It does not create a task branch or
`Progress.md`.

## Work And Progress

`Task.md` is the durable outcome contract. `Progress.md` is an implementation
journal, not a transcript or a mirror of Git.

- Create or update `Progress.md` only in a publication that also creates,
  modifies, renames, or deletes at least one path outside `tasksDirectory`.
- In that same commit, record only outcome-relevant implementation changes,
  material decisions, validation, blockers, and the next action.
- Never create a standalone Progress commit for fetches, checks, pushes, commit
  hashes, reachability, status transitions, resumes, handoffs, review requests,
  approvals without implementation, or task-only document edits.
- Git already records exact commit identity, chronology, and publication.
- Publish validated implementation through the repository's normal non-force
  primary integration path. Never force-push or discard concurrent work.

If work becomes blocked and there is no implementation delta to publish, report
the blocker to the user without manufacturing a Progress update.

## Human Review

Every new task plans scope and delivery review. Interface, business/data model,
and architecture review apply when those surfaces change.

- A review request names an immutable commit reachable from primary.
- Task-only review artifacts may be published without editing `Progress.md`.
- Approval is an explicit human decision naming the reviewed commit; Git
  activity and silence are not approval.
- Approval alone does not create a metadata commit. If the decision materially
  affects later implementation, summarize it in the next implementation-linked
  Progress update.
- Reopen a checkpoint when later changes materially alter the reviewed result.

When installed, `ui-change-review` and `business-data-model-review` are
optional communication aids for their corresponding checkpoints. Their absence never blocks a checkpoint, and neither skill owns lifecycle state or approval.

Do not cross a protected implementation gate until its required decision is
explicit. Routine non-force publication needs no separate permission.

## Resume And Handoff

A receiving agent fetches primary, runs status and remote check, reads the
stable artifacts, and continues from primary. Handoff changes no lifecycle
field and does not update `Progress.md`. Concurrent publication is resolved by
normal non-force Git integration, never by silent overwrite.

## User Acceptance

Create `UserAcceptance.md` only when a criterion requires user-only access,
physical interaction, or subjective judgment that the agent cannot verify.
Publish it with an implementation delta. Record only the result the user
reports, and require explicit delivery approval separately unless one response
clearly supplies both decisions.

## Complete Or Abandon

To complete:

1. Finish acceptance criteria and agent-verifiable checks.
2. Publish the final implementation and its concise Progress update together.
3. Complete required manual acceptance.
4. Ask the user to approve the exact current primary commit for delivery.
5. Run `repoledger task complete <task-name> --approved-commit <commit>`.
   Repoledger requires that commit to equal fetched primary, publishes the
   completed record, and verifies it. Do not add a completion-only Progress
   commit.

To abandon, obtain an explicit human or accountable-owner decision and run
`repoledger task abandon <task-name>`. Existing findings remain in the latest
implementation-linked Progress entry. Do not create abandonment-only progress.

Terminal task directories remain at the same stable path. There is no archive
move, delete, rename, reopen, handoff, takeover, identity, or generic set-state
operation.

## Links And Layout

Use file-relative links for targets inside one task directory. Use the
repository profile's declared convention for targets elsewhere. Stable task
paths eliminate lifecycle link rewrites.

```text
repoledger.yaml
tasks/
|-- status.yaml
|-- <task-name>/
|   |-- Task.md
|   |-- Progress.md       # only after implementation publication
|   `-- UserAcceptance.md # only when required
`-- <another-task>/
    `-- Task.md
```

Run local `repoledger check` after task artifact changes and
`repoledger check --remote` for CI or shared-state validation. Follow the
[adoption guide](./references/adoption.md) for setup and legacy migration.

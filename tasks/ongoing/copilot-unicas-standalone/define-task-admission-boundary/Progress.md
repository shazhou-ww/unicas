# Progress

Updated: 2026-09-15

## Checklist

- [x] Confirm the completed identity-config task is already archived.
- [x] Remove untracked duplicate task artifacts from the old layout.
- [x] Define and claim the admission-boundary implementation task.
- [ ] Update and publish the shared skill and adoption guide.
- [ ] Restore the shared update into UniCAS and align project instructions.
- [ ] Add regression coverage and run validation.
- [ ] Archive the completed task.

## Current state

The worktree identity is valid and registered as
`copilot-unicas-standalone`. The prior worktree-identity task is completed and
already archived; byte-for-byte and superseded untracked copies from the old
ongoing layout were removed without changing archived history. This new task is
claimed because it will modify the shared skill and UniCAS files outside
`tasks/**`.

The next concrete action is to add the mechanical admission boundary to the
shared skill and adoption guide: create a task only when accepted work is
expected to edit a tracked file outside `tasks/**`.

## Decisions

- Complexity, duration, and skill usage alone do not admit work to the ledger.
- Read-only learning, investigation, planning, review, validation, answers, and
  changes confined to `tasks/**` do not create a new task.
- If task-free work later requires an edit outside `tasks/**`, stop and create
  or claim a task before that first edit.
- Files outside `tasks/**` include source, tests, docs, configuration,
  workflows, instructions, and skills.

## Validation

- The untracked identity-config `Task.md` matched the archived copy exactly by
  SHA-256; the flat migration `Progress.md` was a strict older subset of the
  claimed identity-lane record.
- `pnpm check:tasks` passed all 10 checks after removing both old-layout
  duplicate directories and creating the accepted backlog task.

## Blockers

- None.

## Outcome

In progress.
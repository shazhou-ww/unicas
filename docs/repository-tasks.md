# Repository tasks

This repository uses the installed
[`repoledger`](/.agents/skills/repoledger/SKILL.md) with
[`repoledger.yaml`](/repoledger.yaml) and [`tasks/status.yaml`](/tasks/status.yaml).
GitHub Issues remain the open intake surface; accepted implementation work is
registered in this repository only after an explicit `/repoledger new`
invocation.

## Skill installation

Shared skills are committed under `.agents/skills/`, and
[`skills-lock.json`](/skills-lock.json) records their GitHub source and content
hashes. Restore them after cloning with `npx skills experimental_install`.
Update them deliberately with:

```sh
npx skills update repoledger ui-change-review business-data-model-review publish --project --yes
```

The `repoledger` skill comes from `shazhou-ww/repoledger`; the other shared
skills continue to use their sources recorded in `skills-lock.json`. Repoledger
exposes one command namespace: `/repoledger new`, `/repoledger exec`,
`/repoledger status`, `/repoledger complete`, and `/repoledger abandon`.
The CLI is pinned to an immutable commit from that repository until its first
post-split npm version is published.

Review the resulting repository diff and run `pnpm check:tasks`. The `publish`
skill is explicit-invocation-only and remains unusable unless this repository
provides its required allowlist and protected trusted-publishing workflow.

## Layout and state

Every task has one stable directory and one canonical status record:

```text
tasks/
|-- status.yaml
|-- <task-name>/
|   |-- Task.md
|   |-- Progress.md       # after implementation publication
|   `-- UserAcceptance.md # only when required
`-- <another-task>/
    `-- Task.md
```

The allowed states are `backlog`, `ongoing`, `completed`, and `abandoned`.
Task paths never move when state changes. Task records do not contain an owner,
device, or worktree, and no identity lane or marker is used. An ongoing record
advertises the shared source branch where implementation can be resumed.

## Lifecycle

- Use `repoledger task list` to inventory canonical work and inspect plausible
  semantic overlap before registering or resuming a task.
- Prepare `tasks/<task-name>/Task.md`, then use `repoledger task register` to
  publish accepted backlog work.
- Use `repoledger task start` before implementation. It publishes the ongoing
  state and creates the shared source branch; planning and review alone leave
  the task in `backlog`.
- Create or update `Progress.md` only with a publication that also changes a
  path outside `tasks/`; do not create bookkeeping-only progress commits.
- Before completion, reconcile the task's acceptance criteria and Progress
  review/manual checklists with the evidence being approved. The completion
  command records lifecycle state but does not rewrite those artifacts.
- Use `repoledger task complete --approved-commit <commit>` only after delivery
  approval names the exact current primary commit. Use `task abandon` only
  after an explicit accountable decision.

Task-local links should be relative. Other repository-local task links use a
leading `/` from the repository root so stable task paths render consistently
on GitHub and in VS Code.

## Publication and validation

`origin/main` is the authoritative collaboration state. Integrate validated
implementation through the repository's normal non-force path; never force-push
or discard concurrent work.

Run `pnpm check:tasks` for worktree validation after changing task artifacts,
repository instructions, installed skills, or `skills-lock.json`. CI runs
`pnpm check:tasks:commit` for the checked-out commit, and main-branch CI also
runs `pnpm check:tasks --remote` against refreshed `origin/main` state.
Before resuming one task, run `repoledger status <task-name>` and
`repoledger check <task-name> --remote` as required by the installed skill.

## Documentation boundary

Keep task-specific plans, research, review artifacts, and current-state
captures in the task directory. Reserve `docs/` for accepted, stable
architecture, terminology, protocol, operations, and configuration consensus.
Never store credentials, tokens, private keys, or private customer data in
tasks or documentation.

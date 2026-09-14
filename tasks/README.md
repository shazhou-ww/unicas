# Repository tasks

This directory is the repository-owned task ledger. Task state travels with the
code and does not depend on a particular issue tracker or hosting platform.
Repository agents are required by [`AGENTS.md`](../AGENTS.md) to follow this
workflow for planned or multi-step work.

## Documentation boundary

Put task-specific plans, research, impact inventories, current-state captures,
and reference material inside the task folder. These files move with the task.

Use `docs/` only for accepted, stable project consensus: architecture,
terminology, protocols, operations, and current configuration. When a task
reaches a durable decision, extract that decision into `docs/` and link the
finalized document from `Task.md`; keep execution details and progress in the
task folder.

## Layout

```text
tasks/
├── backlog/
│   └── <task-name>/
│       ├── Task.md
│       └── <optional reference material>
├── ongoing/
│   └── <task-name>/
│       ├── Task.md
│       ├── Progress.md
│       └── <optional reference material>
└── archived/
    └── <task-name>/
        ├── Task.md
        ├── Progress.md
        └── <retained reference material>
```

Use the standard spelling `archived/`. Do not create a parallel
`archieved/` directory.

The parent directory is the single source of truth for status:

- `backlog`: accepted but not started;
- `ongoing`: actively being implemented or investigated;
- `archived`: completed or deliberately abandoned.

## Lifecycle

1. Create `tasks/backlog/<task-name>/Task.md` when a task is accepted.
2. Put task-specific source material in the same folder and link to it from
   `Task.md`. Prefer links to canonical repository docs over copied content.
3. Before implementation, move the whole folder with `git mv` from `backlog/`
   to `ongoing/` and create `Progress.md`.
4. Keep the `Progress.md` checklist current at meaningful checkpoints. Record
   decisions, validation evidence, blockers, and changed assumptions while they
   are fresh.
5. When work completes, record the final outcome and validation, then move the
   whole folder to `archived/`.
6. When work is abandoned, record why, what was learned, and any reusable
   follow-up before moving it to `archived/`.

Never copy a task between status directories. Preserve its history through
renames so Git can follow the task from backlog to archive.

## Naming

Use a short lowercase kebab-case folder name that describes the outcome:

```text
split-public-domain-topology
migrate-app-space-terminology
add-direct-r2-upload-credentials
```

Add a date prefix only when two tasks would otherwise have the same name.

## Task.md

Every task folder must contain `Task.md`. Use this shape:

```markdown
# Task title

Created: YYYY-MM-DD

## Goal

One testable outcome.

## Context

Why the task exists and the current behavior.

## Scope

- Included change.

## Out of scope

- Explicit non-goal.

## Acceptance criteria

- [ ] Observable completion condition.

## Constraints

- Compatibility, security, sequencing, and rollback constraints.

## References

- Canonical design: `<relative path to finalized document>`
```

Keep `Task.md` focused on the durable problem, scope, and acceptance criteria.
Do not turn it into a chronological work log.

## Progress.md

Create `Progress.md` only when moving a task to `ongoing/`. Use this shape:

```markdown
# Progress

Updated: YYYY-MM-DD

## Checklist

- [ ] Current work item.

## Current state

The latest verified state and the next concrete action.

## Decisions

- Decision and rationale.

## Validation

- Command or behavior checked, with its result.

## Blockers

- Blocker, owner, and required resolution; write `None` when clear.

## Outcome

Fill this in before archiving as `Completed` or `Abandoned`, with a concise
reason and any remaining follow-up.
```

Do not store secrets, authentication material, private customer data, or local
machine credentials in task files. Record secret names and provisioning
procedures, not values.

## Relationship to external trackers

GitHub issues or other trackers may link to these tasks, but they are not the
source of truth for repository work. Put durable scope, decisions, progress,
and validation here so they remain available after a hosting migration.
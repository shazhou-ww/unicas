# Project adoption

## Required project instruction

Installation makes this skill discoverable. A checked-in project instruction
must define when agents are required to load it. Adapt this example to the
repository:

```markdown
## Task workflow

For Issue triage and all planned or multi-step work, load and follow the
`repository-task-ledger` skill.

- Keep accepted work under `tasks/`.
- Before implementation, claim the task under
  `tasks/ongoing/<identity>/<task-name>/`.
- Keep `Progress.md` current and archive the task when work ends.
```

Keep repository-specific commands, boundaries, and exceptions in the project
instruction or `tasks/README.md`; do not fork the generic lifecycle without a
project need.

## Suggested validation invariants

Automated checks should verify at least:

- only `backlog`, `ongoing`, and `archived` are canonical status directories;
- task and identity names use the project's portable naming convention;
- every backlog and archived entry is a task directory;
- every non-hidden ongoing entry is an identity directory;
- every identity contains `.gitkeep`;
- every task contains `Task.md` with the required headings;
- backlog tasks do not contain `Progress.md`;
- ongoing and archived tasks contain `Progress.md`;
- archived progress records an outcome;
- local links in task artifacts resolve.

CI checks structure after the fact. They complement, but do not replace, the
early identity reservation and claim publication protocol.

## Migrating a flat ongoing directory

When a repository currently uses `tasks/ongoing/<task-name>`:

1. Choose and register an identity for each active worktree.
2. Identify the actual current actor for every active task; do not infer
   ownership from Git authorship alone.
3. Move each active folder to `tasks/ongoing/<identity>/<task-name>` with
   `git mv`.
4. Update project instructions, documentation, and validation in the same
   migration.
5. Publish the migration before accepting new claims under the revised layout.

Do not add an identity layer to `backlog` or `archived`; unclaimed and inactive
tasks have no current execution owner.
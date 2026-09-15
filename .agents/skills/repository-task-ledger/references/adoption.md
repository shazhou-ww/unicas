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
- Resolve the current identity from the worktree-scoped Git key
   `task-ledger.identity`; do not use `.env`.
- Before implementation, claim the task under
  `tasks/ongoing/<identity>/<task-name>/`.
- Keep `Progress.md` current and archive the task when work ends.
```

Keep repository-specific commands, boundaries, and exceptions in the project
instruction or `tasks/README.md`; do not fork the generic lifecycle without a
project need.

## Worktree identity setup

The committed identity lane and local binding answer different questions:

| Record | Scope | Meaning |
| --- | --- | --- |
| `tasks/ongoing/<identity>/.gitkeep` | Shared `main` history | This name is registered and reserved. |
| `task-ledger.identity` | Current Git worktree | This worktree uses that registered name. |

For an ordinary non-bare repository with no configured `core.worktree`, enable
worktree configuration once:

```sh
git config --local extensions.worktreeConfig true
```

Before enabling it in a nonstandard repository, inspect `core.worktree` and
`core.bare` and follow Git's documented migration requirements. Worktree config
is unsupported by older Git clients; all tools accessing the repository must
support the extension.

After a unique `.gitkeep` reservation has been pushed successfully to `main`,
bind the worktree:

```sh
git config --worktree task-ledger.identity <identity>
```

At the start of task work, agents must read and validate it:

```sh
git config --local --get extensions.worktreeConfig
git config --show-origin --show-scope --get task-ledger.identity
```

The extension must be enabled, the value must be lowercase kebab-case, the
origin must be worktree config, and the matching `.gitkeep` must exist on the
latest shared `main`. Stop task work until any missing or stale binding is
resolved. Do not guess from paths, branches, usernames, agent names, or visible
lanes.

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
early identity reservation and claim publication protocol. CI cannot validate a
developer's local `config.worktree`; agents and local tooling validate that at
the start of task work.

## Migrating a flat ongoing directory

When a repository currently uses `tasks/ongoing/<task-name>`:

1. Choose and register an identity for each active worktree.
2. Identify the actual current actor for every active task; do not infer
   ownership from Git authorship alone.
3. Move each active folder to `tasks/ongoing/<identity>/<task-name>` with
   `git mv`.
4. Update project instructions, documentation, and validation in the same
   migration.
5. Enable worktree config and bind each worktree to its registered identity.
6. Publish the migration before accepting new claims under the revised layout.

Do not add an identity layer to `backlog` or `archived`; unclaimed and inactive
tasks have no current execution owner.
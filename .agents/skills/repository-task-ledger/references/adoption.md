# Project adoption

## Install The Complete Skill Set

Install the protocol core and both intent-specific entry skills together:

```sh
npx skills add shazhou-ww/skills --skill repository-task-ledger --skill task-new --skill task-exec
```

Run the installation for each desired agent target, or select multiple targets
when the installer supports it. The three skills are independently discoverable
and installable artifacts, but `task-new` and `task-exec` are not supported as
standalone workflows: both must load `repository-task-ledger` before operating
on task state and must stop visibly when it is unavailable.

This composition is deliberately portable but model-mediated. The Agent Skills
specification does not define aliases, runtime-enforced dependencies, or a
universal slash-command interface. Clients that honor `user-invocable: false`
hide the core from their command menu while retaining model invocation; other
clients may show the core or expose all three skills through a different UI.
The stable contract is the skill name and instructions, not the presentation of
`/task-new` and `/task-exec`.

The entry skills are user-selected intent routers. Explicit invocation means
the user selects `task-new` through the client interface; clients may represent
that action as `/task-new`, a menu entry, or another user-facing mechanism.
An agent must not invoke it because an ordinary request appears complex. Keep
the checked-in project instruction below so this opt-in boundary is consistent
and every selected task flow still loads the authoritative core.

## Install The Deterministic Validator

Pin the companion CLI in each adopting repository instead of resolving
`latest` during CI:

```sh
pnpm add --save-dev repoledger@0.6.0
```

Track this `repoledger.json` at the repository root, adapting the task
directory when necessary:

```json
{
   "$schema": "./node_modules/repoledger/schema/v1.json",
   "tasksDirectory": "tasks"
}
```

The pinned package supplies the schema locally for offline editor validation;
its canonical `$id` links to the versioned schema on GitHub and is the
configuration contract. `repoledger check` validates backlog plus the effective
global or worktree identity's ongoing lane without fetching or inspecting
history. If no identity is configured, ongoing tasks are skipped. CI or an
explicit audit uses `repoledger check --all-identities --archived`.

Run `repoledger doctor` before task work. It validates the effective global or
worktree identity and its local lane, then runs the same local repository
checks. Refresh the shared branch separately before publication.

Use `repoledger status` to inventory current task positions, and use
`repoledger check --task <task-name>` when focused task diagnostics are useful.
For a new repository, `repoledger init` previews canonical configuration,
layout, and optional identity setup; add `--apply` only after reviewing that
plan.

The CLI never decides admission, ownership consent, acceptance, completion, or
abandonment. Explicit `init --apply` and `task ... --apply` operations may
modify local task files or worktree Git configuration after preflight. They
never fetch, inspect history, stage, commit, push, merge, force-update, or
publish those changes. Keep the skill installed and required by project
instructions.

## Admission boundary

New task intake is opt-in. Only the user's explicit invocation of `task-new`
authorizes an agent to evaluate and create a task. Ordinary implementation
requests remain task-free regardless of size, duration, number of steps, or
expected paths. An agent may recommend `task-new` when durable coordination
would help, but the recommendation is not authorization and must not block
ordinary work.

After explicit opt-in, use the repository boundary as an eligibility filter:
create a task in the repository that owns the outcome only when that outcome
adds, modifies, renames, or deletes at least one file outside that same
repository's own `tasks/**`. This includes source, tests, docs, configuration,
workflows, scripts, instructions, and skills.

Do not create a task merely because work is lengthy or multi-step. Learning
the skill, answering questions, read-only investigation or review, running
validation, external-only operations, and changes confined to `tasks/**` do
not create a new task. If task-free work later reveals a required edit outside
`tasks/**`, continue task-free unless the user explicitly invokes `task-new`.

The opt-in and repository boundaries control admission, not the lifecycle of
an existing task. Keep an admitted task current through read-only phases until
completion, abandonment, or handoff.

### Cross-repository ownership

After explicit opt-in for cross-repository work, apply admission to each
independently owned implementation outcome, not to every checkout touched
while delivering one outcome:

- The repository that owns the primary design and implementation owns the
   source task.
- A generated artifact, installed copy, lockfile refresh, or equivalent
   downstream update that mechanically consumes the source change remains part
   of the source task. Reference that task when practical; do not mirror it.
- Downstream-specific design, adaptation, tests, configuration, or other
   independently maintained changes outside that downstream repository's own
   `tasks/**` require a task there before implementation.
- When multiple repositories independently own implementation, create linked
   tasks in those repositories instead of copying one task between them.

## Required project instruction

Installation makes this skill discoverable. A checked-in project instruction
must define when agents are required to load it. Adapt this example to the
repository:

```markdown
## Task workflow

Load and follow the `repository-task-ledger` skill only when the user explicitly
invokes `task-new`, invokes `task-exec`, or asks to manage an existing task.
Ordinary implementation requests remain task-free regardless of their size,
duration, or expected files.

- Never create a task automatically. An agent may recommend `task-new` for
   durable coordination, but must wait for explicit user opt-in.
- After `task-new` is invoked, admit only accepted implementation work that
   changes files outside this repository's own `tasks/**`.
- Once a task exists, keep managing it until completion, abandonment, or an
   explicit handoff.
- Resolve the current identity from the effective global or worktree Git key
   `task-ledger.identity`; do not use `.env`.
- Treat accepted task work as authorization for routine non-force commits and
   publication; do not ask for confirmation solely to commit, push, or
   integrate a lifecycle milestone.
- Publish the claim before substantive implementation, commit and publish
   meaningful validated checkpoints, and publish implementation completion
   while the task remains ongoing.
- Plan scope, interface, business and data model, architecture, and delivery
   checkpoints in `Task.md`. Publish each applicable review artifact and obtain,
   record, and publish explicit human approval before crossing its gate.
- When manual user acceptance is required, publish a standalone
   `UserAcceptance.md` guide with the implementation and keep the task ongoing
   until the user reports the documented test result.
- After all acceptance and explicit delivery approval pass, archive and publish
   the task as a separate final integration. A completed task has at least
   claim, implementation-complete, and archive integrations on the shared
   primary branch.
```

Keep repository-specific commands, boundaries, and exceptions in the project
instruction or `tasks/README.md`; do not fork the generic lifecycle without a
project need.

The project profile must name the shared remote and primary branch, such as
`origin/main` or `origin/master`, and state whether the normal integration path
is direct push, merge, or pull request. It must also identify any required
review or approval that prevents autonomous completion. Do not leave agents to
guess whether a local commit, side-branch push, or unmerged request counts as
published; only history reachable from the refreshed remote primary branch
satisfies a publication milestone.

## Link Task References

Task artifacts move between directories with different depths. A link to a
target stored inside the same task directory must be relative to the linking
file, such as `./Progress.md` or `./UserAcceptance.md`. Because the source and
target move together, this form remains valid across lifecycle moves and in
standard Markdown renderers.

For repository-local targets outside the task directory, prefer
`/path/from/repository/root` when the supported renderer resolves a leading `/`
from the repository or workspace root. GitHub does this for repository
Markdown, and VS Code does it when the repository root is the workspace root.
This is renderer behavior, not standard Markdown.

When another renderer lacks repository-root behavior, links to targets outside
the task directory must also be file-relative and may need updates when a task
moves. External URI references and fragment-only links remain unchanged. The
validator rejects repository-root links back into the current task directory,
resolves both allowed local forms without a project link-policy setting, and
does not interpret external URIs as repository paths.

## Identity setup

The identity lane and Git configuration answer different questions:

| Record | Scope | Meaning |
| --- | --- | --- |
| `tasks/ongoing/<identity>/.gitkeep` | Repository files | Defines the local identity lane. |
| `task-ledger.identity` | Global Git config | Provides the default identity across repositories and worktrees. |
| `task-ledger.identity` | Worktree Git config | Overrides the global identity for one worktree. |

When one identity is normally used on a device, configure it globally:

```sh
git config --global task-ledger.identity <identity>
```

Git resolves a worktree value after the global value, so an explicit worktree
binding wins when both exist. Do not store identity in `.env` or tracked files.

Prefer the preview-first initializer when creating an identity lane or a
worktree override:

```sh
repoledger init --identity <identity>
repoledger init --identity <identity> --apply
```

Review the preview before apply. The initializer scaffolds missing canonical
directories and creates the selected identity lane. It does not read or modify
Git configuration. The surrounding workflow decides when to commit and publish
repository files; the CLI never does so itself.

To use a worktree-specific identity, configure the override through Git's
documented worktree configuration mechanism. Repoledger does not manage or
validate that mechanism; it reads only the effective result:

```sh
git config --worktree task-ledger.identity <identity>
```

### Multiple Worktrees On One Device

Worktrees that use the global identity need no additional binding. Initialize a
worktree independently with `repoledger init --identity` only when it needs a
different identity. Without the CLI, configure that override manually:

```sh
git config --worktree task-ledger.identity <identity>
```

At the start of task work, run `repoledger doctor`. It validates identity
syntax, its global or worktree scope, and the local lane. Only when the CLI is
unavailable, inspect the effective value manually:

```sh
git config --get task-ledger.identity
git config --show-origin --show-scope --get task-ledger.identity
```

The value must be lowercase kebab-case, its scope must be global or worktree,
and the matching `.gitkeep` must exist on the local filesystem. Stop task work
until any missing configuration is resolved. Do not guess from paths, branches,
usernames, agent names, or visible lanes.

## Fallback validation invariants

`repoledger check` is the canonical implementation of these invariants. Do not
reimplement or repeat them with ad hoc commands when it is available. A
repository that cannot use the CLI needs an equivalent validator over backlog
and the current identity's ongoing lane. Archived tasks and other identities
enter the scope only when explicitly requested. Within that scope, cover at
least:

- only `backlog`, `ongoing`, and `archived` are canonical status directories;
- task and identity names use the project's portable naming convention;
- every selected backlog or archived entry is a task directory;
- every selected ongoing identity is a directory containing `.gitkeep`;
- every non-hidden entry below a selected identity is a task directory;
- every task-position directory is treated as a task even when it is empty and
   contains `Task.md` with the required headings;
- every backlog and ongoing task plans scope, interface, business and data
   model, architecture, and delivery review checkpoints;
- backlog tasks do not contain `Progress.md`;
- ongoing and archived tasks contain `Progress.md`;
- progress for a task with a review plan records all five human approval states
   consistently with that plan, including dated evidence for approvals;
- archived progress records an outcome;
- unresolved human approval is reported as a warning rather than invalidating
   the local task structure;
- progress records claim, implementation-complete, and archive publication
   milestones;
- any `UserAcceptance.md` contains a test target, prerequisites, numbered
   steps, matching expected results, reporting instructions, and actual status;
- targets inside the current task directory use file-relative links;
- repository-root and ordinary relative local links to other targets resolve,
  while external URI and fragment-only references remain external.

Link checks use the configured repository root. After separating any fragment
from the path, resolve a target beginning with one `/` from that root. Resolve
every ordinary relative target from the directory containing the task
artifact. Reject a leading `/` when its resolved target is inside the current
task directory. Skip absolute and protocol-relative external URLs, non-file
URI schemes, and fragment-only targets. A leading `/` must not silently use the
process working directory or filesystem root.

CI checks structure after the fact, typically with
`repoledger check --all-identities --archived`. It complements, but does not
replace, the claim publication protocol. CI cannot validate a developer's local
`config.worktree`; agents and local tooling validate that at the start of task
work.

When adopting this checkpoint format, update backlog and ongoing tasks before
their next substantive work. Preserve archived task history unless another
change already requires editing that task.

## Migrating a flat ongoing directory

When a repository currently uses `tasks/ongoing/<task-name>`:

1. Choose and register an identity for each active worktree.
2. Identify the actual current actor for every active task; do not infer
   ownership from Git authorship alone.
3. Move each active folder to `tasks/ongoing/<identity>/<task-name>` with
   `git mv`.
4. Verify each destination contains all task artifacts and each source task
   directory no longer exists. Remove an empty source directory, but stop and
   reconcile unexpected contents instead of deleting recursively.
5. Update project instructions, documentation, and validation in the same
   migration.
6. Enable worktree config and bind each worktree to its registered identity.
7. Publish the migration before accepting new claims under the revised layout.

Do not add an identity layer to `backlog` or `archived`; unclaimed and inactive
tasks have no current execution owner.

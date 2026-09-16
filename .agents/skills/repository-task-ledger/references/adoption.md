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
pnpm add --save-dev repoledger@0.1.0
```

Track this `repoledger.json` at the repository root, adapting only the task
directory and shared remote branch when necessary:

```json
{
   "$schema": "./node_modules/repoledger/schema/v1.json",
   "tasksDirectory": "tasks",
   "remote": "origin",
   "branch": "main"
}
```

The pinned package supplies the schema locally for offline editor validation;
its canonical `$id` links to the versioned schema on GitHub and is the
configuration contract. `repoledger check` validates the repository without
fetching or reading a developer identity; because publication is part of the
protocol, it fails rather than claiming a complete result when Git history is
shallow, unavailable, or missing the configured remote ref. CI must check out
full history.

Run `repoledger doctor` before task work. It refreshes the configured branch,
validates `extensions.worktreeConfig`, the authoritative worktree binding, the
optional device-default boundary, and remote identity registration, then runs
the same repository checks. `--offline` is diagnostic only and does not meet
the latest-remote prerequisite.

The CLI never decides admission, ownership, acceptance, handoff, completion,
or abandonment, and it never mutates task files, Git configuration, commits,
or branches. Keep the skill installed and required by project instructions.

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
- Resolve the current identity from the worktree-scoped Git key
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


## Worktree identity setup

Repository registration, worktree binding, and an optional device suggestion
answer different questions:

| Record | Scope | Meaning |
| --- | --- | --- |
| `tasks/ongoing/<identity>/.gitkeep` | Shared primary branch history | This name is registered and reserved. |
| `task-ledger.identity` | Current Git worktree | Authoritatively binds this worktree to that registered name. |
| `task-ledger.defaultIdentity` | Device-global Git config | Optionally suggests a candidate during initialization only. |

When one identity is commonly used across repositories on a device, configure
the machine-local suggestion with:

```sh
git config --global task-ledger.defaultIdentity <identity>
```

Do not track this value in a repository. It does not reserve the name, bind a
worktree, or provide a fallback when a worktree binding is missing.

For an ordinary non-bare repository with no configured `core.worktree`, enable
worktree configuration once:

```sh
git config --local extensions.worktreeConfig true
```

Before enabling it in a nonstandard repository, inspect `core.worktree` and
`core.bare` and follow Git's documented migration requirements. Worktree config
is unsupported by older Git clients; all tools accessing the repository must
support the extension.

During initialization, an explicit identity choice may override the suggestion.
Otherwise, read the suggestion only as a candidate:

```sh
git config --global --get task-ledger.defaultIdentity
```

Validate the candidate as lowercase kebab-case, fetch the shared primary
branch, and inspect the repository's identity lanes. Deliberately confirm a
matching registration, or publish a clean `.gitkeep` reservation when it is
absent. A matching global value must not trigger an automatic binding.

After the existing or new registration has been confirmed on the shared
primary branch, bind the worktree explicitly:

```sh
git config --worktree task-ledger.identity <identity>
```

### Multiple Worktrees On One Device

Initialize each worktree independently. A primary worktree may explicitly bind
the identity suggested by the device default. For an additional worktree, first
validate or publish a different repository registration when the team requires
distinct ownership, then run this command inside that worktree:

```sh
git config --worktree task-ledger.identity <registered-override>
```

That explicit value overrides the device suggestion for the current worktree.
Leave `task-ledger.defaultIdentity` unchanged unless the device's usual identity
has changed; an override for one worktree is not a reason to rewrite it.

At the start of task work, agents must read and validate it:

```sh
git config --local --get extensions.worktreeConfig
git config --show-origin --show-scope --get task-ledger.identity
```

The extension must be enabled, the value must be lowercase kebab-case, the
origin must be worktree config, and the matching `.gitkeep` must exist on the
latest shared primary branch. Stop task work until any missing or stale binding
is resolved. Do not guess from paths, branches, usernames, agent names, or
visible lanes, and do not substitute the device default.

## Suggested validation invariants

Automated checks should verify at least:

- only `backlog`, `ongoing`, and `archived` are canonical status directories;
- task and identity names use the project's portable naming convention;
- every non-hidden backlog and archived entry is a task directory;
- every non-hidden ongoing entry is an identity directory;
- every identity contains `.gitkeep`;
- every non-hidden entry below an identity is a task directory;
- every task-position directory is treated as a task even when it is empty and
   contains `Task.md` with the required headings;
- every backlog and ongoing task plans scope, interface, business and data
   model, architecture, and delivery review checkpoints;
- no task name appears in more than one backlog, ongoing identity, or archived
   position;
- backlog tasks do not contain `Progress.md`;
- ongoing and archived tasks contain `Progress.md`;
- progress for a task with a review plan records all five human approval states
   consistently with that plan, including dated evidence for approvals;
- archived progress records an outcome;
- a completed archive with a review plan has approved scope and delivery
   checkpoints, with every conditional checkpoint approved or not applicable;
- progress records claim, implementation-complete, and archive publication
   milestones;
- a completed task's history contains at least three distinct integrations on
   the shared primary branch for those milestones;
- any `UserAcceptance.md` contains a test target, prerequisites, numbered
   steps, matching expected results, reporting instructions, and actual status;
- targets inside the current task directory use file-relative links;
- repository-root and ordinary relative local links to other targets resolve,
  while external URI and fragment-only references remain external.

Link checks must first determine the Git repository root, for example with
`git rev-parse --show-toplevel`. After separating any fragment from the path,
resolve a target beginning with one `/` from that repository root. Resolve
every ordinary relative target from the directory containing the task
artifact. Reject a leading `/` when its resolved target is inside the current
task directory. Skip absolute and protocol-relative external URLs, non-file
URI schemes, and fragment-only targets. A leading `/` must not silently use the
process working directory or filesystem root.

CI checks structure after the fact. They complement, but do not replace, the
early identity reservation and claim publication protocol. CI cannot validate a
developer's local `config.worktree`; agents and local tooling validate that at
the start of task work.

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
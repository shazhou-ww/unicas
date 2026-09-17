# Repository tasks

This directory is UniCAS's repository-owned task ledger. GitHub Issues remain
the open intake surface for bugs and requests, including contributions from
people without repository write access. A triage acceptance turns that input
into a task here; rejected, duplicate, and unconfirmed requests remain Issues.

The shared
[`repository-task-ledger` skill](../.agents/skills/repository-task-ledger/SKILL.md)
defines the lifecycle used by people and agents. [`AGENTS.md`](../AGENTS.md)
requires that skill for Issue triage and planned or multi-step work. This file
contains only the UniCAS project profile.

## Skill installation

The installed shared skills are committed under `.agents/skills/`, and
[`skills-lock.json`](../skills-lock.json) records their GitHub source and content
hashes. Restore them after cloning with `npx skills experimental_install`.
Update them deliberately with
`npx skills update repository-task-ledger task-new task-exec ui-change-review business-data-model-review --project --yes`,
then review and validate the resulting repository diff. The first three skills
provide the task workflow; the two review skills are optional communication
aids for interface and business data model checkpoints.

## Layout

```text
tasks/
├── backlog/
│   └── <task-name>/
│       ├── Task.md
│       └── <optional reference material>
├── ongoing/
│   └── <identity>/
│       ├── .gitkeep
│       └── <task-name>/
│           ├── Task.md
│           ├── Progress.md
│           └── <optional reference material>
└── archived/
    └── <task-name>/
        ├── Task.md
        ├── Progress.md
        └── <retained reference material>
```

Use the standard spelling `archived/`. Do not create a parallel
`archieved/` directory.

The first directory below `tasks/` is the single source of truth for status:

- `backlog`: accepted but not started;
- `ongoing`: actively being implemented or investigated;
- `archived`: completed or deliberately abandoned.

Within `ongoing`, the identity directory records the active claim. An identity
may represent a person, agent, team, or another actor chosen under the team's
convention.

## Identity coordination

- Each worktree should normally use one stable identity.
- The local pointer is the worktree-scoped Git key `task-ledger.identity`; do
  not store it in `.env` or ordinary repository-local Git config.
- The optional device-global `task-ledger.defaultIdentity` may suggest an
  identity during setup. It never replaces the explicit worktree binding.
- Before task work, require `extensions.worktreeConfig=true`, read the identity
  with `git config --worktree --get task-ledger.identity`, and verify its lane
  exists on `origin/main`. Do not infer a missing value.
- Identity and task names use lowercase kebab-case.
- Before choosing a new identity, fetch and inspect identity names already on
  `origin/main`.
- Reserve a new name by adding `tasks/ongoing/<identity>/.gitkeep` in its own
  commit and pushing that commit directly to `main`. Never force through a
  competing reservation.
- After that push succeeds, bind the current worktree with
  `git config --worktree task-ledger.identity <identity>`. Follow the shared
  skill's `core.worktree` and `core.bare` safety checks before first enabling
  `extensions.worktreeConfig` in a repository.
- To reuse the setup suggestion on this device, set it separately with
  `git config --global task-ledger.defaultIdentity <identity>`.
- Publish task claims to the shared `main` history before substantial
  implementation. All worktree branches ultimately integrate into `main`.
- Keep `.gitkeep` after the lane becomes empty so the identity name remains
  reserved.

This is a cooperative early-warning protocol, not an absolute lock. Its value
comes from making work intent visible before participants invest heavily.

## Task files

Start task files from the skill's
[`Task.md`](../.agents/skills/repository-task-ledger/assets/Task.md) and
[`Progress.md`](../.agents/skills/repository-task-ledger/assets/Progress.md)
templates. Use a short lowercase kebab-case task name that describes the
outcome. Add a date prefix only to disambiguate otherwise identical names.

Keep `Task.md` focused on the durable goal, scope, acceptance criteria,
constraints, and references. Create `Progress.md` only when work is claimed;
keep its current state, next action, decisions, validation, blockers, and final
outcome current.

## Task links

Task artifacts are rendered on GitHub and in VS Code with the repository root
as the workspace root. Both resolve a leading `/` from that root, so new or
edited backlog and ongoing task artifacts use `/path/from/repository/root` for
repository-local references. These links remain stable when a task moves among
backlog, identity-scoped ongoing, and archived locations.

Leave external URLs and fragment-only links unchanged. Link checks resolve
leading `/` targets from the Git repository root and ordinary relative targets
from the directory containing the Markdown file. Do not rewrite archived task
history solely to change its link style.

## Documentation boundary

Put task-specific plans, research, impact inventories, current-state captures,
and reference material inside the task folder so they move with the task.

Use `docs/` only for accepted, stable project consensus: architecture,
terminology, protocols, operations, and current configuration. Extract durable
decisions there and link them from `Task.md`; leave execution history in the
task folder. Never store secrets, authentication material, private customer
data, or local machine credentials in either location.

## Validation

Run `pnpm check:tasks` after changing task files, repository instructions, the
installed skill, or `skills-lock.json`. It runs the pinned `repoledger check`
for reusable ledger validation, then focused UniCAS policy tests. The root
`repoledger.json` references the schema shipped by the pinned package; that
schema's versioned GitHub `$id` is the configuration contract.

Before claiming or resuming task work, run `pnpm exec repoledger doctor`
locally to fetch the collaboration branch and validate the actual
worktree-scoped identity and its remote lane. Do not run `doctor` in CI; CI
remains identity-independent and uses `pnpm check:tasks`.

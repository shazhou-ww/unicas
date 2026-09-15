---
name: repository-task-ledger
description: 'Use when triaging accepted Issues or starting, resuming, handing off, completing, or abandoning planned or multi-step repository work. Maintains repository-owned tasks, per-worktree identities, visible claims, progress, decisions, validation, and archives while keeping Issues as the intake surface.'
user-invocable: true
---

# Repository Task Ledger

Manage accepted work as versioned repository content so its state and context
can move across devices, people, agents, worktrees, and hosting platforms.

This workflow is a coordination protocol, not a distributed lock. Its purpose
is to make intent and overlap visible early enough to avoid wasted work when
participants follow the same convention.

## Start With Local Policy

1. Read the repository's agent instructions and `tasks/README.md`, if present.
2. Treat project-specific rules as authoritative where they refine this skill.
3. Resolve and validate the current worktree identity as described below.
4. Inspect `tasks/backlog/` and every identity below `tasks/ongoing/` before
   creating or claiming related work.
5. Preserve unrelated worktree changes. Never move, rewrite, or archive another
   identity's task merely to clear a conflict.

## Separate Intake From Execution

Keep Issues or another external tracker as the open intake surface. People who
cannot modify the repository must still be able to report bugs and request
work.

Create a repository task only after triage accepts the work:

1. Create `tasks/backlog/<task-name>/Task.md` from
   [the task template](./assets/Task.md).
2. Rewrite the accepted outcome, boundaries, constraints, and observable
   acceptance criteria; do not merely copy the Issue conversation.
3. Link the Issue and task in both directions when the tracker permits it.
4. Leave rejected, duplicate, or still-unconfirmed requests outside the task
   ledger.

One Issue may produce several tasks, and several Issues may be consolidated
into one task.

## Establish A Worktree Identity

Each worktree should normally use one stable identity. An identity may name a
person, an agent, a team, or another actor chosen under the team's convention.
The workflow does not require identities to represent humans.

Identity uses two records with different scopes:

- `tasks/ongoing/<identity>/.gitkeep` on the shared `main` branch registers and
  reserves the identity for collaboration.
- `task-ledger.identity` in Git's worktree-scoped config identifies which
  registered identity the current worktree uses.

Do not store the local binding in `.env`, an environment variable, a tracked
file, or ordinary repository-local Git config. Application environment files
have the wrong ownership and may contain secrets; ordinary local Git config is
shared by linked worktrees.

### Resolve An Existing Binding

Before task work, run:

```sh
git config --local --get extensions.worktreeConfig
git config --worktree --get task-ledger.identity
```

The first command must return `true`. The second must return one lowercase
kebab-case identity. Fetch the shared `main` branch and verify that
`tasks/ongoing/<identity>/.gitkeep` exists there. If the extension, value, or
remote registration is missing or invalid, stop before claiming or resuming a
task. Do not infer the identity from the worktree path, branch name, operating
system user, agent name, or the only visible identity lane.

To inspect where Git read the value from, use:

```sh
git config --show-origin --show-scope --get task-ledger.identity
```

It must report worktree-scoped configuration. A new clone or worktree must
establish its own binding; the value intentionally does not travel with Git
history.

### Initialize A New Binding

Before using a new identity:

1. Inspect `core.worktree` and `core.bare` before enabling worktree config:

   ```sh
   git config --local --get core.worktree
   git config --local --type=bool --get core.bare
   ```

   For an ordinary non-bare repository, `core.worktree` is absent and
   `core.bare` is absent or `false`. If `core.worktree` is present or
   `core.bare` is `true`, stop and follow Git's `extensions.worktreeConfig`
   migration requirements before continuing.
2. Enable worktree-specific configuration once for the repository:

   ```sh
   git config --local extensions.worktreeConfig true
   ```

3. Fetch the shared `main` branch and inspect the identity directories already
   present under `tasks/ongoing/` on that branch.
4. Choose a short lowercase kebab-case name that is not already registered.
5. Add `tasks/ongoing/<identity>/.gitkeep` in a clean coordination change.
6. Commit only that reservation and push it directly to `main` before using the
   identity for work.
7. If the push is rejected or the name appeared after the fetch, do not force
   the push. Fetch again, choose another identity, and retry.
8. Only after the reservation succeeds, bind the current worktree and verify
   the value and its origin:

   ```sh
   git config --worktree task-ledger.identity <identity>
   git config --show-origin --show-scope --get task-ledger.identity
   ```

The `.gitkeep` preserves the identity lane when it has no active task and
reserves the name against accidental reuse. Keep the identity stable for the
life of the worktree unless the team deliberately transfers it.

## Claim Accepted Work

Before substantive implementation:

1. Refresh the shared `main` state.
2. Recheck the backlog, active claims, and nearby affected areas for overlap.
3. Move the whole task folder with Git history preserved:

   ```sh
   git mv tasks/backlog/<task-name> tasks/ongoing/<identity>/<task-name>
   ```

4. Create `Progress.md` from [the progress template](./assets/Progress.md).
5. Record the current state and the next concrete action.
6. Commit and publish the claim through the team's normal `main` integration
   path before investing in substantial implementation.

The task must exist in exactly one status location. Never copy it between
status or identity directories.

## Work And Record Progress

- Keep `Task.md` focused on the durable problem, scope, constraints, and
  acceptance criteria. Do not use it as a chronological log.
- Update `Progress.md` at meaningful checkpoints with the checklist, latest
  verified state, next action, decisions, validation evidence, and blockers.
- Before pausing, make the next action specific enough that another actor can
  resume without reconstructing the session.
- Keep task-specific research, inventories, plans, and captures in the task
  folder so they move with it.
- Put only accepted, stable project consensus in `docs/`; link extracted
  documents from `Task.md`.
- Never store credentials, tokens, private keys, private customer data, or
  machine-local secrets in task artifacts.

## Handle Overlap And Races

An identity lane and a task claim advertise intent; they do not guarantee
mutual exclusion.

When another claim or overlapping code area appears:

1. Stop before expanding the implementation.
2. Refresh `main` and compare the two tasks' goals, scope, and current state.
3. Coordinate ownership, collaboration, splitting, or sequencing explicitly.
4. Record the resolution and changed assumptions in the affected
   `Progress.md` files.
5. Preserve both actors' work until the owners agree on consolidation.

Early visibility and small coordination commits are the conflict-avoidance
mechanism. Do not claim that this workflow provides an absolute lock.

## Handoff

Before handing work to another identity:

1. Update the checklist, current verified state, decisions, validation,
   blockers, and next concrete action.
2. Ensure the destination identity is already registered on `main`.
3. Move the whole task folder to `tasks/ongoing/<new-identity>/<task-name>`.
4. Commit and publish the handoff before either identity continues.

## Complete Or Abandon Work

1. Check every acceptance criterion and run the narrowest required validation.
2. Record the result and validation evidence in `Progress.md`.
3. Set the outcome to `Completed` or `Abandoned`; for abandonment, preserve the
   reason, useful findings, and follow-up.
4. Move the task to `tasks/archived/<task-name>` and publish the move.

Archived tasks do not retain an identity layer because they no longer have an
active owner. The Git history preserves prior claims and handoffs.

## Canonical Layout

```text
tasks/
├── backlog/
│   └── <task-name>/
│       └── Task.md
├── ongoing/
│   └── <identity>/
│       ├── .gitkeep
│       └── <task-name>/
│           ├── Task.md
│           └── Progress.md
└── archived/
    └── <task-name>/
        ├── Task.md
        └── Progress.md
```

For project setup, instruction wording, validation invariants, and migration
from a flat `ongoing/`, follow [the adoption guide](./references/adoption.md).
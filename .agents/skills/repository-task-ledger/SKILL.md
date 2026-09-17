---
name: repository-task-ledger
description: "Authoritative lifecycle for user-invoked task-new and task-exec flows and existing repository tasks. Ordinary implementation requests remain task-free."
user-invocable: false
---

# Repository Task Ledger

Manage explicitly opted-in implementation work as versioned repository state
that can move across devices, people, agents, and worktrees. This is a
coordination protocol, not a distributed lock.

## Admit Work

- Create a new task only after the user invokes `task-new`. Ordinary requests
  remain task-free regardless of size, duration, or changed paths. An agent may
  suggest `task-new`, but must not invoke it or make it a prerequisite.
- After opt-in, admit only accepted outcomes that will change at least one file
  outside the owning repository's `tasks/**`. Source, tests, docs, config,
  workflows, scripts, instructions, skills, and new tracked files all count.
- Do not admit read-only work, planning, review, validation-only work,
  external-only operations, or task-ledger maintenance.
- Once a task exists, manage it until completion, abandonment, or explicit
  handoff. The opt-in rule does not release existing ownership.

For cross-repository work, the repository owning the primary design and
implementation owns the source task. Generated files, installed copies, and
lockfile refreshes remain part of that task. Create linked tasks only where
another repository owns independent design, adaptation, tests, or config;
never copy one task between repositories.

## Prepare Task Work

1. Read the repository's agent instructions and `tasks/README.md`; local policy
   may refine this skill.
2. Run `repoledger doctor` before claiming or resuming when the repository has
   adopted the CLI. It refreshes the shared branch and validates full history,
   repository state, and the worktree identity; `--offline` is insufficient.
3. Use `repoledger status` as the deterministic task-position inventory, then
   read only the relevant backlog and ongoing definitions needed to judge
   semantic overlap and ownership. `status` does not establish readiness or
   decide overlap.
4. Preserve unrelated changes and never move another identity's task to clear
   a conflict.

The authoritative identity is the lowercase kebab-case value of
`task-ledger.identity` in worktree-scoped Git config. It requires
`extensions.worktreeConfig=true` and a matching
`tasks/ongoing/<identity>/.gitkeep` on the refreshed shared primary branch.
Never infer it or fall back to `task-ledger.defaultIdentity`; that global value
is only an initialization suggestion. If setup is missing, follow the
[adoption guide](./references/adoption.md) before task work.

Run `repoledger check --task <task-name>` after changing one task and
`repoledger check` for repository-wide changes and CI. Focused checks still
enforce global configuration, layout, identity-lane, and duplicate-position
safety. The CLI validates facts but never decides admission, semantic overlap,
ownership consent, acceptance, or lifecycle state. Explicit `init --apply` and
`task ... --apply` operations may perform a prevalidated local mutation, but
never stage, commit, push, merge, or publish it. Without the CLI, apply the
fallback checks and moves below.

## Publish Milestones

The repository profile names the shared remote, primary branch, and normal
direct-push, merge, or pull-request path. Accepted task work authorizes routine
non-force commits and publication through that path; do not ask permission
solely for those steps.

Before each publication, refresh the remote, reconcile concurrent work without
discarding it, run focused checks, publish, and verify the commit is reachable
from the refreshed remote primary branch. Local commits, side branches, and
unmerged pull requests are not published milestones.

Record `Published` and concise human-readable evidence in the milestone commit
itself, then verify publication from Git history. Never copy commit hashes into
task artifacts; repository history is the source of truth for exact commit
identity and reachability.

Authentication, branch protection, required review, failed validation, push
rejection, and conflicts remain real blockers. Never force-push around them.
Record the blocker and exact next action in `Progress.md`, then ask only for the
required user action.

Every completed task has at least three distinct integrations:

1. **Claim:** task moved to the current identity before implementation.
2. **Implementation complete:** implementation and evidence published while
   the task is still ongoing.
3. **Archive:** completed task moved to `tasks/archived/` as a separate final
   integration.

Never combine claim with implementation completion or implementation
completion with archive publication.

## Create And Claim

After `task-new` intake and admission:

1. Create `tasks/backlog/<task-name>/Task.md` from the
   [task template](./assets/Task.md). Record the accepted goal, scope,
   constraints, observable acceptance criteria, and task-specific human review
   plan rather than a transcript. Task creation plans approval gates; it does
   not satisfy them.
2. Keep Issues or another external tracker available for open intake and link
   it bidirectionally when possible.
3. After `doctor`, use `status` and the relevant task definitions to recheck
   semantic overlap and ownership.
4. Preview `repoledger task claim <task-name> --update-all-refs`, review its
   exact source, destination, reference edits, and blockers, then rerun it with
   `--apply`. A successful apply moves the complete directory, rewrites the
   affected links, verifies the mechanical postconditions, and generates the
   initial `Progress.md` without inventing approvals or publication evidence.
5. Review and complete the generated current state and next action. If the CLI
   is unavailable, use `git mv`, the [progress template](./assets/Progress.md),
   and the manual checks in [Verify Every Move](#verify-every-move).
6. Mark the claim milestone `Published` with concise evidence in the claim
   commit, publish it, and verify the claim before substantive implementation.

## Work And Coordinate

- Keep `Task.md` durable; put chronology, current state, decisions, validation,
   human approval evidence, blockers, checklist state, and the next concrete
   action in `Progress.md`.
- Publish meaningful validated checkpoints with current progress evidence. Do
   not publish known-broken work merely to create a checkpoint.
- Keep task-specific research with the task. Put only stable project consensus
   in `docs/`.
- Never store credentials, tokens, private keys, private customer data, or
   machine-local secrets in task artifacts.

A claim advertises intent but is not a lock. If another task overlaps, stop
before expanding the implementation, refresh the shared branch, compare scope
and state, coordinate ownership or sequencing, record the resolution, and
preserve both actors' work.

## Pass Human Review Checkpoints

Every new task plans five checkpoint categories in `Task.md`. Scope alignment
and delivery acceptance are required for completed work. Interface, business
and data model, and architecture checkpoints are required when the task affects
those surfaces; otherwise record a reason they do not apply or the concrete
trigger that will decide during execution. The middle checkpoints may be
reordered to follow task dependencies.

Before resuming a backlog or ongoing task that predates this plan, add and
publish its task-specific checkpoints without claiming that prior discussion
was approval. Do not retrofit archived task history solely for this change.

The checkpoints cover:

1. **Scope alignment:** goal, included and excluded work, constraints, and
   acceptance criteria before substantive implementation.
2. **Interface alignment:** affected GUI flows, CLI commands, MCP tools, or API
   contracts, including compatibility, before implementing that interface.
3. **Business and data model alignment:** concepts, rules, entities,
   relationships, schemas, and migration impact before implementing those
   model or data changes.
4. **Architecture alignment:** affected modules, responsibilities, boundaries,
   dependencies, and any split or combination before structural implementation.
5. **Delivery acceptance:** the published implementation, validation evidence,
   and any manual test result before marking the task completed and archiving
   it.

Keep human review artifacts decision-first and concise: show material changes,
governing reasons, risks, and the requested decision without repeating task
history or embedding exhaustive implementation evidence. When installed,
`ui-change-review` and `business-data-model-review` are optional communication
aids for the corresponding artifacts. Their absence never blocks a checkpoint,
and neither skill owns task state, publication, or approval.

Claim publication and research needed to prepare a review artifact may happen
before approval. At each applicable gate:

1. Prepare the concrete review artifact and summarize it in `Progress.md`, with
   a durable link when available.
2. Publish the artifact and pending gate state to the shared primary branch.
3. Ask the named human reviewer for an explicit decision and stop before the
   work that the gate protects.
4. Record the actual decision, reviewer, date, and concise evidence in
   `Progress.md`; publish that approval before continuing through the gate.

Do not infer approval from task creation, a `task-exec` invocation, silence,
routine Git authorization, or an earlier approval of a materially different
plan. Resolve every `Assess during execution` row before its trigger is crossed.
If implementation changes invalidate an approved artifact or introduce a
previously excluded surface, reopen the affected checkpoint, publish that
state, and obtain fresh approval. An abandoned task may archive with unresolved
checkpoints when `Progress.md` records the reason; do not label it completed.

## Verify Every Move

For a move applied by `repoledger task ... --apply`, require `applied: true`
with no blockers and resolve any recovery or cleanup diagnostic before further
task work. The CLI snapshots every source artifact, confines paths and links,
performs the move and requested reference rewrites transactionally, and verifies
the destination, absent source, preserved identity marker, and unique task
position. Without `--update-all-refs`, it leaves references unchanged and emits
warnings that must be resolved manually. Do not repeat the other mechanical
checks with ad hoc commands.

For a manual move when the CLI is unavailable:

1. Verify the destination contains every artifact.
2. Verify the source task directory is gone. Remove it only when empty; stop if
    unexpected files remain.
3. Count non-hidden task directories across backlog, every ongoing identity,
    and archive, including empty directories. The task must appear exactly once.

Never copy tasks between positions. Preserve existing `.gitkeep` markers in
ongoing identity directories; do not add identity markers to backlog, archived,
or task directories.

## Run User Acceptance

Create a manual acceptance procedure only when a criterion depends on user
operation, user-only access, physical interaction, or another result the agent
cannot verify. This procedure tests the delivered behavior; it is distinct
from the required human delivery-acceptance decision. Do not invent manual test
steps for criteria the agent can verify.

When required, create `UserAcceptance.md` from the
[template](./assets/UserAcceptance.md) with exact prerequisites, numbered
actions, expected results, and an unambiguous reporting method. Publish it with
implementation completion and keep the task ongoing. Record only the result
the user reports. On failure, record the observation, fix and republish, then
repeat acceptance. On success, record the test result and continue to the
delivery checkpoint without requesting routine Git confirmation. A single user
response may satisfy both the manual test result and delivery approval only
when it explicitly states both decisions; record them separately.

## Handoff

Coordinate the ownership transfer explicitly and update `Progress.md` before
moving the task. The receiving worktree previews and applies the move with:

```sh
repoledger task claim <task-name> --take-from <source-identity> --update-all-refs
repoledger task claim <task-name> --take-from <source-identity> --update-all-refs --apply
```

Review the planned source, destination, and reference edits before apply. The
named source is an expected-owner guard: if ownership changed, stop and
coordinate again rather than following the task automatically. A successful
apply satisfies the mechanical move checks, but does not establish consent
merely because it was invoked. Publish the transfer before either identity
continues. Without the CLI, verify the destination identity, move the whole
task manually, and apply the fallback checks above.

## Complete Or Abandon

To complete:

1. Finish all agent-verifiable criteria, run focused validation, and update
   `Task.md` and `Progress.md` with actual results.
2. Mark implementation completion `Published` with concise evidence in the
   implementation-completion commit while the task remains ongoing, publish
   it, and verify it on the refreshed remote branch.
3. Complete any required manual user acceptance.
4. Present the delivery checkpoint, obtain explicit human approval, record and
   publish it, and mark `Completed` only after every required criterion and
   review checkpoint passes.
5. After recording the outcome and delivery approval, preview
   `repoledger task archive <task-name> --update-all-refs`, review its exact
   move and reference edits, then rerun it with `--apply`. In the archived
   `Progress.md`, mark the archive action and milestone `Published` in the
   resulting final integration; commit, publish, and verify it separately.
   Without the CLI, move the whole task manually and apply the fallback checks
   above.

To abandon, record the reason, useful findings, validation state, and follow-up
in `Progress.md`; set `Abandoned`, archive, and publish. Do not claim
implementation completion for unfinished work.

Archived tasks have no identity layer; Git history preserves prior ownership.

## Link Task Artifacts

Use a file-relative link for every target stored inside the current task
directory, such as `./Progress.md` or `./UserAcceptance.md`. The task directory
moves as a unit, so these links remain valid across lifecycle moves regardless
of renderer behavior.

For repository-local targets outside the task directory, use
`/path/from/repository/root` only when the repository profile declares that all
supported renderers resolve it. Otherwise use portable file-relative links and
let `repoledger task ... --update-all-refs --apply` update move-sensitive
inbound and outbound references. Without `--update-all-refs`, the move still
applies but all affected references remain unchanged and are reported as
warnings for manual repair. Preserve external and fragment-only links, and
never couple local links to a machine path, repository owner, remote, or branch.

## Canonical Layout

```text
tasks/
|-- backlog/
|   `-- <task-name>/
|       `-- Task.md
|-- ongoing/
|   `-- <identity>/
|       |-- .gitkeep
|       `-- <task-name>/
|           |-- Task.md
|           |-- Progress.md
|           `-- UserAcceptance.md  # only when manual acceptance is required
`-- archived/
   `-- <task-name>/
      |-- Task.md
      |-- Progress.md
      `-- UserAcceptance.md      # preserved when one was required
```

For project setup, instruction wording, validation invariants, and migration
from a flat `ongoing/`, follow [the adoption guide](./references/adoption.md).
# Repository task-ledger adoption

## New repositories

Install repoledger and run:

```sh
repoledger init --remote origin --primary-branch main
```

The command publishes `repoledger.yaml` and an empty `tasks/status.yaml` to the
existing remote primary branch. It refuses existing or partial ledgers.

Add repository instructions that:

- require explicit `task-new` invocation for intake;
- admit only outcomes expected to change a path outside `tasksDirectory`;
- name the repository task profile;
- authorize routine non-force publication to primary;
- require `repoledger check --remote` in CI; and
- prohibit standalone `Progress.md` bookkeeping commits.

No Git identity, worktree lane, task branch, `.gitkeep`, or archive directory is
required.

## Storage contract

```yaml
# repoledger.yaml
version: 1
tasksDirectory: tasks
remote: origin
primaryBranch: main
```

```yaml
# tasks/status.yaml
version: 1
tasks:
  example-task:
    state: ongoing
    createdAt: "2026-09-19T10:00:00Z"
    updatedAt: "2026-09-19T10:01:00Z"
```

Each record key has exactly one matching stable task directory. Only repoledger
writes lifecycle records and timestamps.

## Legacy migration

Migration is a coordinated repository change, not a public command.

1. Refresh primary and require the legacy ledger to pass its complete checks.
2. Inventory backlog, every identity-scoped ongoing lane, and archived tasks;
   stop on duplicate names or unknown outcomes.
3. Move every complete task directory to `<tasksDirectory>/<task-name>`.
4. Map backlog and ongoing locations directly. Map archived tasks to
   `completed` or `abandoned` from their unambiguous Progress outcome.
5. Derive `createdAt` from the first primary commit introducing `Task.md`. Use
   one UTC second as `updatedAt` for all first-written canonical records.
6. Rewrite only move-sensitive repository-local links. Task-local links remain
   relative and move with their directory.
7. Replace legacy configuration with `repoledger.yaml`, create sorted
   `status.yaml`, and remove identity markers and empty status directories.
8. Update skills, repository instructions, CI, package docs, and tests.
9. Run local and remote checks, publish without force, fetch, and verify every
   task and record from primary.

After migration, corrections are forward commits. Never rewrite published
history or preserve identity/move commands as a permanent compatibility layer.

## Progress history policy

After migration, every primary commit that creates or edits a task
`Progress.md` must also change at least one tracked path outside
`tasksDirectory`. Review artifacts, status transitions, checks, approvals,
resumes, and handoffs do not justify progress-only commits.

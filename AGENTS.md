# UniCAS agent instructions

## Task workflow

Load and follow the
[`repoledger` skill](.agents/skills/repoledger/SKILL.md)
only when the user invokes `task-new`, invokes `task-exec`, or asks to manage
an existing repository task. Then apply the UniCAS-specific profile in
[`docs/repository-tasks.md`](docs/repository-tasks.md). Ordinary implementation
requests remain task-free.

- Treat `origin/main` as the authoritative task state. Run
  `pnpm exec repoledger task list`, `pnpm exec repoledger status <task-name>`,
  and `pnpm exec repoledger check <task-name> --remote` as directed by the
  skill before task work.
- Keep every task at the stable path `tasks/<task-name>/`; lifecycle state is
  recorded only in `tasks/status.yaml`.
- Register accepted new tasks with `repoledger task register` and start
  implementation with `repoledger task start`. Do not manually edit lifecycle
  records or create identity lanes.
- Create or update `Progress.md` only in a commit that also changes at least one
  path outside `tasks/`. Keep it concise and outcome-focused.
- Use the normal non-force integration path to publish implementation to
  `main`. Never treat a branch, worktree, person, or device as task ownership.
- Complete or abandon work only through the corresponding repoledger command
  after the skill's review and acceptance requirements are satisfied.

## Documentation boundary

- Keep task-specific plans, research, impact inventories, and current-state
  captures inside the task folder so they move with the task.
- Reserve `docs/` for accepted, stable architecture, terminology, protocol,
  operations, and configuration consensus.
- Extract durable decisions from a task into `docs/`; do not move its work log
  or unfinished plan there.
- Never place credentials, tokens, private keys, or private customer data in
  tasks, docs, examples, logs, or commits.

## Repository boundaries

- Read [`packages/README.md`](packages/README.md) before changing package
  ownership or dependencies.
- Preserve the separation between administrator and data access planes and do
  not introduce runtime dependencies on `@unidocs/*`.
- Treat `unicas.shazhou.work` and its Cloudflare resources as a frozen legacy
  environment unless a task explicitly says otherwise.
- Use `pnpm deploy:plan` or direct Wrangler `--dry-run` for deployment review.
  `pnpm deploy` intentionally refuses implicit production deployment.

## Validation

- `pnpm check:tasks` runs the pinned local `repoledger check`; CI adds
  `--remote` to validate canonical `origin/main` state.
- Use `pnpm exec repoledger task list`, `status`, and focused `check` commands
  for task readiness. Repoledger 0.7 has no identity or `doctor` workflow.
- Run the narrowest relevant executable test after implementation edits.
- Before completing a task, run the validation required by its acceptance
  criteria and publish the final implementation-linked `Progress.md` update.

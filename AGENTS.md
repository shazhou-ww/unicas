# UniCAS agent instructions

## Task workflow

For planned or multi-step work, follow [`tasks/README.md`](tasks/README.md).

- Inspect `tasks/ongoing/` and `tasks/backlog/` before creating related work.
- Create accepted new work under `tasks/backlog/<task-name>/Task.md`.
- Planning and review alone do not start implementation; leave the task in
  `backlog/` until implementation begins.
- Before the first implementation edit, move the whole task folder with
  `git mv` to `tasks/ongoing/` and create `Progress.md`.
- Keep the `Progress.md` checklist, current state, decisions, validation, and
  blockers current after meaningful milestones.
- Before finishing or pausing a session, leave the next concrete action in
  `Progress.md` so another agent can resume without reconstructing context.
- On completion or abandonment, record the outcome and move the whole folder
  to `tasks/archived/`.
- Treat the parent directory as the only task status. Never copy one task into
  multiple status directories.

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

- Run `pnpm check:tasks` after changing task files or repository instructions.
- Run the narrowest relevant executable test after implementation edits.
- Before archiving a completed task, run the validation required by its
  acceptance criteria and record the results in `Progress.md`.
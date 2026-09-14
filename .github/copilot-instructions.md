# Repository workflow

For planned or multi-step repository work, follow the task workflow in
[`tasks/README.md`](../tasks/README.md).

- Check `tasks/ongoing/` and `tasks/backlog/` before starting related work.
- Create new tasks under `tasks/backlog/<task-name>/Task.md`.
- Move a task to `tasks/ongoing/` before implementation and maintain its
  `Progress.md` checklist as work proceeds.
- Move completed or abandoned work to `tasks/archived/`, preserving its task,
  progress, decisions, references, and final outcome.
- Treat the parent directory as the task status; do not maintain a conflicting
  status field elsewhere.
- Never place credentials, tokens, private keys, or private customer data in a
  task file or attached reference.
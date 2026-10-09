# UniCAS agent instructions

## Guidance routing

- Treat [`.agents/`](.agents/README.md) as the only supported canonical root
  for Agent skills and reusable instructions. Do not add or require
  provider-specific projections.
- Before changing any file under `packages/**` or `stacks/unicas/**`, load and
  follow the
  [`unicas-package-boundaries` skill](.agents/skills/unicas-package-boundaries/SKILL.md).

## Idea workflow

Load and follow the
[`silvermoon` skill](.agents/skills/silvermoon/SKILL.md)
when the user invokes `/silvermoon`, explicitly asks to create an idea, or asks
to continue an existing Silvermoon idea. Apply the UniCAS-specific profile in
[`docs/repository-ideas.md`](docs/repository-ideas.md). Ordinary implementation
requests remain idea-free unless the user opts into this lifecycle.

- Use `pnpm exec silvermoon create-idea --audience agent` only for explicit
  creation requests. Use
  `pnpm exec silvermoon whats-next [idea] --audience agent` for navigation and
  continuation.
- Treat the configured primary repository and branch as authoritative. Preserve
  unknown work and follow the command's ordered synchronization instructions.
- Keep every idea in the fixed `.silvermoon/ideas/<ULID>/` layout. Use a unique
  alias for human navigation without changing its ULID identity.
- Record human approval and acceptance only for the exact current world
  revision after an explicit decision. Ledger checkboxes record Agent work,
  never approval or acceptance.
- Use normal non-force publication. Never force-push, reset shared history, or
  infer lifecycle decisions from Git activity.

## Documentation boundary

- Keep idea-specific plans, research, impact inventories, and current-state
  captures inside the appropriate Silvermoon world so they move with the idea.
- Reserve `docs/` for accepted, stable architecture, terminology, protocol,
  operations, and configuration consensus.
- Extract durable decisions from an idea into `docs/`; do not move its ledger
  or unfinished plan there.
- Never place credentials, tokens, private keys, or private customer data in
  ideas, docs, examples, logs, or commits.

## Repository boundaries

- Treat `unicas.shazhou.work` and its Cloudflare resources as a frozen legacy
  environment unless a task explicitly says otherwise.
- Use `pnpm deploy:plan` or direct Wrangler `--dry-run` for deployment review.
  `pnpm deploy` intentionally refuses implicit production deployment.

## Validation

- `pnpm check:ideas` validates the worktree. `pnpm check:ideas:commit` validates
  checked-out history. After synchronizing a candidate to primary, run
  `pnpm check:ideas:remote` explicitly; ordinary `main` pushes do not start
  hosted validation.
- Use `pnpm exec silvermoon whats-next [idea] --audience agent` for readiness
  and `pnpm exec silvermoon check --staged --audience agent` for an index
  candidate.
- Run the narrowest relevant executable test after implementation edits.
- Before requesting acceptance, run the validation required by the current
  world contract and update the matching ledger entries.

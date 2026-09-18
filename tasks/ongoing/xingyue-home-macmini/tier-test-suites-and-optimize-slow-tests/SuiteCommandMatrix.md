# Interface review — test-suite command matrix

Status: Pending human approval

## Decision requested

Approve the suite names, developer scenarios, inclusion boundaries, backward
compatibility for `pnpm test`, and CI mapping below. Approval permits
implementing developer-facing root/package scripts and CI command usage that
match this matrix. It does not authorize structural orchestration changes
covered by `./Architecture.md`, and it does not mark delivery acceptance.

## Current developer-facing commands (as-is)

| Command | What it runs today |
| --- | --- |
| `pnpm test` | `pnpm check:repo && pnpm -r test` |
| `pnpm check:repo` | `pnpm check:tasks` plus root Vitest files `tests/deploy-plan.test.mjs`, `tests/docs-site.test.mjs`, `tests/workspace-boundaries.test.mjs`, `tests/openapi-drift.test.ts` |
| `pnpm check:workspace` | Root Vitest: workspace-boundaries + deploy-plan |
| `pnpm check:openapi` | Root Vitest: openapi-drift |
| `pnpm check:tasks` | `repoledger check` |
| `pnpm -r test` / `pnpm --filter <pkg> test` | Each package's single unfiltered `vitest run` (service-cloudflare prefixes `node scripts/build-ui-assets.mjs` and uses `--testTimeout=15000`) |
| CI `validate` job | Separate steps: `check:workspace`, `check:openapi`, `check:tasks`, `build`, `docs:build`, `typecheck`, `pnpm -r test`, plus Wrangler dry-runs — not a single `pnpm test` |

Packages with a `test` script today: `admin-cli`, `admin-client`, `admin-protocol`,
`admin-webui`, `codec`, `control-auth`, `service`, `service-cloudflare`,
`tenant-blob-client`, `tenant-browser-cache`, `tenant-client`, `tenant-file-client`,
`tenant-protocol`.

## Proposed suite matrix

| Suite id | Scenario | Exact intended command (after implementation) | Inclusion | Exclusion |
| --- | --- | --- | --- | --- |
| `exhaustive` | Canonical gate before merge/release confidence | Keep `pnpm test` as `pnpm check:repo && pnpm -r test` (or an equivalent named alias that runs the same two steps) | Every check and package test covered by today's `pnpm check:repo` plus `pnpm -r test` | Deploy smoke, production deploy, and interactive `pnpm dev` |
| `repo-static` | Repo policy / docs / OpenAPI / task-ledger without package Vitest | `pnpm check:repo` | Current `check:repo` contents only | Package `test` scripts |
| `package-unit` | Single-package local loop | `pnpm --filter <pkg> test` (existing) | That package's Vitest suite only | Other packages; root `check:repo` |
| `changed-surface` | Common local-dev faster subset | New named root script (exact filters TBD after baseline + Architecture approval) | Strict subset of `exhaustive`: at least one materially faster path under the same measurement method | Must not drop assertions; must not become the CI sole gate |
| `ci-validate` | GitHub Actions validate composition | Documented composition of named suites / existing check scripts | Must preserve today's check coverage without needless duplicate suite runs | Production deploy job |

## Backward compatibility

- Preserve `pnpm test` behavior as the exhaustive gate, or obtain a fresh
  Interface decision before any incompatible change.
- Existing `pnpm check:*` and per-package `test` scripts remain valid entry
  points; new tier names are additive unless this review is amended.
- Commands must remain cross-platform for supported Windows local use and
  Linux CI (pnpm scripts / Node; no bash-only root scripts).

## CI mapping (proposed)

| CI step today | Proposed named suite / composition |
| --- | --- |
| `pnpm check:workspace` | Part of `repo-static` or retained explicit check script |
| `pnpm check:openapi` | Part of `repo-static` or retained explicit check script |
| `pnpm check:tasks` | Part of `repo-static` or retained explicit check script |
| `pnpm -r test` | Package half of `exhaustive` (or `ci-validate` package leg) |
| Build / typecheck / docs / wrangler dry-run | Remain adjacent CI steps; not renamed into Vitest tiers by this task unless Architecture says otherwise |

CI must not drop checks and must not needlessly execute the same suite twice
after the matrix is wired.

## Open items deferred to Architecture / baseline

- Exact filter list for `changed-surface` (packages/files).
- Whether service-cloudflare's `build-ui-assets` stays inside `test` or is
  split as shared setup under Architecture approval.
- Whether CI collapses `check:workspace` / `check:openapi` / `check:tasks`
  into one `check:repo` invocation (coverage-preserving composition only).

## Required interface validation (after approval + implementation)

- Documented suite matrix matches runnable scripts.
- `exhaustive` still covers today's `check:repo` + `-r test` paths.
- At least one local-dev tier is a strict, meaningfully faster subset under the
  task's measurement method.
- CI uses approved names/composition without dropped checks or duplicate runs.
- `pnpm test` compatibility rule above holds.

## References

- [Task](./Task.md)
- [Architecture](./Architecture.md)
- [Root scripts](/package.json)
- [CI workflow](/.github/workflows/ci.yml)
- [service-cloudflare package scripts](/packages/service-cloudflare/package.json)

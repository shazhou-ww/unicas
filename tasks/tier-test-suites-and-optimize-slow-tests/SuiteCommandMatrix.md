# Interface review — test-suite command matrix

Status: Approved and implemented

## Decision

The user delegated all task review decisions on 2026-09-19. The additive suite
names, inclusion boundaries, `pnpm test` compatibility, and CI mapping below
are approved and implemented.

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

## Suite matrix

| Suite id | Scenario | Exact intended command (after implementation) | Inclusion | Exclusion |
| --- | --- | --- | --- | --- |
| `exhaustive` | Canonical gate before merge/release confidence | `pnpm test` or `pnpm test:exhaustive` | Every check and package test covered by `pnpm check:repo` plus `pnpm test:packages` | Deploy smoke, production deploy, and interactive `pnpm dev` |
| `repo-static` | Repo policy / docs / OpenAPI / task-ledger without package Vitest | `pnpm check:repo` | Current `check:repo` contents only | Package `test` scripts |
| `package-unit` | Single-package local loop | `pnpm --filter <pkg> test` (existing) | That package's Vitest suite only | Other packages; root `check:repo` |
| `package-all` | Run package tests without repository checks | `pnpm test:packages` | Every package `test` script | Root `check:repo` |
| `changed-surface` | Common local-dev faster subset for changes outside the Cloudflare adapter | `pnpm test:quick` | `check:repo` and every package test except `@unicas/service-cloudflare` | Cloudflare adapter/integration tests; it is not the pre-merge gate |
| `ci-validate` | GitHub Actions validate composition | `pnpm test:exhaustive` | The canonical exhaustive gate once, followed by build, docs, typecheck, and deployment dry-runs | Production deploy job |

## Backward compatibility

- Preserve `pnpm test` behavior as the exhaustive gate, or obtain a fresh
  Interface decision before any incompatible change.
- Existing `pnpm check:*` and per-package `test` scripts remain valid entry
  points; new tier names are additive unless this review is amended.
- Commands must remain cross-platform for supported Windows local use and
  Linux CI (pnpm scripts / Node; no bash-only root scripts).

## CI mapping

| CI step today | Proposed named suite / composition |
| --- | --- |
| `pnpm check:workspace` | Covered by `pnpm test:exhaustive` through `check:repo` |
| `pnpm check:openapi` | Covered by `pnpm test:exhaustive` through `check:repo` |
| `pnpm check:tasks` | Covered locally by `pnpm test:exhaustive`; the main-branch remote check remains separate |
| `pnpm -r test` | Covered by `pnpm test:exhaustive` through `test:packages` |
| Build / typecheck / docs / wrangler dry-run | Remain adjacent CI steps; not renamed into Vitest tiers by this task unless Architecture says otherwise |

CI must not drop checks and must not needlessly execute the same suite twice
after the matrix is wired.

## Baseline decisions

- `changed-surface` excludes only `@unicas/service-cloudflare`, the measured
  dominant package, and retains root checks plus all other package tests.
- `service-cloudflare` keeps `build-ui-assets` inside its `test` script because
  measured setup is only 0.045-0.051 seconds.
- CI calls `test:exhaustive` once instead of separately invoking its component
  checks and package tests.

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

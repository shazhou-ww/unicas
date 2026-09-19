# Baseline timing

Status: Baseline and optimized suite measurements recorded

## Purpose

Hold the repeatable environment, method, command inventory, and comparable
timings required by this task. Optimization before/after rows and bottleneck
dispositions land here after Interface and Architecture approval unlock
structural work; initial capture may proceed as research without changing
repository scripts.

## Environment

- Windows 10 Pro, version 2009, build 26200, 64-bit
- Intel Core i9-14900KF, 24 cores / 32 logical processors
- Node.js 24.12.0; pnpm 11.24.0
- 2026-09-19, UTC+08:00
- Dependencies were already installed (warm install)

## Method

1. One discarded warm-up per timed command when practical.
2. At least two measured wall-clock runs; record both; do not treat one run as proof.
3. Prefer `/usr/bin/time -p` or an equivalent portable timer around the exact
   pnpm/Node command under test.
4. Attribute setup separately from Vitest when a command prefixes setup (notably
   `packages/service-cloudflare/scripts/build-ui-assets.mjs`).
5. Optional file/case detail: Vitest `--reporter=json --outputFile=<path>` via
   one-off CLI; do not permanently edit scripts solely for measurement.
6. Same method for before/after comparisons.

## Command inventory to time

| Command | Notes |
| --- | --- |
| `pnpm check:repo` | Root half of exhaustive |
| `pnpm -r test` or per-package `pnpm --filter <pkg> test` | Package half; prefer per-package rows for bottleneck location |
| `node packages/service-cloudflare/scripts/build-ui-assets.mjs` | Setup cost alone |
| `@unicas/service-cloudflare` full `test` script | Setup + Vitest |
| Other packages with `test` | `admin-*`, `codec`, `control-auth`, `service`, `tenant-*` |

## Results

PowerShell `Stopwatch` preserved subprocess output for measured package runs.
One warm-up was discarded where practical; measured rows are successful runs.

| Command | Warm-up | Measured run 1 | Measured run 2 | Result |
| --- | ---: | ---: | ---: | --- |
| `pnpm check:repo` | 2.543s | 2.446s | 2.479s | Passed |
| `pnpm -r test` | 57.627s | 58.223s | 58.846s | Passed |
| `node packages/service-cloudflare/scripts/build-ui-assets.mjs` | 0.052s | 0.051s | 0.045s | Passed |
| `pnpm test:quick` | filter verification run | 15.607s | 15.637s | Passed |
| `pnpm test:exhaustive` | component commands already warm | 60.727s | 61.187s | Passed |

The exact exhaustive command took 60.727-61.187s versus 15.607-15.637s for
`test:quick`, a reduction of about 74% for the supported
non-Cloudflare-adapter local scenario.

Structured Vitest profiling identified these dominant
`@unicas/service-cloudflare` files:

| Test file | Duration |
| --- | ---: |
| `control-plane-mcp-server.test.ts` | 50.319s |
| `account-repository.test.ts` | 45.529s |
| `do.test.ts` | 27.844s |
| `root-refs.test.ts` | 21.461s |
| `account-link-bff.test.ts` | 20.819s |

The slowest individual cases were the account-link BFF flow (20.819s), two MCP
flows (11.014s and 9.464s), and the people repository flow (8.301s).

## Bottleneck dispositions

- `@unicas/service-cloudflare` dominates exhaustive package wall time (about
   53 seconds of a 58-second package leg). It remains in the exhaustive gate and
   is excluded only from `test:quick`.
- UI asset generation is not material at 0.045-0.051 seconds, so it remains in
   the package test entry point.
- A test-only probe batched control-schema SQL for the 20.8-second account-link
   case. The case still took 20.23 seconds versus 20.28 seconds after rollback;
   the probe was rejected and no production migration or test assertion changed.
- The remaining cost is operation-heavy Miniflare/D1 integration coverage. No
   simple optimization was retained because fixture sharing or alternate storage
   would risk isolation or fidelity without evidence of a safe equivalent.

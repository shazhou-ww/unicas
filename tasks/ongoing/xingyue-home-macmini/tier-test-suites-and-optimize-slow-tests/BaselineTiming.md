# Baseline timing

Status: Method defined; measured results not yet recorded

## Purpose

Hold the repeatable environment, method, command inventory, and comparable
timings required by this task. Optimization before/after rows and bottleneck
dispositions land here after Interface and Architecture approval unlock
structural work; initial capture may proceed as research without changing
repository scripts.

## Environment

Not yet recorded. Capture at measurement time:

- OS / kernel (`uname -a` or Windows equivalent)
- `node -v`, `pnpm -v`
- CPU count
- date and timezone
- note whether dependencies were already installed (warm install)

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

No wall-clock measurements are recorded in this artifact yet. Do not invent
timings. Next measurement session should append environment, run table, and
slowest-file extracts under this heading.

## Bottleneck dispositions

Pending baseline rows.

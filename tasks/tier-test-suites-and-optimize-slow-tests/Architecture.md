# Architecture review — test orchestration design

Status: Approved and implemented

## Decision

The user delegated all task review decisions on 2026-09-19. The responsibility
split, measurement method, and isolation rules below are approved. Baseline
evidence selected an additive root-script split and CI composition change; no
shared fixture cache, runner, execution concurrency, or production code changed.

Measured wall-clock baseline numbers and bottleneck dispositions are recorded
in `./BaselineTiming.md`.

## Current orchestration (factual inventory)

```text
Root package.json
  pnpm test -> check:repo && pnpm -r test
  check:repo -> check:tasks + four root Vitest files
  check:workspace / check:openapi -> narrower root Vitest subsets

Each package package.json
  test -> vitest run
  exception: @unicas/service-cloudflare
    test -> node scripts/build-ui-assets.mjs && vitest run --testTimeout=15000

CI validate (.github/workflows/ci.yml)
  check:workspace, check:openapi, check:tasks (separate)
  build, docs:build, typecheck
  pnpm -r test
  wrangler / deploy dry-runs

Toolchain
  pinned pnpm + Vitest (root and packages); no alternate runner without a
  fresh Architecture decision
```

There is no shared Vitest workspace root config that fans out packages, no
checked-in timing inventory, and no named suite taxonomy beyond the scripts
above.

## Responsibility split

| Layer | Owns | Must not own |
| --- | --- | --- |
| Root `package.json` scripts | Named suite entry points; exhaustive composition; documentation anchors for developers | Package-specific fixtures; production deploy |
| Package `package.json` `test` | Default exhaustive package Vitest entry used by `pnpm -r test` | Cross-package orchestration; CI workflow structure |
| Optional package tier scripts | Narrower filters only when Interface matrix names them | Weakening assertions; skipping tests for speed |
| Vitest per package | File discovery, timeouts, reporters used for measurement | pnpm workspace topology |
| CI workflow | Calls approved named suites/composition; avoids duplicate coverage | Inventing a second exhaustive definition that drifts from `pnpm test` |
| Task-local `BaselineTiming.md` | Environment, method, before/after timings, bottleneck dispositions | Secrets; machine-local credentials |
| Developer docs (post-approval) | Which suite for which scenario | Changing suite semantics without Interface revisit |

## Setup, caching, isolation, concurrency

- Preserve test isolation and determinism; no shared mutable fixture cache
  across packages unless baseline proves a safe, explicit reuse point and this
  review is amended.
- service-cloudflare's `build-ui-assets.mjs` before Vitest is a known setup cost
  candidate: measure separately from Vitest file time before any split or reuse.
- Do not treat larger timeouts as optimization.
- Do not introduce paid remote cache, CI-platform migration, or Vitest
  replacement without a separate Architecture decision after baseline shows need.
- Parallelism (`pnpm -r` concurrency, Vitest `fileParallelism` / workers) may
  change only after baseline identifies whether wall time is dominated by serial
  setup vs test bodies, and only within cross-platform constraints.

## Measurement method (required before optimization claims)

Documented in `./BaselineTiming.md` and summarized here:

1. Record environment: OS, Node, pnpm, CPU count, date/timezone.
2. Discard one warm-up run for each timed command when practical.
3. Keep at least two measured wall-clock runs per command; report both (and
   prefer median if more runs are added). Do not present a single noisy run as
   proof.
4. Separate setup costs (for example `build-ui-assets.mjs`) from Vitest file/case
   durations when attributing bottlenecks.
5. Use Vitest JSON (or equivalent) reporters via one-off CLI flags without
   permanently changing scripts until Interface/Architecture-approved edits land.
6. Compare optimizations with the same method on the same class of machine.

## Implemented sequence

1. Captured the baseline and profiled the dominant package.
2. Added named scripts with exhaustive coverage preserved.
3. Rejected an ineffective schema-setup batching probe and retained the
  production migration and test assertions unchanged.
4. Wired CI to the exhaustive composition without duplicate component runs.
5. Documented suite choice and validated the new commands locally.

## Risks

- Naming suites without baseline may mis-size `changed-surface`; mitigate by
  keeping its filter list Architecture-amendable after first baseline.
- Collapsing CI checks into `check:repo` could hide step-level failures in logs;
  mitigate by preserving clear step names or documented composition.
- Moving `build-ui-assets` out of `test` could let CI skip UI asset freshness;
  mitigate by keeping exhaustive/`pnpm -r test` behavior equivalent unless
  Interface amends compatibility.

## Required architecture validation (after approval + implementation)

- Exhaustive path still equals today's `check:repo` + `-r test` coverage.
- Timing report exists with environment, method, bottlenecks, and dispositions.
- Optimizations preserve isolation, determinism, assertions, and production
  behavior.
- No unapproved runner/CI-platform/remote-cache introduction.

## References

- [Task](./Task.md)
- [Suite command matrix](./SuiteCommandMatrix.md)
- [Baseline timing](./BaselineTiming.md)
- [Root scripts](/package.json)
- [CI workflow](/.github/workflows/ci.yml)
- [Package boundaries](/packages/README.md)

# Architecture review — test orchestration design

Status: Pending human approval

## Decision requested

Approve the responsibility split, measurement method, isolation rules, and
implementation sequence below. Approval permits structural changes to test
orchestration, shared setup, artifact reuse, and execution concurrency that
stay inside this design. It does not authorize developer-facing script/CI
renames beyond `./SuiteCommandMatrix.md`, and it does not mark delivery
acceptance.

Measured wall-clock baseline numbers are not yet recorded in
`./BaselineTiming.md`. This review asks approval of the design and measurement
method so baseline capture and later optimizations remain evidence-driven.
Concurrency, caching, and bottleneck dispositions that depend on timings stay
blocked until comparable baseline rows exist.

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

## Responsibility split (proposed)

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

## Implementation sequence (after Interface + Architecture approval)

1. Capture baseline into `./BaselineTiming.md` with the method above (allowed as
   research even before structural edits; required before claiming speedups).
2. Implement Interface-approved named scripts with exhaustive coverage preserved.
3. Apply only straightforward, low-risk optimizations justified by baseline;
   record before/after rows; record evidence-based disposition for unchanged
   bottlenecks.
4. Wire CI to approved composition without dropping checks or duplicate runs.
5. Document suite choice for developers; validate all new tiers and exhaustive
   gate on supported local and CI environments.

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

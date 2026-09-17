# Tier test suites and optimize slow tests

Created: 2026-09-17

## Goal

Provide documented, executable test-suite tiers for common development
scenarios while retaining a canonical exhaustive gate and reducing avoidable
runtime in measured slow tests without weakening coverage or assertions.

## Context

The root `pnpm test` command runs repository checks followed by every package's
test command, while each package currently exposes a single unfiltered
`vitest run` entry point. This makes routine feedback depend on the full suite
even when a change affects a narrower surface. The repository also lacks a
repeatable timing inventory that distinguishes slow test files and cases from
setup or build overhead, so optimizations are not currently evidence-driven.

## Scope

- Capture a repeatable baseline for the existing repository and package test
  paths, including the slowest test files or cases and material setup or build
  costs.
- Define a small test-suite taxonomy mapped to common development scenarios,
  with exact commands and explicit inclusion boundaries for each tier.
- Add or adjust root, package, test-runner, and CI configuration needed to run
  those tiers while preserving one canonical exhaustive test path.
- Implement straightforward, low-risk optimizations for bottlenecks identified
  by the baseline, and record comparable before-and-after evidence; record why
  a measured bottleneck is left unchanged when no safe simple optimization is
  available.
- Document how developers choose and run the supported suites.

## Out of scope

- Removing, skipping, or weakening tests or assertions to improve elapsed
  time.
- Treating larger timeout values alone as a performance optimization.
- Production behavior refactors that are not required to preserve testability
  or isolation.
- A broad test-framework replacement, paid remote cache, or CI-platform
  migration unless separately approved after the baseline shows it is needed.
- A fixed repository-wide runtime target before representative baseline data
  is available.

## Acceptance criteria

- [ ] A versioned suite matrix identifies the supported development scenarios,
  exact commands, inclusion rules, and the canonical exhaustive gate.
- [ ] Root and affected package scripts can execute the approved tiers, and at
  least one common local-development tier runs a strict, meaningfully faster
  subset of the exhaustive gate under the same measurement method.
- [ ] The exhaustive gate still exercises every repository and package test
  covered by the current `pnpm check:repo` plus `pnpm -r test` paths.
- [ ] CI uses the approved named suites or their documented composition without
  dropping checks or needlessly executing the same suite more than once.
- [ ] A repeatable timing report records the environment and method, identifies
  material test and setup bottlenecks, and gives comparable before-and-after
  results for each implemented optimization.
- [ ] Straightforward optimizations found during profiling preserve test
  isolation, determinism, assertions, and production behavior; bottlenecks not
  changed have an evidence-based disposition in the report.
- [ ] Developer documentation explains which suite to run for each supported
  scenario and how to run the exhaustive gate.
- [ ] All new tier commands and the canonical exhaustive gate pass on the
  delivered revision on supported local and CI environments.

## Constraints

- Preserve existing package ownership and the administrator/data access plane
  boundary.
- Continue using the repository's pinned pnpm and Vitest toolchain unless an
  alternative receives explicit architecture approval.
- Keep commands cross-platform for supported Windows development and Linux CI.
- Preserve the behavior of `pnpm test`, or obtain explicit interface approval
  for any incompatible command change.
- Compare timings with a documented, repeatable method that limits the effect
  of warm-up and machine noise; do not present a single noisy run as proof.

## Human review checkpoints

Task creation records this plan, not approval. Scope alignment and delivery
acceptance are always required for completed work.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable owner | Goal, scope, exclusions, constraints, and acceptance criteria in this task. | Substantive implementation. |
| Interface | Required | Repository maintainer responsible for developer experience | Test-suite command matrix covering names, scenarios, inclusion rules, backward compatibility, and CI mapping. | Implementing changes to developer-facing scripts or CI command usage. |
| Business and data model | Not applicable: the task changes test execution and test code, not domain concepts, schemas, persisted data, or migrations. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Repository maintainer | Baseline-driven test orchestration design showing root, package, runner, CI, setup, caching, and isolation responsibilities. | Structurally changing test orchestration, shared setup, artifact reuse, or execution concurrency. |
| Delivery acceptance | Required | User or accountable owner | Integrated revision, suite coverage mapping, command validation, and timing comparison for implemented optimizations. | Marking the task completed and archiving it. |

## References

- [Root scripts](/package.json)
- [Continuous integration workflow](/.github/workflows/ci.yml)
- [Cloudflare service test entry point](/packages/service-cloudflare/package.json)
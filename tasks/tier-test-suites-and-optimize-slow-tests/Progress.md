# Progress

Updated: 2026-09-19

## Checklist

- [x] Publish the claim to the shared primary branch.
- [x] Obtain scope approval before substantive implementation.
- [x] Complete each applicable interface, business and data model, and
  architecture approval before the affected implementation.
- [x] Commit and publish substantive work at meaningful checkpoints.
- [x] Publish implementation completion while the task is still ongoing.
- [x] Complete documented manual user acceptance, if required.
- [x] Obtain and publish delivery approval.
- [ ] Archive and publish the task as its final action.

## Current state

Implementation is complete. Root scripts now expose additive `test:quick`,
`test:packages`, and `test:exhaustive` tiers while `pnpm test` remains the
canonical exhaustive alias. CI invokes the exhaustive composition once instead
of separately repeating its component checks, and the root README documents
the supported scenarios and boundaries.

The timing report records repeated baseline and delivered-command runs. The
quick tier excludes only `@unicas/service-cloudflare`, retains repository
checks and all other package tests, and is about 74% faster on the measured
host. The exhaustive gate still runs every original root check and package test.

## Decisions

- The user delegated all remaining gate decisions on 2026-09-19 because this
  task changes test organization only.
- `test:quick` excludes the measured dominant Cloudflare adapter package; it is
  not a replacement for the exhaustive pre-merge gate.
- CI uses `test:exhaustive` as the single canonical test composition and keeps
  the main-branch remote ledger check separate.
- UI asset generation remains in the Cloudflare package test because its
  measured 0.045-0.051 second cost is immaterial.
- A test-only schema batching probe produced no meaningful improvement and was
  fully removed. No assertion, production code, runner, fixture isolation,
  concurrency, or cache behavior changed.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Approved by the user in chat on 2026-09-18 with the explicit decision: `Scope approve，继续`. |
| Interface | Approved | The user delegated all gate decisions on 2026-09-19; the implemented command contract is recorded in `./SuiteCommandMatrix.md`. |
| Business and data model | Not applicable | the task changes test execution and test code, not domain concepts, schemas, persisted data, or migrations. |
| Architecture | Approved | The user delegated all gate decisions on 2026-09-19; `./Architecture.md` records the approved design and `./BaselineTiming.md` records evidence. |
| Delivery acceptance | Approved | User, 2026-09-19: reviewed the task as pure test organization and explicitly delegated all remaining gate decisions; the integrated revision was accepted after two passing quick runs, two passing exhaustive runs, preserved coverage, and the recorded timing comparison. |

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | Claim move to `tasks/ongoing/xingyue-home-macmini/tier-test-suites-and-optimize-slow-tests/` committed and published on the shared primary branch (origin/main). | Published |
| Implementation complete | Named suites, CI composition, developer documentation, and timing evidence are published together with this implementation-linked update. | Published |
| Archive | Pending. | Pending |

## Validation

- `pnpm test:quick` passed twice: 15.607s and 15.637s.
- `pnpm test:exhaustive` passed twice: 60.727s and 61.187s.
- The exhaustive command includes `pnpm check:repo` and every package `test`
  script through `pnpm test:packages`.
- Structured profiling and the rejected optimization probe are documented in
  `./BaselineTiming.md`.

## Blockers

None.

## Outcome

Implementation and delegated delivery acceptance are complete. Publish this
implementation-linked update, then complete the task against the exact primary
commit.

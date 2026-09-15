# Progress

Updated: 2026-09-15

## Checklist

- [x] Persist candidate inspections independently from active authority.
- [x] Verify proof and atomically activate or replace under exact preconditions.
- [x] Update v2 protocol, client, CLI/MCP, and Console minimal receipts.
- [x] Verify cache revocation bounds, failures, and independent managed issuer.
- [ ] Publish validated implementation and archive.

## Current state

Claim `2c15f8bb3afaeeb656aa006df052671cd0bdcb13` is verified on `origin/main`.
Candidate-only v2 inspection and atomic activation/replacement are implemented
with minimal receipts across protocol, BFF, client, CLI/MCP, and Console.
All required local gates pass. Next publish implementation and archive before
starting platform access management; no production deployment is requested.

## Decisions

- This is the third independently executed prerequisite authorized by the user.
- Initial v2 activation uses `If-None-Match: *`; replacement uses the current
  external issuer ETag. Inspection does not supply a mutable issuer revision.
- Preserve frozen legacy inspection/activation semantics while sharing proof
  validation and storage primitives where their contracts match.

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | `origin/main` commit `2c15f8bb3afaeeb656aa006df052671cd0bdcb13`. | Published |
| Implementation complete | Not yet completed. | Pending |
| Archive | Not yet archived. | Pending |

## Validation

- `pnpm exec repoledger doctor` passed before claiming.
- Both earlier prerequisites are archived and published.
- D1 signed-proof tests pass for initial activation, active replacement,
  unchanged prior authority during inspection, stale/missing/conflicting
  preconditions, invalid proof, expiry, and concurrent global issuer uniqueness.
  Failed uniqueness commits preserve current authority and unconsumed candidates.
- Verifier test confirms old issuer authority is rejected on refresh and cannot
  survive the 60-second hard stale bound during registry failure.
- Ten focused client/CLI/legacy service issuer tests pass; BFF receipt/header
  forwarding test passes; 10 source schema/OpenAPI tests pass.
- Eight Console issuer tests pass, including current/candidate separation,
  first activation If-None-Match, replacement using current issuer revision,
  and independent managed issuer workflows.
- All workspace typechecks pass. Browser DOM verification with synthetic data
  confirmed current/candidate separation; native automation stability waits
  and screenshot capture failed in the shared browser, so no issuer screenshot
  validation is claimed. Invitation desktop/mobile validation is recorded in
  its completed prerequisite task.
- Complete affected non-UI suite passed 43 files and 449 tests.
- Console package suite passed 9 files and 52 tests; production build passed.
- `pnpm check:repo` passed task history, 6 policy tests, and 114 repository
  tests including generated OpenAPI drift. Relevant editor diagnostics are
  clear and `git diff --check` passed.

## Blockers

- None.

## Outcome

In progress.

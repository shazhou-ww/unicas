# Progress

Updated: 2026-09-15

## Checklist

- [ ] Persist candidate inspections independently from active authority.
- [ ] Verify proof and atomically activate or replace under exact preconditions.
- [ ] Update v2 protocol, client, CLI/MCP, and Console minimal receipts.
- [ ] Verify cache revocation bounds, failures, and independent managed issuer.
- [ ] Publish validated implementation and archive.

## Current state

Claim-only change. Publish the claim and record its immutable hash before
implementation. The next concrete action is to add a candidate-only v2
inspection path and test that an existing issuer remains active and unchanged.

## Decisions

- This is the third independently executed prerequisite authorized by the user.
- Initial v2 activation uses `If-None-Match: *`; replacement uses the current
  external issuer ETag. Inspection does not supply a mutable issuer revision.
- Preserve frozen legacy inspection/activation semantics while sharing proof
  validation and storage primitives where their contracts match.

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | Awaiting immutable claim commit on `origin/main`. | Pending |
| Implementation complete | Not yet completed. | Pending |
| Archive | Not yet archived. | Pending |

## Validation

- `pnpm exec repoledger doctor` passed before claiming.
- Both earlier prerequisites are archived and published.

## Blockers

- None.

## Outcome

In progress.

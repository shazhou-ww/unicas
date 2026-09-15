# Progress

Updated: 2026-09-15

## Checklist

- [ ] Add snapshot-bound invitation reads and atomic conditional revocation.
- [ ] Reconcile expiry and preserve immutable audit without bearer disclosure.
- [ ] Expose protocol, client, BFF, CLI, and MCP operations with minimal writes.
- [ ] Integrate the existing Console invitation view and verify responsive behavior.
- [ ] Run acceptance gates and publish implementation before archival.

## Current state

Claim-only change. Publish this claim and record its immutable hash before
implementation. Next add an App-scoped non-secret invitation list port and a
conditional transition port, then test stale revisions, acceptance races,
cross-App access, expiry, and snapshot consistency.

## Decisions

- This is the second independently executed prerequisite authorized by the user.
- Keep lifecycle statuses and minimal write responses aligned with the reviewed
  Console API proposal while preserving explicit legacy compatibility.
- Use the existing D1 atomic mutation and control-snapshot conventions.

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | Awaiting the immutable claim commit on `origin/main`. | Pending |
| Implementation complete | Not yet completed. | Pending |
| Archive | Not yet archived. | Pending |

## Validation

- `pnpm exec repoledger doctor` passed before claiming.
- Suspension prerequisite is completed and published in the archive.

## Blockers

- None.

## Outcome

In progress.

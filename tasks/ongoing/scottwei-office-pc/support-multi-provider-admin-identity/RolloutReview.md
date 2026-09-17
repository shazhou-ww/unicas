# Rollout architecture decision

Status: Pending approval

## Decision requested

Approve using separately validated release revisions for the legacy/shadow
rehearsal, instead of promising that the current Account-based binary can switch
back to identity-keyed authorization through a runtime flag.

The Account model, provider set, and no-email-linking rules remain unchanged.
This reopens only the deployment and rollback portion of the architecture
checkpoint, not the already approved Account implementation.

## Current and proposed

| Aspect | Approved plan | Proposed refinement | Reason |
| --- | --- | --- | --- |
| Legacy/shadow | Runtime stages in one service version | Rehearse using pinned legacy, additive-migration, and Account release revisions on disposable copied fixtures | The current Worker initializes Account migration and uses Account v2 contracts unconditionally. Legacy columns alone do not implement a legacy runtime mode. |
| Account rollout | `account-google`, then `multi-provider` | Retain these runtime gates, default to `account-google`, and separately gate linking | Preserve the original order without reintroducing a second authorization model. |
| Recovery | Disable new login, linking, and challenge mutations; preserve Account reads | Add an explicit authentication-mutation stop switch shared by BFF and remote MCP; existing credentials still undergo current Account checks | Recovery must not bypass revocation or change resource ownership. |
| Rollback boundary | Recorded when multi-provider/linking is enabled | Persist an irreversible cutover marker before enabling multi-provider/linking; refuse an identity-mode downgrade afterward | Prevent a configuration edit from splitting linked identities into separate authorization owners. |

## Unchanged invariants

- Every existing Principal maps one-to-one through the permanent migration map;
  email never merges identities or moves access.
- The Account and ExternalIdentity relationships in
  [BusinessDataModel](./BusinessDataModel.md) remain unchanged. Session and MCP
  grant bindings remain ephemeral immutable: migration or refresh creates a
  replacement and does not adopt a newer credential generation.
- Neither configuration rollback nor binary rollback removes migration data,
  Account attribution, or linked identity history.
- After multi-provider use, recovery preserves Account authorization and rolls
  forward. Restoring a database backup is disaster recovery, not ordinary undo.
- No production mutation is part of this review. Backup/export, provider
  registrations, sender onboarding, rehearsals, and delivery acceptance remain
  required before production rollout.

## Validation before rollout

Require one-to-one reconciliation, old-session rotation, old-grant transition,
Google-only gates, provider/link gating, recovery-stop behavior, and tests that
reject downgrade after the cutover marker. Rehearse pre-cutover rollback and
post-cutover forward recovery against disposable data before real providers and
email delivery are accepted by the user.

If this refinement is rejected, retain the original four-runtime-stage design
and implement and test an explicit legacy/shadow authorization composition in
addition to the existing Account path. Neither option is assumed approved.

Do you approve this rollout architecture refinement: pinned-revision
legacy/shadow rehearsals, Account-only runtime gates, and an irreversible
multi-provider cutover marker?
# Enforce terminal task artifact consistency

Created: 2026-09-19

## Goal

Prevent a repository task from becoming `completed` while its Task acceptance
criteria, Progress lifecycle checklist, or required human approval rows still
record incomplete work.

## Context

The completed `support-multi-provider-admin-identity` task retained unchecked
acceptance criteria and a pending Delivery acceptance row even though
`repoledger task complete` accepted and published the terminal transition.
Repoledger 0.7 currently ties some completed-artifact validation to an optional
Progress `Outcome: Completed` value instead of the canonical lifecycle state,
and the completion command does not reject every unresolved checklist before
publication.

The identity task artifacts have been reconciled from their existing automated,
production, and explicit delivery-approval evidence. This task addresses the
general validation gap so a future completion cannot publish the same
contradiction.

## Scope

- Extend the pinned repoledger 0.7 patch so canonical `completed` state requires
  every Task acceptance criterion to be checked, independent of an optional
  Progress Outcome section.
- Require every item in the current-schema Progress lifecycle checklist to be
  checked before a completed state is accepted.
- Require every applicable human review checkpoint, including Delivery
  acceptance, to be `Approved` before completion; preserve valid `Not
  applicable` classifications.
- Make `repoledger task complete` reject the transition before publishing when
  any of those terminal artifact requirements are unresolved.
- Add isolated Git-fixture tests for unchecked acceptance, unchecked Progress
  lifecycle work, pending required approval, a fully reconciled successful
  completion, and remote validation of the published result.
- Keep repository task documentation and diagnostics aligned with the
  `completed` terminal state; do not introduce an archive lifecycle or command.

## Out of scope

- Changing task states, adding reopen/archive transitions, or rewriting
  existing primary-branch history.
- Automatically checking acceptance criteria, synthesizing approval evidence,
  or treating a Git commit or silence as human approval.
- Publishing changes to the upstream repoledger package or upgrading beyond the
  repository's pinned 0.7 release.
- Reworking legacy terminal tasks that intentionally predate the current human
  review schema.
- Changing UniCAS product behavior, identity semantics, deployment workflows,
  or production resources.

## Acceptance criteria

- [ ] `repoledger check` reports an error for a current-schema completed task
      with any unchecked Task acceptance criterion, even when Progress omits an
      explicit Outcome section.
- [ ] A current-schema completed task fails validation when its Progress
      lifecycle checklist contains an unchecked item or an applicable human
      review checkpoint is not `Approved`.
- [ ] `repoledger task complete` refuses to publish a terminal transition when
      acceptance, lifecycle, or approval evidence is unresolved, leaving the
      canonical task state unchanged.
- [ ] A fully reconciled task with explicit approval of the exact current
      primary commit completes successfully and passes remote validation.
- [ ] Legacy terminal-task compatibility and the existing hardened
      forward-revert validation continue to pass without weakening either
      rule.
- [ ] Focused patch fixtures and the complete repository task check pass from a
      clean checkout.

## Constraints

- Treat lifecycle state in `tasks/status.yaml` as canonical; optional prose or
  Outcome headings must not weaken terminal validation.
- Keep approval semantic: required checkpoints need explicit `Approved`
  evidence, while genuinely non-applicable checkpoints remain valid only under
  the existing plan/status rules.
- Validate before publication so a failed completion does not require history
  rewriting or a corrective lifecycle commit.
- Preserve repoledger's non-force publication model and existing remote-primary
  concurrency checks.
- Keep the pnpm patch narrow, deterministic, and covered by temporary-repository
  fixtures rather than relying on this repository's current task history.

## Human review checkpoints

Task creation records this plan, not approval. Each required checkpoint must be
explicitly approved before its protected step.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable repository owner | This task's validation rules, compatibility exclusions, constraints, and acceptance criteria. | Modifying the pinned repoledger patch or tests. |
| Architecture | Not applicable: this is a narrow validation correction inside the existing pinned patch and publication model. | Not applicable | Not applicable | Not applicable |
| Interface | Not applicable: no product UI, public API, or operator command syntax changes; existing commands only reject invalid completion earlier. | Not applicable | Not applicable | Not applicable |
| Business and data model | Not applicable: no UniCAS domain entity, ownership, relationship, key, lifecycle, or persistence model changes. | Not applicable | Not applicable | Not applicable |
| Delivery acceptance | Required | User or accountable repository owner | Integrated patch, isolated completion fixtures, full repository task check, and remote validation evidence. | Marking the task completed. |

## References

- [Pinned repoledger patch](/patches/repoledger@0.8.1.patch)
- [Repoledger patch fixture](/tests/repoledger-patch.test.mjs)
- [Repository task workflow](/docs/repository-tasks.md)
- [Repository task ledger skill](/.agents/skills/repoledger/SKILL.md)
- [Reconciled identity task](/tasks/support-multi-provider-admin-identity/Task.md)

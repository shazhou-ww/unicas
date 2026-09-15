# Progress

Updated: 2026-09-15

## Checklist

- [x] Complete and publish all three prerequisite tasks independently.
- [x] Settle core authorization and bootstrap policy with the user.
- [ ] Implement persistent deny-by-default admission, authorities, and audit.
- [ ] Implement protected platform APIs, clients, CLI, and MCP.
- [ ] Implement invitation-limited login and revocation for existing sessions.
- [ ] Rebuild Console with source-owned shadcn primitives and two-column navigation.
- [ ] Validate bootstrap/migration, workflows, accessibility, and repository gates.
- [ ] Publish validated implementation and archive.

## Current state

Claim-only change. Publish this claim and record its immutable hash before
implementation. Next implement the platform authorization model and prove that
Google authentication alone grants neither admission nor App creation and
never creates authority implicitly.

## Decisions

- User confirmed independent `platform.admin` and `apps.create` authorities,
  administrator-plane-only blocking, a maximum 60-second revocation bound,
  and no invitation email retained in audit records.
- User selected out-of-band bootstrap: an operator uses a Cloudflare API token
  to write the initial immutable Principal grants directly to D1. Do not add an
  application bootstrap endpoint or derive grants automatically from email.
  Never read, log, commit, or request the real token through chat.
- Platform client/CLI/MCP operations remain in scope; OAuth scopes are only
  delegated operation classes and do not substitute for current authority.
- All three prerequisite implementations and archives are published on main;
  preserve their accepted minimal write contracts and legacy boundaries.

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | Awaiting immutable claim commit on `origin/main`. | Pending |
| Implementation complete | Not yet completed. | Pending |
| Archive | Not yet archived. | Pending |

## Validation

- `pnpm exec repoledger doctor` passed before this claim.
- Prerequisite final checks passed workspace typechecks, source/generated
  protocol checks, backend tests, Console tests/build, and repository gates.

## Blockers

- None for implementation. Production bootstrap execution requires an operator
  with a Cloudflare token and verified initial Principal; no production action
  is performed implicitly by this task session.

## Outcome

In progress.

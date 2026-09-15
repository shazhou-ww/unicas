# Progress

Updated: 2026-09-16

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

Claim `ff3c87e0318d4c30b76111d8cf96302a0b354fba` is verified on `origin/main`.
The shared platform authorization model, service guards, D1 tables, and atomic
access mutation repository are implemented locally and pass focused tests.
These guards are not yet wired into production login, BFF, or MCP request paths;
the platform APIs and Console rebuild are not implemented. This record
accompanies a local checkpoint of the authorization foundations, not a complete
implementation or published completion milestone. No production deployment
has been performed.

Next integrate the shared admission guard into authenticated BFF operations
and test that an existing Google session without a grant or App membership is
denied without implicitly creating an access-state record. Preserve the
explicit invitation-limited continuation boundary as that integration proceeds.

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
| Claim | `origin/main` commit `ff3c87e0318d4c30b76111d8cf96302a0b354fba`. | Published |
| Implementation complete | Not yet completed. | Pending |
| Archive | Not yet archived. | Pending |

## Validation

- `pnpm exec repoledger doctor` passed before this claim.
- Prerequisite final checks passed workspace typechecks, source/generated
  protocol checks, backend tests, Console tests/build, and repository gates.
- On 2026-09-16, the focused platform-access test run passed all 10 tests:
  5 administrator protocol tests, 4 service tests, and 1 D1 integration test.
  Coverage includes deny-by-default admission, independent App creation
  authority, explicit out-of-band bootstrap, last-administrator protection,
  self-block rejection, revision conflicts, and durable audit writes.
- `pnpm --filter @unicas/service-cloudflare typecheck` passed with the new
  authorization repository and its protocol/service dependencies.

## Blockers

- None for implementation. Production bootstrap execution requires an operator
  with a Cloudflare token and verified initial Principal; no production action
  is performed implicitly by this task session.

## Outcome

In progress.

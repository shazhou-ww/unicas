# Progress

Updated: 2026-09-16

## Checklist

- [x] Complete and publish all three prerequisite tasks independently.
- [x] Settle core authorization and bootstrap policy with the user.
- [x] Implement persistent deny-by-default admission, authorities, and audit.
- [ ] Implement protected platform APIs, clients, CLI, and MCP.
- [ ] Implement invitation-limited login and revocation for existing sessions.
- [ ] Rebuild Console with source-owned shadcn primitives and two-column navigation.
- [ ] Validate bootstrap/migration, workflows, accessibility, and repository gates.
- [ ] Publish validated implementation and archive.

## Current state

Claim `ff3c87e0318d4c30b76111d8cf96302a0b354fba` is verified on `origin/main`.
The shared platform authorization model, service guards, D1 tables, and atomic
access mutation repository are implemented and pass focused tests. The admission
guard is now integrated into the BFF authentication paths:

- **Login flow**: After emailAllowlist check (first gate), `PlatformAccessService.requireAccess`
  is called. A principal without a grant or App membership is denied with
  `302 /admin/auth/login?error=access-denied`; no access-state record is created.
  CLI login path redirects to the loopback with `error=access_denied`.
- **Authenticated request path**: `requireAuthenticated` calls
  `PlatformAccessService.assertNotBlocked` after reading the session payload.
  A blocked principal's session is deleted and the request is rejected with 401.
- **Worker wiring**: `D1PlatformAccessRepository` is injected into `createAdminBff`
  in `worker.ts`.

All 219 tests pass (`pnpm --filter @unicas/service-cloudflare test`), including
4 new BFF platform access integration tests.

Next: implement protected platform APIs (list principals, grant/revoke authority)
and wire the CLI/MCP paths.

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
- emailAllowlist remains the first gate; platform access is the second gate.

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
- On 2026-09-16, BFF admission guard integration: `pnpm --filter @unicas/service-cloudflare test`
  passed all 219 tests (37 BFF tests + 182 others). New BFF tests cover:
  - Login denied when principal has no grant or membership
  - Login allowed when principal has explicit grant with authority
  - Authenticated request denied and session cleared for a blocked principal
  - emailAllowlist remains first gate (denied before platform access check)

## Blockers

- None for implementation. Production bootstrap execution requires an operator
  with a Cloudflare token and verified initial Principal; no production action
  is performed implicitly by this task session.

## Outcome

In progress.

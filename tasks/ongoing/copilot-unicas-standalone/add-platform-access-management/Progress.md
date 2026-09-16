# Progress

Updated: 2026-09-16

## Checklist

- [x] Complete and publish all three prerequisite tasks independently.
- [x] Settle core authorization and bootstrap policy with the user.
- [x] Implement persistent deny-by-default admission, authorities, and audit.
- [x] Implement protected platform APIs (list principals, get principal, patch access, access summary).
- [x] Implement email-bound App invitation-limited login and browser/MCP revocation.
- [ ] Implement platform invitations, complete Principal detail, and platform audit reads.
- [ ] Rebuild Console with source-owned shadcn primitives and two-column navigation.
- [ ] Validate bootstrap/migration, workflows, accessibility, and repository gates.
- [ ] Publish validated implementation and archive.

## Current state

Handoff from `xiaoju-neko-vm` to `copilot-unicas-standalone` is published as
`ae10e7d20b357647a52c9036bd7a636463ff13a5` and verified on `origin/main`. No
overlapping backlog or ongoing task exists.

Claim `ff3c87e0318d4c30b76111d8cf96302a0b354fba` is verified on `origin/main`.
The shared platform authorization model, service guards, D1 tables, and atomic
access mutation repository are implemented. The admission guard is integrated
into the BFF authentication paths. Protected platform API endpoints are now
implemented and pass tests:

- **Login flow**: `PlatformAccessService.requireAccess` enforced; no-access principals denied.
- **Authenticated request path**: full effective admission is rechecked on every request.
- **Platform Admin API** (all require `platform.admin` authority):
  - `GET /admin/platform/access-summary` → aggregate counts via `D1PlatformAccessRepository.getAccessSummary`
  - `GET /admin/platform/principals` → paginated list via `PlatformAccessService.listPrincipals`
  - `GET /admin/platform/principals/{ref}` → single principal detail via `PlatformAccessService.getPrincipal`
  - `PATCH /admin/platform/principals/{ref}/access` → conditional write via `PlatformAccessService.patchAccess` with ETag
- **Types added** to `@unicas/admin-protocol`: `PlatformPrincipalListItem`, `PlatformPrincipalDetail`, `PlatformPrincipalPage`, `PlatformAccessSummary`
- **Routes added**: `matchPlatformAdminRoute` (shared between `AppAdminRoute` and `CasAdminRoute`); route builders for `accessSummary`, `platformPrincipals`, `platformPrincipal`, `platformPrincipalAccess`
- **Service expanded**: `PlatformAccessService.listPrincipals`, `getPrincipal`, `getAccessSummary`; `PlatformAccessRepository.getAccessSummary` interface + D1 implementation
- **Browser session revocation**: every authenticated BFF request now rechecks
  effective platform admission. Removing the last platform authority or App
  membership invalidates an existing session on its next request.
- **Invitation-limited login**: pending email-bound App invitations use an
  encrypted OIDC continuation. Raw tokens never enter OAuth state; the limited
  session is bound to invitation ID and token hash, can call only matching
  acceptance and logout, and rotates after membership is granted.
- **MCP revocation**: platform admission is checked before OAuth consent and on
  every authenticated MCP request. `create_app` independently requires current
  `apps.create` authority in addition to delegated `control:write` scope.
- **Current session projection**: `/admin/me` now returns persisted platform
  authorities; Console Platform Administration and App creation visibility are
  derived from them. App invitation acceptance atomically creates an active,
  empty-authority Principal state alongside membership.

All 235 service-cloudflare tests pass. Console tests and production build pass.

Next: implement platform invitation resources and reuse the limited-session
continuation for their acceptance, then complete platform Principal detail and
audit reads.

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
- `emailAllowlist` remains the first gate for ordinary login; an email-bound
  invitation continuation is the explicit exception for an external invitee.
  Full admission is still rechecked from authorities or App membership.

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
- On 2026-09-16, BFF admission guard integration: all 219 tests passed.
  New BFF tests covered login denied/allowed and blocked principal handling.
- On 2026-09-16, Platform Admin API: `pnpm --filter @unicas/service-cloudflare test`
  passed all 226 tests (226 = prior 219 + 7 new platform admin BFF tests). New tests cover:
  - `GET /admin/platform/access-summary` returns correct aggregate counts
  - `GET /admin/platform/principals` returns paginated principal list
  - `GET /admin/platform/principals/{ref}` returns principal detail
  - `GET /admin/platform/principals/{ref}` returns 404 for unknown ref
  - `PATCH /admin/platform/principals/{ref}/access` delegates to service and returns ETag
  - `PATCH` without `If-Match` returns 428
  - Non-platform-admin (apps.create only) gets 403 on all platform routes
- On 2026-09-16, existing browser sessions were changed from blocked-only
  checks to full effective-admission checks. Focused BFF tests cover removal of
  the last authority and removal of the last App membership; all 46 BFF tests
  pass. `pnpm --filter @unicas/service-cloudflare typecheck` passes, and a clean
  full rerun passes all 228 service-cloudflare tests.
- On 2026-09-16, invitation and revocation security validation passed:
  `@unicas/admin-protocol` 79 tests, `@unicas/admin-client` 14 tests,
  `@unicas/service` 111 tests, `@unicas/admin-webui` 54 tests plus production
  build, repository OpenAPI drift 4 tests, and `@unicas/service-cloudflare`
  235 tests across 22 files. Coverage includes invitation token secrecy,
  verified-email matching, exact limited-session routing, post-acceptance
  rotation, atomic empty-authority Principal creation, next-request browser
  and MCP revocation, fail-closed storage errors, and independent App creation
  authority in BFF and MCP paths.

## Console rebuild progress

- [x] Milestone 1: Tailwind CSS 4 + shadcn/ui infrastructure — installed 17 shadcn components, `cn()` helper, `@/*` path alias, `@tailwindcss/vite` plugin, `/admin/platform` proxy bypass.
- [x] Milestone 2: Sidebar shell + two-column layout + routing — `app-sidebar.tsx` (brand, Apps list, Platform Admin, profile footer), `app-detail-tabs.tsx` (shadcn Tabs), `parseAppRoute`/`parsePlatformRoute` in router, `app.tsx` rewritten with two-column flex layout, `user-menu.tsx` migrated to shadcn DropdownMenu + Avatar. All 52 tests pass.
- [ ] Milestone 3: Port Overview view to shadcn.
- [ ] Milestone 4: Port Members, Invitations, and Change Logs.
- [ ] Milestone 5: Port Playground to shadcn.
- [ ] Milestone 6: Platform Administration views.
- [ ] Milestone 7: Cleanup old components, CSS, and tests.

## Blockers

- None for implementation. Production bootstrap execution requires an operator
  with a Cloudflare token and verified initial Principal; no production action
  is performed implicitly by this task session.

## Outcome

In progress.

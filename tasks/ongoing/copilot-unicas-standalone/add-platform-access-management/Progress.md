# Progress

Updated: 2026-09-16

## Checklist

- [x] Complete and publish all three prerequisite tasks independently.
- [x] Settle core authorization and bootstrap policy with the user.
- [x] Implement persistent deny-by-default admission, authorities, and audit.
- [x] Implement protected platform APIs (list principals, get principal, patch access, access summary).
- [x] Implement email-bound App invitation-limited login and browser/MCP revocation.
- [x] Implement platform invitations, complete Principal detail, and platform audit reads.
- [ ] Review and implement unified App Members and Platform People queries/tables.
- [ ] Rebuild Console with source-owned shadcn primitives and two-column navigation.
- [ ] Validate bootstrap/migration, workflows, accessibility, and repository gates.
- [ ] Publish implementation completion after required reviews and remaining acceptance checks.
- [ ] Obtain explicit human delivery acceptance.
- [ ] Publish archive as a separate final integration.

## Current state

Approval on 2026-09-16: after publication of the unified query/UI amendment
as `83beb4b`, the requesting user explicitly directed "你继续去做吧" in
response to the request to proceed with both read contracts. This approves
the focused scope, interface, projection model, and service/D1 ownership in
that amendment. Publish this approval before implementing the new queries.
Broader task delivery acceptance remains pending. Current next action:
implement and validate the two aggregate queries and their Console consumers.

Latest scope update, 2026-09-16: the user approved the App Members/Invitations
merge ("好的，那就这么调整吧") and requested the same treatment for Platform
Principals/Invitations. Both remain unimplemented. Source inspection confirmed
duplicate App invitation navigation and independent per-resource pagination.
The attempted App people protocol patch returned unknown outcome; a file check
confirmed it did not land. No aggregate endpoint or unified table is delivered.

Concrete review artifacts now describe both sides:
[unified query contract](./ApiDesign.md#unified-people-query-amendment) and
[unified UI amendment](./UiDesign.md#unified-people-lists-amendment).
Scope/UI intent is accepted for this focused change. Proposed new read APIs,
discriminated rows, cursor/snapshot behavior (including profile updates), and
service/D1 ownership still require explicit interface/model/architecture
approval before implementation; that approval is now recorded above. Existing membership/grant/invitation writes
and protections remain unchanged; there is no new Principal identity model.

Local implementation is validated but not implementation-complete or approved
for archival. The latest source changes remain uncommitted. This progress
update supersedes the historical checkpoint notes below.

Platform invitations, Principal filtering/detail, platform audit, typed client,
CLI and remote/stdio MCP surfaces are implemented. The Console uses shared
shadcn primitives with a two-column shell, authority-driven navigation,
Platform tabs, invitation dialogs, and a right-side mobile navigation Sheet.
Operations documentation covers out-of-band bootstrap, allowlist cutover,
rollback, break-glass, and encryption-key retention. No production action ran.

Integration findings fixed during browser verification:

- Latest user-requested refinement: extracted `CopyBubble` and a shared Sonner
  notification host. App ID uses the component with pointer cursor, hover/focus
  affordance, native keyboard activation, and floating success/failure messages.
  The value remains visible and unchanged. Messages prefer the document language,
  then browser language, with English fallback; English, simplified Chinese,
  and traditional Chinese are covered. This is not a full Console translation
  system. Other explicit copy buttons have not been migrated in this slice.
- App ID, Status, Revision, and Created now share one semantic two-column
  definition grid. Browser geometry at 1280px and 375px verifies equal column
  widths, aligned row positions, and no horizontal page overflow.
- Latest focused checks: all nine App-shell tests pass, covering three message
  languages, mouse/Enter copy, clipboard rejection, and prior navigation flows.
  WebUI typecheck and touched-file editor diagnostics pass. A browser probe with
  a temporary clipboard stub rendered a visible `App ID copied` toast; the stub
  was restored immediately. Real clipboard interaction and screenshot capture
  timed out in the background browser page, so they are not recorded as passed
  visual or real-clipboard acceptance. Full repository gates below predate this
  refinement and have not been rerun for it.
- User requested compact inline App ID/Status and a copyable ID bubble with no
  separate Copy button. The identity row now wraps responsively, keeps the ID
  visible during copy feedback, supports native button keyboard activation,
  and reports clipboard errors. All six App-shell tests pass, including mouse,
  Enter, and clipboard rejection coverage. Desktop screenshot and 375px geometry
  confirm a compact bubble with no page overflow; touched-file diagnostics pass.
- User requested Playground independently right-aligned and unavailable until
  the managed issuer is enabled. The tab now follows Change Logs with an auto
  left margin and is disabled during loading, on lookup failure, or when the
  issuer is not active. Overview issuer toggles update the entry immediately;
  existing deep links keep the settings fallback. Four App-shell tests pass,
  including enable/disable transitions. Browser geometry checks at 1280px and
  375px show the Playground and tablist right edges match without page overflow.
  This supersedes the original tab order in the UI proposal and is a focused
  user-approved interface adjustment, not approval of the remaining gates.
- User-reported login CSS failure: Vite returned SPA HTML for the BFF's
  `/admin/assets/index.css` URL. The local proxy now forwards built assets to
  the BFF. Browser validation confirms 200 `text/css`, the intended font and
  button background, and no horizontal overflow. Vite config diagnostics pass.
  This focused user-requested fix does not approve the broader review gates.
- Vite preserves the browser Host so the Worker public-origin check accepts
  local requests. `/admin/me` changed from Worker 404 to expected 401/login.
- The App compatibility adapter passes Platform routes through unchanged;
  previously its response switch converted valid BFF JSON into an empty body.
  The focused adapter suite passes all 10 tests.
- Tailwind 4 now maps existing semantic theme tokens; Sheet/Dialog backgrounds
  are opaque and borders use the intended gray. The obsolete icon grid track
  in the App concept guide was removed, and the Principal Sheet fits 375px.
- Schema migration renames legacy `stack_id` columns in OAuth inspections and
  control audit before App indexes are created. A legacy fixture preserves
  rows across two migrations; all five schema tests pass. Original local
  persistence starts and mock login plus Principal list return 200. This does
  not prove migration of all legacy stack or tenant data.
- Cloudflare package tests now have a finite 15-second default timeout after
  several real Miniflare/D1 scenarios exceeded five seconds without assertion
  failures. The normal recursive test entry subsequently passed.

### Latest validation

On 2026-09-16, `pnpm exec repoledger doctor`, `pnpm test`, `pnpm build`,
`pnpm typecheck`, `pnpm docs:build`, Worker Wrangler `deploy --dry-run`,
`pnpm deploy:site:plan`, and `pnpm deploy:docs:plan` passed. Tests include
6 task-policy, 114 repository, 92 admin-protocol, 15 admin-client, 116 service,
245 service-cloudflare, and 62 WebUI checks. The recursive test run includes
the CLI and remaining workspace packages as well.

Browser screenshots and geometry checks covered 375, 768, 1280, and 1920px.
Observed no page-level horizontal overflow; narrow tables scroll locally.
Verified mock OIDC, long App names, Principal detail, invitation creation,
revoke confirmation cancellation, audit rows, and right-side navigation.
At 375px the Principal Sheet spans 0..375px; the navigation Sheet spans
103..375px. Reduced-motion CSS and focus rules were inspected, but a complete
keyboard/focus/reduced-motion browser acceptance pass is still outstanding.
Screenshots were inspected in the session, not committed as durable artifacts.

Remaining acceptance work after human review:

- Recheck all Console migration criteria, including full existing workflows.
- Verify creation updates sidebar memberships without requiring a reload;
  the observed list refreshed while the sidebar still showed zero memberships.
- Complete keyboard, focus-return, screen-reader labeling, and reduced-motion
  browser checks. Preserve current passing responsive layouts.
- Review migration applicability: successful local startup is not evidence
  that all historical stack data has been converted to App tables.
- Obtain the operator's review of the production runbook; do not perform
  production bootstrap implicitly or mark it executed based on mock tests.

### Human review state

All five review categories now have a task-specific plan in [Task](./Task.md).
Scope, interface, business/data model, and architecture alignment await the
requesting user's explicit review of the current artifacts and implementation
state. Earlier individual policy decisions below remain evidence only for
those decisions. Delivery acceptance is pending a published final revision and
completion of the outstanding criteria. No retrospective approval is inferred.

The pending review plan was published as `53093dc` and verified on `origin/main`.
Subsequent focused UI fixes were explicitly requested by the user; they do not
constitute blanket approval of the first four checkpoints. These later changes
and progress updates remain local.

Next action: publish the unified query/UI review artifacts and request explicit
approval for the two additive read APIs and their cursor/ownership contract.
Do not implement the protected new query surfaces before that decision. After
approval, implement and test the combined server-side pages, shared presentation,
Invite dialogs, old-link redirects, and separate authorization/mutation paths.
Broader task gates remain pending. Repeat real-clipboard and toast
visual acceptance in a foreground browser, rerun the relevant final gates,
publish implementation completion, and request separate delivery acceptance.

## Historical implementation checkpoint

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
- Persisted admission replaces allowlist-first authorization when the platform
  repository is configured; otherwise invited members could not reauthenticate.
  The allowlist remains only a rollback fallback. Current admission is rechecked
  from authorities or App membership.

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

- Pending human scope, interface, model, and architecture review. Do not cross
  further implementation gates or archive without the required decisions.
- Production bootstrap execution requires an operator with a Cloudflare token
  and verified initial Principal; no production action ran in this session.

## Outcome

Ongoing, awaiting human review. Local implementation changes are preserved;
final acceptance and implementation-complete publication remain pending.

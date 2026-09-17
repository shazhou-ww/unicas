# Progress

Updated: 2026-09-16

## Checklist

- [x] Complete and publish all three prerequisite tasks independently.
- [x] Settle core authorization and bootstrap policy with the user.
- [x] Implement persistent deny-by-default admission, authorities, and audit.
- [x] Implement protected platform APIs (list principals, get principal, patch access, access summary).
- [x] Implement email-bound App invitation-limited login and browser/MCP revocation.
- [x] Implement platform invitations, complete Principal detail, and platform audit reads.
- [x] Review and implement unified App Members and Platform People queries/tables.
- [x] Rebuild Console with source-owned shadcn primitives and two-column navigation.
- [x] Remove verified obsolete UI styles and synchronize design/runner documentation (Milestone 7).
- [x] Validate local bootstrap/migration tests, workflows, scoped accessibility checks, and repository gates.
- [x] Complete operator production cutover and real-provider verification in [UserAcceptance](./UserAcceptance.md).
- [x] Publish implementation completion after required reviews and remaining acceptance checks.
- [x] Obtain explicit human delivery acceptance.
- [x] Publish archive as a separate final integration.

## Current state

Ownership transferred from `copilot-unicas-standalone` to
`scottwei-home-pc` on 2026-09-16 at the requesting user's explicit direction.
The transfer is published as `d16ddb7` and verified on `origin/main`. Product
implementation and production release state are unchanged by this ledger-only
handoff.

Operator acceptance resumed on 2026-09-16. The production Console rendered its
restricted login page and redirected through the configured real Google OIDC
provider to the account identifier prompt. No identity or OAuth values were
recorded. The user must now complete authentication directly in the browser;
after the Console returns, continue UserAcceptance steps 3 through 5 and record
only non-secret results.

The initial administrator subsequently completed real Google login. Production
Console showed the expected App membership, App creation control, and Platform
Administration entry. After refreshing an expired local CLI session through
the production PKCE flow, live `principal`, App listing, and protected platform
access listing passed. The repository stdio MCP server exposed 47 tools and a
live `get_current_principal` call returned the same effective authorities. No
production mutation was made by these checks.

Testing an unentitled secondary account is blocked in the VS Code embedded
Electron browser: Google rejects that browser before returning to UniCAS with a
generic JavaScript-disabled message. An in-page check confirmed JavaScript is
running; this is not an UniCAS admission result. Next: use ordinary Chrome or
Edge to sign in as the secondary account at the production Console and report
whether UniCAS denies admission. Do not treat the Google rejection as a pass.

The secondary-account checks subsequently completed in an ordinary browser.
Before invitation, Google returned successfully to UniCAS and the Console
redirected to `/admin/auth/login?error=access-denied` without creating a session.
An email-bound App invitation was created and accepted; the Principal gained
exactly one App membership, remained at zero platform authorities, and saw
neither App creation nor Platform Administration in the Console. The same
Principal's stdio MCP session could read its membership but received
`PLATFORM_ADMIN_REQUIRED` for platform listing and
`APP_CREATION_AUTHORITY_REQUIRED` for App creation. No unauthorized App was
created. Removing the membership changed effective access to `no_access`; the
next requests from both the pre-existing browser and MCP sessions were denied.

This live revocation exposed a production ETag transport defect. Cloudflare
Brotli changed the App revision ETag from `"1"` to `W/"1"`, and the CLI then
correctly encountered `If-Match header is malformed` because mutation inputs
require strong ETags. The admin client now normalizes only transfer-weakened
numeric revision ETags, and BFF revision responses use
`Cache-Control: no-store, no-transform` to preserve the API's strong-ETag
contract at the edge. The denied-login page now renders an explicit
No management access state with a Sign in with another Google account action
for both legacy allowlist denial and persisted platform-access denial.

Validation for this follow-up passes: 17 admin-client tests, 46 admin-CLI tests,
247 service-cloudflare tests, affected package typechecks, the Cloudflare
production build, focused 63-test BFF/adapter checks, editor diagnostics, and
`git diff --check`. The source fixes are published as `c171901` and verified on
`origin/main`, deployed as `production-20260916-108`, and verified through the
denied-account page and a compressed App read's strong ETag.

The follow-up was merged from `main` to `release` by
[PR #3](https://github.com/shazhou-ww/unicas/pull/3) as `19dd7ef`. Production
[run 35099365111](https://github.com/shazhou-ww/unicas/actions/runs/35099365111)
attempt 1 passed validation, deployment, canonical smoke, all public-origin
checks, and production tagging. The deployed revision is tagged
`production-20260916-108`. Direct post-release checks confirmed the denied
account page renders No management access with a Sign in with another Google
account action. An authenticated App read returned strong ETag `"1"` with
`Cache-Control: no-store, no-transform`; the edge did not compress or weaken it.

On 2026-09-16 the user explicitly waived establishing a second Platform Admin
for now and asked to close the remaining work. This replaces the earlier
deferral blocker; the deployed system retains one verified Platform Admin and
the documented recovery procedure. Production audit reads confirmed one denied
App-creation event plus invitation-created, invitation-accepted, and
member-removed events, with no invitation token fields exposed. All Task
acceptance criteria and the operator procedure now pass with that recorded
operational waiver. The implementation-complete milestone is ready to publish;
delivery acceptance remains a separate decision after publication.

After implementation-complete publication, the requesting user explicitly
accepted the current delivery and authorized archival on 2026-09-16. This
acceptance includes the recorded decision not to establish a second Platform
Admin for now. The delivery decision must be published while the task remains
ongoing before the separate archive integration.

### Production reset and release

Reset execution completed on 2026-09-16 and supersedes the initial preflight
blocker below. The user explicitly waived backup and selected both authorities.
The validated [one-time reset script](./reset-production.mjs) matched the
browser-verified Google identity in memory, deployed a maintenance Worker,
verified maintenance on both origins, removed 4 R2 objects (413 bytes), dropped
all 21 old application tables, and rebuilt current tables from source migrations.
All reconstructed application tables were verified empty before seeding. KV was
empty; all 7 DO instances reported no stored data through fully paginated reads.
Fresh seed verification returned one active administrator with both authorities,
one bootstrap audit event, one smoke App/member fixture, and zero sessions.
No backup was made, no invitation was created, and no old profile/session or
file content was retained. The existing public smoke issuer configuration was
re-established for the CI fixture; it is not an old business-data restore.

Preparation was published as `1eeb12a`. The normal release promotion is
[PR #2](https://github.com/shazhou-ww/unicas/pull/2). A history-only merge of the
previous release into main (`25baf19`) satisfies the up-to-date branch rule.
GitHub auto-merge is disabled; the PR was merged normally after required checks
passed. No branch-protection bypass or force push was used.

Production release completed at `955ec4c9690d820966c5aae942a1223a554c275d`, tagged
`production-20260916-99`. [Release CI run 35077282282](https://github.com/shazhou-ww/unicas/actions/runs/35077282282)
attempt 1 uploaded the service but failed its first edge health assertion with
HTTP 503. A subsequent uncached health read returned HTTP 200 with the expected
UniCAS payload and no maintenance marker, consistent with transient deployment
propagation. The original run's failed jobs were retried without code changes
or bypassing smoke. Attempt 2 passed validation, canonical smoke, all three
Worker deployments, all four public-origin checks, and the production tag job.
Maintenance has ended. The production Console reload showed the expected login
page because the reset removed old sessions.

Next: the user logs in again with the verified Google account and completes the
remaining real-provider acceptance checks in [UserAcceptance](./UserAcceptance.md).
Do not mark invitation/revocation, CLI/MCP, or final human delivery checks as
passed solely because CI succeeded. Keep the task ongoing until those gates
and the separate completion/archive publications are satisfied.

#### Reset preparation history

On 2026-09-16 the user explicitly authorized clearing all current production
data because the system is not yet in use. Scope is the `unicas.work`
deployment's D1, R2, OAuth KV, and Durable Object state, not the frozen legacy
environment or preview resources. The user proposed rebuilding tables and
issuing an invitation. Invitations still require an existing Platform Admin;
the first administrator must be bootstrapped from a verified immutable identity.
The designated Google account was verified through the authenticated production
`/admin/me` response without recording its identity values here.

Preparation is read-only so far; no production reset, bootstrap, invitation,
or release has been executed. The agent committed to presenting the actual
deletion inventory for final confirmation after backups. The existing
`reset-smoke.mjs` is explicitly pre-cutover Stack/Tenant-only and must not be
used against current App/Space production. Next: inventory all bound stores,
establish a verified off-machine backup destination and a supported Durable
Object reset path, and plan smoke-fixture recreation before any deletion.
The user subsequently explicitly waived backups because all existing data is
test data, requested direct cleanup, and selected both `platform.admin` and
`apps.create` for the verified account. This overrides the normal backup step
for this one disposable-data reset only; no backup or restore guarantee is
claimed. Read-only inventory found 13 control tables, 8 data tables, 4 R2
objects totaling 413 bytes, and zero OAuth KV entries. Paginated DO inventory
ended on empty pages: 4 CAS instances and 3 domain instances, all reporting no
persistent storage. The implementations use D1/R2 and in-memory coordination.
The reset must recreate the public smoke App/issuer fixture required by CI,
invalidate old sessions, and bootstrap the verified account before release.

### Initial release preflight (resolved)

On 2026-09-16 the requesting user accepted the management Console ("剩下的都没问题")
and explicitly requested a release, while deferring remaining Playground layout
polish to [the backlog task](/tasks/backlog/replace-playground-with-reference-app/Task.md).
This is approval of the current delivered scope/interface/model/architecture
and implementation at `8ef3391`, not retrospective permission for earlier work
and not evidence that production cutover or real-provider tests passed.

The latest main CI passed at `8ef3391`:
[CI run 35074846616](https://github.com/shazhou-ww/unicas/actions/runs/35074846616).
The remote release branch is still at `cf01559d8ba9604399fa3a516760241b63900beb`.
Release is triggered by a push to `release` (or workflow dispatch on that ref),
after the workflow's validation job succeeds.

Read-only production D1 preflight found `cas_apps` and `cas_app_members`, but
no `cas_platform_principals` table. Therefore no initial Platform Admin has
been provisioned in that table. The enforcing Worker must not be released
before the runbook bootstrap, or administrators could lose Platform Access
management and App-creation authority. The preflight returned schema names
only; no Principal values or credentials were read or written.

At this initial preflight, release had not been triggered and bootstrap was
required. The subsequent explicit disposable-data reset and backup waiver,
verified immutable-identity bootstrap, and successful production release above
resolve that blocker. No administrator identity was inferred from email.

The installed repoledger CLI does not implement `status`; backlog and ongoing
positions were inspected directly as the documented fallback. Concurrent task
skill updates remain outside this release checkpoint and are not staged.

The implemented Console and local validation are complete. This cleanup removes
the remaining verified legacy CSS groups and reconciles documentation; it does
not add features, execute a release, or satisfy human acceptance automatically.

### Cleanup checkpoint

- Removed unused brand-section, concept-guide/list, inline-form, old invitation
  list/confirmation, file-root-actions, file-manager-shell/upload, and stack-list
  selectors. A source/template search found no consumers outside generated CSS.
  The existing boundary test now prevents these groups from returning. Login
  template styles and active file manager rules remain unchanged.
- Synchronized [UiDesign](./UiDesign.md) with Members/Change Logs naming,
  unframed log tables, no Platform statistics, sidebar inline App creation,
  starter state, right-side mobile Sheet, and the actual component ownership.
  The original HTML mock remains historical evidence, not the current UI contract.
  [ApiDesign](./ApiDesign.md) now records the previously settled policy decisions
  and actual unified-query publication rather than describing them as open work.
- [acceptance-runtime.mjs](./acceptance-runtime.mjs) now finds the workspace
  by walking ancestors for the workspace manifest and runtime module. It no
  longer depends on ongoing-task directory depth. An executable assertion check
  passed for ongoing, archived, backlog, and missing-root cases without moving
  the task, starting a server, or generating credentials.
- Cleanup validation passes: all 85 WebUI tests, explicit source/test/config
  `tsc --noEmit`, Worker/UI production build, and focused task policy checks.
  Built CSS decreased from about 52 KB to 50 KB. The edited stylesheet, boundary
  test, and runner have no editor diagnostics. Existing Vite build warnings are
  unchanged. Concurrent skill-installation/lockfile edits are outside this
  checkpoint and are preserved without staging them.

### Remaining work

1. Complete authorized production/real-provider checks in
   [UserAcceptance](./UserAcceptance.md). Local mock and schema tests do not
   establish production cutover success. No production action is authorized
   implicitly by task execution.
2. Current implementation review is accepted in the explicit release request
  above, with Playground layout polish deferred. Complete the production
  preflight/bootstrap before triggering that release; approval is not a test result.
3. Publish the formal implementation-complete milestone once its required gates
   are met, obtain explicit final delivery acceptance, and archive in a separate
   integration. Keep this task ongoing until then.

Known validation limits: native OS download-save completion was not observed
in the integrated browser; reconstructed filename and bytes were verified.
Axe scans and keyboard/focus tests are scoped checks, not comprehensive assistive
technology certification. Build warnings for sourcemaps and bundle size remain
non-failing. The running 8892 and 8992 instances are build snapshots; local
cleanup does not silently replace their data or signing material.

## Historical execution evidence

Entries below retain their original sequencing and test counts. Any historical
"next action", "pending", or "local" statement is superseded by Current state
above and the Publication milestones table; do not use it as a current todo.

### Issuer and editor follow-ups

Desktop issuer follow-up: inspecting the running 8892 acceptance Worker confirmed
it still served the legacy `issuer-url-copy` markup, not the updated CopyBubble.
Preserved that instance and its temporary data. The acceptance launcher now
supports `UNICAS_ACCEPTANCE_PORT` (default 8892, plus two adjacent runtime ports)
so a second independently isolated preview can run without replacing the first.
Rebuilt the Worker and started the current UI on 8992 with mock OIDC and fresh
temporary data. At 1440px, the actual built Overview has no legacy copy button,
an 8px label/bubble gap, and no page overflow; the desktop screenshot was
inspected without API-response or CSS overrides. A synthetic App was created
only in this new local instance. Copy click was initiated, but no toast outcome
was recorded before navigation changed; its success/error behavior remains
covered by the preceding eight issuer tests, not claimed as a new browser pass.
Worker build and launcher syntax checks pass. Original 8892 remains an old
snapshot; latest preview is `http://127.0.0.1:8992/admin/`.

Managed issuer layout follow-up: replaced the legacy `issuer-url-copy` button,
icon, timer, and inline copy-status state with the shared `CopyBubble`. Label
and URL now form a min-width-safe vertical group with an 8px gap, and long URLs
wrap inside the bubble. Existing issuer activation controls are unchanged.
All eight Issuer tests and WebUI source/test/config `tsc --noEmit` pass, covering
mouse/keyboard copy, shared success/error notifications, and issuer toggling.
Development-browser layout checks at 1280px and 375px used a read-only managed
issuer response fixture; the mobile screenshot has no overlap/page overflow.
The fixture was removed and no issuer state changed. The running 8892 built
acceptance snapshot was deliberately not restarted or cleared; these latest UI
changes require a rebuild/restart there before appearing in that snapshot.

Checklist reconciled with published evidence in `4827425`: Console rebuilding
and local technical checks are complete. Production verification remains separate
from local validation; formal completion publication, human delivery acceptance,
and archival are not implied by a validated partial checkpoint.

Editor warning follow-up: workspace CSS custom data now registers Tailwind 4
`@theme` and `@custom-variant`. VS Code reports no diagnostics in the stylesheet
or the two editor configuration files. CSS validation remains enabled; no global
unknown-at-rule suppression or runtime stylesheet change was used.

#### Enabled Playground acceptance, 2026-09-16

The typecheck changes were committed as `46e01cb`, pushed, and verified on
refreshed `origin/main`. The preceding Console refinement checkpoint is
`11dc74a`, also published. This section supersedes earlier statements that
enabled Playground or mobile creation have not been exercised.

- Added [acceptance-runtime.mjs](./acceptance-runtime.mjs). From the repository
  root, first build `@unicas/service-cloudflare`, then run this module with Node.
  It starts the built Console at `http://127.0.0.1:8892/admin/`, uses mock OIDC
  on 8893, creates a unique OS temporary database directory, and generates the
  managed-issuer private key only in process memory. SIGINT/SIGTERM disposes the
  runtime and removes its own temporary directory. Do not use production secrets.
- Initial `node --input-type=module -e` attempts stalled at Miniflare's D1 binding
  proxy before bootstrap and consequently denied login. Normal `.mjs` execution
  initialized correctly. Temporary diagnostic logs were removed; the shared
  local runtime has no probe changes. No authentication bypass was introduced.
- Real 375px browser flow passed: mock login, sidebar plus, name entry, inline
  confirm, newly allocated App detail navigation, drawer closure, and membership
  refresh. All created records belong only to the temporary acceptance database.
- Real managed-issuer disable/enable correctly disabled/enabled Playground.
  Created a Documents root, uploaded a synthetic 26-byte text file, created an
  Archive directory, reloaded the page, and reopened the root with both entries
  intact. Capability issuance and the actual CAS read/write path succeeded.
- The download handler reconstructed the original filename and byte-for-byte
  text payload. The integrated browser did not emit a native download completion
  event, so a temporary anchor/object-URL probe verified the actual reconstructed
  blob instead and was restored afterward. OS save-dialog completion is not
  claimed. Partial selection reported `aria-checked=mixed`; real Usage returned
  four nodes and no pending/reserved content. Confirmed GC completed with zero
  deletions because the test nodes remained protected.
- Enabled-page axe scans exposed low contrast in the Personal Space status
  and sorting headers. Both now use `--muted-strong`. Missing pathbar/toolbar
  flex rules were restored with responsive wrapping. Production CSS builds;
  the isolated page was rechecked using the actual Vite-compiled stylesheet.
  At 375/768/1280/1920px, the populated Playground had no page overflow and no
  WCAG A/AA axe violations. Desktop and mobile screenshots were inspected in
  this session; they are not committed screenshot artifacts.
- Final checks pass: `pnpm test` (including 85 WebUI, 247 Cloudflare, 117 service,
  93 admin-protocol, and 16 admin-client tests), `pnpm typecheck` (including
  WebUI `tsc --noEmit`), `pnpm build`, Worker Wrangler deploy dry-run, product
  site dry-run, documentation build/dry-run, and `git diff --check`.
  Non-failing Vite sourcemap/chunk-size warnings remain. The editor's generic
  CSS validator does not recognize Tailwind 4 at-rules; Vite compilation passes.

Next action: operator review/verification of the production cutover procedure
in [UserAcceptance](./UserAcceptance.md), plus the explicit outstanding human
review decisions and final delivery acceptance. Do not execute production
bootstrap/deployment automatically, mark production criteria passed, or archive
based on this local validation. The prior broader review gates remain pending;
the focused unified-query approval is already recorded below.

Type-check coverage follow-up: added WebUI `tsconfig.test.json` covering `src`,
all `tests`, and `vite.config.ts`, with noEmit enabled. The standard package
typecheck now runs `tsc -b && tsc --noEmit -p tsconfig.test.json`, so root/CI
typecheck includes this coverage. The full check exposed six Element/HTMLElement
errors in four issuer-test selectors, now corrected with typed HTML div queries;
also fixed the no-argument mock that inferred an empty call tuple. Direct
`pnpm --filter @unicas/admin-webui exec tsc --noEmit -p tsconfig.test.json`
and root `pnpm typecheck` pass, eight focused Issuer tests pass, and the editor
reports no errors. Other packages retain their existing typecheck scopes; this
does not claim new all-test coverage for every package. Changes remain local.

Earlier type-diagnostic follow-up: removed unsupported `exact` options from Testing
Library ByRole queries in four WebUI test files; string `name` matching remains
exact. The App PATCH fake now reads from a typed, non-null local parsed payload
before retaining it for assertions. Editor diagnostics are clear for all four
files and their 55 tests pass. At that point the WebUI typecheck included only
`src`; the subsequent no-emit test configuration above closes that coverage gap.
These follow-up edits are local, after published refinement commit `11dc74a`.

#### Checkpoint on 2026-09-16

This record accompanies the user-requested commit of the Console refinements
after `5be4ce7`: shared App/Platform headers, Members/Change Logs naming,
unframed log tables, removal of Platform statistics, starter page, inline App
creation with mouse and keyboard controls, sidebar refresh, App-switch draft
isolation, mobile drawer closure, tabpanel semantics, dialog focus restoration,
reduced motion, Playground shared controls, and migration-runbook preconditions.

Final validation of this checkpoint: all 85 WebUI tests across 10 files pass;
WebUI typecheck, production build, and `git diff --check` pass. Known non-failing
Vite sourcemap and chunk-size warnings remain. Earlier whole-repository tests
and browser evidence are retained below with their actual scope; they are not
presented as a new full-repository run for these final UI changes.

Historical next action at that checkpoint (now superseded above):
validate enabled Playground in an isolated runtime using local-only generated
signing material; complete mobile inline creation browser coverage; then run
the remaining release gates. Production bootstrap validation and explicit final
delivery approval are still outstanding. No production operation was run.

The App draft now includes inline confirm (Check) and cancel (X) buttons inside
the input's right edge, with titles and accessible names. Input padding reserves
their space. Focus moving from the input to either button remains inside the
editor and does not trigger blur submission; leaving the entire editor retains
the nonempty-submit/empty-cancel behavior. Mouse cancellation of a named draft
does not create an App, confirmation submits once, and saving disables both
buttons. All 25 draft/starter and shell tests pass; touched-file diagnostics
are clear. Browser screenshot/geometry confirms both 24px controls fit inside
the input with 64px text padding, and real mouse cancellation removes the draft
and restores focus to the sidebar plus. No App was created by that browser test.

Latest creation refinement: the no-selection page is now a minimal starter
message with no duplicate App list, creation form, or extra fetch. The sidebar
plus opens an autofocus draft at the top of the App list. Enter or nonempty
blur creates through the existing API, with duplicate-submit protection and
the same idempotency key on retry, then navigates to the returned App's overview
and refreshes sidebar membership state. Local/server validation errors stay in
an anchored floating hint; failed names remain editable. Escape cancels.
Empty or whitespace-only blur cancels without a request, including after Enter
has displayed the required-name hint. The latter behavior was explicitly
confirmed by the user and covered by three new regressions. All ten draft/starter
tests pass; the preceding shell/navigation run passed 26 tests and typecheck.
Desktop browser inspection verified the starter, top draft, and anchored empty
name hint without creating an App. Mobile creation browser validation remains
pending after a viewport/navigation-trigger wait timed out.

The user asked to continue the remaining task after the UI feedback, then
requested removal of the Platform statistics blocks. The following changes
are implemented locally after the published `0555cc0` checkpoint:

- Both workspaces display Members and Change Logs using the App header style.
  Both log pages are unframed tables, including table-based empty states. URL
  and API identifiers remain unchanged for compatibility.
- Removed Platform Members' statistics blocks and its access-summary request,
  state, and refresh lifecycle. The existing protected statistics API remains
  available to other clients. Eight focused tests pass; browser inspection
  confirms zero statistics blocks/requests, one table, and no page overflow.
- App creation refreshes the sidebar App list and membership count without
  rebuilding the Playground cache session. App membership mutations refresh
  navigation as well. Delayed App-switch regression prevents stale resource
  revisions and unsaved drafts from rendering under another App's route.
- Mobile navigation closes on App/Platform selection and returns focus to its
  trigger. Invite/action dialogs and Principal details restore their opener's
  focus, falling back to the list region when a row disappears.
- Selected route tabs now own actual TabsContent panels. Axe initially found
  dangling aria-controls; after repair, WCAG A/AA scans report zero violations
  on Platform Members, App Overview/Members, both log pages, the App Invite
  dialog, mobile navigation, and Principal detail. These are automated checks,
  not a claim of comprehensive screen-reader certification.
- Foreground browser testing resolved the earlier background-page limitation:
  real Invite clicks, Tab focus containment, Escape focus return, App ID copy
  success toast, mobile route selection/closure, and Principal detail focus
  return passed. Clipboard readback requested extra permission and was cancelled;
  no clipboard contents were read. Reduced-motion computes animation none and
  transition 0s. The 375px Principal Sheet fits the viewport; the navigation
  drawer spans 103..375px.
- Playground buttons, upload trigger, and selection/GC checkboxes now use shared
  primitives. Fourteen targeted workflow tests passed. The default local runtime
  has no managed-issuer signing configuration, so enabled Playground end-to-end
  browser validation remains outstanding; do not equate mocked tests with that
  result.
- The operations runbook now requires a completed App/Space physical cutover
  before Platform Access migration and limits rollback to an App/Space-compatible
  Worker. Auxiliary column renames are not a full Stack/Tenant migration. No
  production operation was performed.
- Before the final statistics removal, `pnpm test` passed all packages, including
  75 WebUI, 247 Cloudflare, 117 service, 93 protocol, and 16 admin-client tests;
  WebUI typecheck and touched-file diagnostics passed. The statistics removal
  has its own focused eight-test/browser verification. A new build/publication
  checkpoint is still pending for this continuation.

Next concrete action: validate an enabled Playground in an isolated local
runtime with generated local-only signing material, then rerun remaining release
gates and update acceptance evidence. Production bootstrap verification and
explicit final delivery acceptance still require the authorized human operator.

Approval on 2026-09-16: after publication of the unified query/UI amendment
as `83beb4b`, the requesting user explicitly directed "你继续去做吧" in
response to the request to proceed with both read contracts. This approves
the focused scope, interface, projection model, and service/D1 ownership in
that amendment. Approval was published as `23d8c52` and verified reachable
from refreshed `origin/main` before implementation. The approved slice is now
implemented and validated locally; broader task delivery acceptance remains
pending.

Latest scope update, 2026-09-16: the user approved the App Members/Invitations
merge ("好的，那就这么调整吧") and requested the same treatment for Platform
Principals/Invitations. Both are now implemented. Source inspection confirmed
duplicate App invitation navigation and independent per-resource pagination.
The attempted App people protocol patch returned unknown outcome; a file check
confirmed it did not land; the implementation was subsequently applied and
validated after the approval checkpoint.

Concrete design artifacts describe both sides:
[unified query contract](./ApiDesign.md#unified-people-query-amendment) and
[unified UI amendment](./UiDesign.md#unified-people-lists-amendment).
Scope/UI intent is accepted for this focused change. Proposed new read APIs,
discriminated rows, cursor/snapshot behavior (including profile updates), and
service/D1 ownership received focused interface/model/architecture
approval as recorded above. Existing membership/grant/invitation writes
and protections remain unchanged; there is no new Principal identity model.

Local implementation is validated but not implementation-complete or approved
for archival. This progress record accompanies a validated partial implementation
checkpoint, including the previously local Platform invitation/audit and Console
work plus the unified people slice. It supersedes the historical notes below;
it does not assert production deployment or final delivery acceptance.

### Unified people delivery

- Added `GET /admin/apps/{appId}/people` and `GET /admin/platform/people`,
  typed client methods, strict query schemas, route matching, and generated
  OpenAPI. Existing CLI/MCP resource tools and all mutation contracts remain.
- `PeopleService` prepares authorization before reading, binds opaque cursors
  to scope/filters/snapshot and an expiry deadline, and rechecks the snapshot
  after reading. D1 uses one `UNION ALL` query to filter/order/page mixed rows.
  Same email and same subject under different issuers remain distinct. Accepted
  invitations are excluded from the default list and retained in history.
- Profile name/email changes now advance the shared control snapshot atomically
  with profile persistence; unchanged profile login does not advance it. App
  invitation expiry uses its existing reconciliation flow. Platform invitation
  expiry uses the existing effective-status projection; the cursor expires at
  the earliest pending invitation deadline. No storage schema migration needed.
- App navigation is Overview, Members, Change Logs, with Playground on the right.
  Platform navigation now displays Members and Change Logs; technical people/audit
  routes remain stable. Both use one shared member table with search,
  filters, refresh, Invite Dialog, receipt copy, conditional revoke, and history.
  App removal uses both identity fields and the App ETag; Principal edits retain
  confirmation, self-block/last-admin errors, revision checks, and membership
  detail. App/platform operations still have distinct authorization paths.
- Removed the duplicate App invitation screen; old member/Principal/invitation
  component exports are thin wrappers over the unified view. Principal editing
  is a separate reusable component. Old App invitation links and Platform
  Principal/invitation links redirect to the appropriate unified filter.
- Validation: `pnpm test` passed the repository and every package (93 protocol,
  16 admin-client, 117 service, 247 Cloudflare, 72 WebUI tests; 114 repository
  tests plus 6 task-policy tests). `pnpm typecheck`, `pnpm check:openapi`,
  `git diff --check`, and the local production UI/Worker build passed.
  Vite retains non-failing sourcemap/chunk-size warnings.
- Tests cover mixed pagination, same-email records, same-subject/different-issuer
  records, history, authority/effective filters, profile-change and expiry cursor
  invalidation, BFF permission separation, secret-free projections, typed client
  queries, invitation receipts/revoke, removal ETags, Principal confirmations,
  App-switch token cleanup, and old-link/keyboard routing.
- Browser: both real endpoints returned 200 with the expected typed rows. Desktop
  screenshots show one table per workspace and no duplicate invitation tab.
  App filter options and Platform Invite Dialog rendered; 375px dialog bounds
  are 0..375 and 768px has no page overflow. Platform's old invitation link
  redirected to `/platform/people?filter=pending`. No real member, grant, or
  invitation mutation was executed during this browser review. Pointer actions
  intermittently timed out on browser stability/animation waits; some rendering
  checks used DOM events/direct links. Full end-to-end pointer acceptance is
  not claimed from those probes.

Platform invitations, Principal filtering/detail, platform audit, typed client,
CLI and remote/stdio MCP surfaces are implemented. The Console uses shared
shadcn primitives with a two-column shell, authority-driven navigation,
Platform tabs, invitation dialogs, and a right-side mobile navigation Sheet.
Operations documentation covers out-of-band bootstrap, allowlist cutover,
rollback, break-glass, and encryption-key retention. No production action ran.

Integration findings fixed during browser verification:

- User requested a checkpoint before making Platform Administration match the
  App visual style. The worktree was already clean at `5be4ce7`, with the
  implementation checkpoint `0555cc0` on `origin/main`; no empty commit was
  created. App and Platform now reuse `WorkspaceDetailHeader`, preserving the
  App title size/spacing, full-width left-aligned line tabs, and selected
  underline. Platform's former title-right button tabs are removed. Shared
  people tables, permissions, filters, and page content are unchanged. All 17
  App-shell/navigation tests pass; touched-file diagnostics are clear. Desktop
  screenshot confirms the shared layout, and 375px geometry has no page overflow.
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

### Earlier validation checkpoint

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

The earlier mobile/Playground, sidebar-refresh, and scoped accessibility gaps
were subsequently resolved in the execution evidence above. Current remaining
work is listed only under Current state.

### Human review state

All five review categories now have a task-specific plan in [Task](./Task.md).
Scope, interface, business/data model, and architecture alignment await the
requesting user's explicit review of the current artifacts and implementation
state. Earlier individual policy decisions below remain evidence only for
those decisions. Delivery acceptance is pending a published final revision and
completion of the outstanding criteria. No retrospective approval is inferred.

The pending review plan was published as `53093dc` and verified on `origin/main`.
Subsequent focused UI fixes were explicitly requested by the user; they do not
constitute blanket approval of the broader task's checkpoints. They are included
in the validated partial checkpoint accompanying this record; the unified-query
amendment has its own explicit approval published as `23d8c52`.

Next action: complete the human-only checks and decisions listed under Current
state. Do not repeat already-passed local checks merely because older chronology
still records them as pending.

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

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user, 2026-09-16: accepted the implemented management Console and release scope, with Playground polish explicitly deferred to backlog. |
| Interface | Approved | Requesting user, 2026-09-16: accepted the Console and requested release; subsequent real-provider Console, CLI, MCP, denied-access, invitation, and revocation behavior passed. |
| Business and data model | Approved | Requesting user, 2026-09-16: accepted independent authorities, immutable Principal identity, invitation-limited access, bootstrap/reset, and revocation behavior; later waived a second Platform Admin for now. |
| Architecture | Approved | Requesting user, 2026-09-16: accepted the released implementation; package boundaries, deployment boundaries, and repository validation passed. |
| Delivery acceptance | Approved | Requesting user, 2026-09-16: after implementation-complete publication `5cfc938` and production tag `production-20260916-108`, explicitly selected “接受并归档”; published as `4f66f37`. |

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | `origin/main` commit `ff3c87e0318d4c30b76111d8cf96302a0b354fba`. | Published |
| Unified people and Console partial checkpoint | `0555cc0`, verified reachable from refreshed `origin/main`; full tests, typecheck, OpenAPI and local build passed. | Published |
| Console refinement partial checkpoint | `11dc74a`; 85 WebUI tests, typecheck, build, and diff checks passed and publication was verified. | Published |
| Test typecheck coverage | `46e01cb`; explicit WebUI no-emit test/config checking and workspace typecheck passed. | Published |
| Enabled Playground acceptance | `4827425`; isolated real CAS workflow, mobile creation, responsive checks, and release gates. | Published |
| Managed issuer CopyBubble and editor integration | `1e97284`; issuer regressions, no-emit check, and built desktop preview verified. | Published |
| Ownership handoff to `scottwei-home-pc` | `d16ddb7`, verified reachable from refreshed `origin/main`. | Published |
| Denied-login guidance and strong ETag follow-up | `c171901`; PR #3 merged as `19dd7ef`; run 35099365111 passed and tagged `production-20260916-108`; direct production page/ETag checks passed. | Published |
| Implementation complete | `5cfc938`, verified reachable from refreshed `origin/main`; all acceptance criteria and operator checks pass with the explicit second-administrator waiver. | Published |
| Delivery acceptance | `4f66f37`, verified reachable from refreshed `origin/main`; explicit acceptance and archive authorization on 2026-09-16. | Published |
| Archive | `origin/main` archive commit containing this record. | Published |

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
- [x] Milestone 3: Port Overview view to shadcn, with copy bubble and metadata grid.
- [x] Milestone 4: Port Members/Invitations to one table and Change Logs to an unframed table.
- [x] Milestone 5: Port Playground controls to shadcn; enabled local workflow/browser checks passed in `4827425`.
- [x] Milestone 6: Platform Administration views with shared navigation and Members/Change Logs presentation.
- [x] Milestone 7: Remove superseded screens/legacy CSS, retain thin public entry wrappers, and guard cleanup with boundary tests.

## Blockers

- The production bootstrap and release blocker is resolved by the reset,
  bootstrap, and successful release recorded under Current state.
- None. The user explicitly waived a second Platform Admin for now and accepted
  delivery. Playground visual polish is intentionally deferred to its backlog task.

## Outcome

Completed. Accepted delivery, published implementation completion, and archived
the task as a separate final integration. All acceptance criteria, production
releases, real-provider checks, and post-release checks are complete with the
explicit second-administrator waiver. Playground layout polish is deferred to
its backlog task.

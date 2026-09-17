# Progress

Updated: 2026-09-17

## Checklist

- [x] Publish the claim to the shared primary branch.
- [x] Obtain scope approval before substantive implementation.
- [x] Complete each applicable interface, business and data model, and
      architecture approval before the affected implementation.
- [x] Commit and publish substantive work at meaningful checkpoints.
- [ ] Publish implementation completion while the task is still ongoing.
- [ ] Complete documented manual user acceptance, if required.
- [ ] Obtain and publish delivery approval.
- [ ] Archive and publish the task as its final action.

## Current state

Claim commit `1b33a29c6ebcc9e7ed66fe273b4ca7c020e43584` initially assigned the
task to `scottwei-home-pc`. On 2026-09-17, the requesting user explicitly
directed `copilot-unicas-standalone` to take over the task. The validated
ledger transfer is published on `origin/main` as
`1db432c0820218ff821f233b322165149eb1d5f5`. The prerequisite
`add-platform-access-management` task is archived with its implementation,
production verification, delivery acceptance, and archive publication recorded.
No backlog or ongoing task has overlapping multi-provider administrator identity
scope, and all other identity lanes are empty.

The claim and its evidence record are published on `origin/main`; refreshed
`origin/main` and local `HEAD` both resolved to evidence commit
`448478c177b4dc78d657649d17225bb1e3633973` before this blocker update.

The requesting user approved the scope review artifact, the canonical
[Task](./Task.md), on 2026-09-16 in direct response to the explicit scope
approval request. This approves its goal, scope, out-of-scope boundaries,
constraints, acceptance criteria, provider set, and prerequisite.

On 2026-09-17, the requesting user explicitly directed this worktree to switch
from the distinct `copilot-unicas-standalone` identity to the device's
`scottwei-office-pc` suggestion. Identity lane reservation commit
`c8185760d18f26672f472b0a16f812835713f3ef` is published on `origin/main`, the
worktree is explicitly bound to the registered identity as required by the
repository policy, and `repoledger doctor` passes. The CLI-validated task
transfer from `copilot-unicas-standalone` to `scottwei-office-pc` is published
on `origin/main` as `8a58b31971d3d6b4ea47eca8bc6dbf1c5eac2dc2`.

Scope approval is published on `origin/main` as
`aa94d2efef95c581dbc67a0493539ed2f42f4ab3`. The task-owned
[business/data-model](./BusinessDataModel.md),
[architecture](./Architecture.md), and [interface](./InterfaceDesign.md) review
artifacts and their pending checkpoint state are published on `origin/main` as
`d3ef9fd44b7c141993d4307a750c39c817cf225a`. They define the stable Account and
evidence model, one-to-one migration and rollback boundary, provider and service
composition, fresh-auth linking/unlinking, Account-keyed contracts,
Console/CLI/MCP behavior, and privacy/error rules.

At the requesting user's direction on 2026-09-17, the business/data-model
artifact now presents the target model as two complementary Mermaid ER views,
and the interface artifact links an illustrative
[before/after HTML prototype](./InterfaceDesign.html) for the Sign in, Account,
and People surfaces. These presentation refinements do not change the reviewed
contracts or imply approval; they are published on `origin/main` as
`24eeb2b04add73bed1ca00b37d988c490e78d0e2` with the checkpoints still pending.

The requesting user subsequently asked for entity lifecycle stereotypes. The
business/data-model ER view now marks Session and MCPGrant as ephemeral
immutable (`<<EI>>`) and AuditEvent, AccountAlias, and LegacyIdentityMap as
append only (`<<AO>>`); all unmarked entities remain mutable. This annotation
refinement is published on `origin/main` as
`72b7b4552a65057755aaadfa850b31acda85f1f9` and does not imply checkpoint
approval.

Further review on 2026-09-17 simplified the proposed model without changing the
task goal or provider scope: Account uses `blockedAt` rather than a general
status, `credentialVersion` is only the credential-revocation generation,
platform authorities are child rows keyed by `(accountId, authority)`, the
Account retains at most one primary verified contact, and new model operations
do not expose generic resource revisions. The canonical Task and all three
review artifacts reflect these decisions and are published on `origin/main` as
`4f02dea51c7da183369141f0eec706c758bb90e0`.

After reviewing the revised direction, the requesting user stated on 2026-09-17
that there were no remaining issues and directed the plan documents to be
committed before iterative implementation under `task-exec`. This explicitly
approves the revised business/data model, architecture, and interface artifacts.
The approval gate is published on `origin/main` as
`3be539500b757a7c3cec4c732a6397b4a31ef0e9`.

The first implementation slice adds strict additive
Account protocol types and schemas while retaining the existing Principal
contracts, a 128-bit `acct_` ID generator, and additive D1 tables for Account,
Profile, ExternalIdentity, AccountPlatformAuthority, AccountAlias, the permanent
legacy identity map, and the migration journal. Existing Principal-keyed tables
and runtime paths remain active. The slice is published on `origin/main` as
`354894e0791e8bc76982920078d0997a20d89135`.

The second implementation slice is complete locally. A cloud-neutral
`AccountService` now owns exact external-identity resolution, bounded/cycle-safe
alias traversal, blocked-account denial, credential-version checks, active
identity ownership, and atomic Account creation without email inference. The
D1 adapter implements the semantic repository against the additive tables; it
is not yet wired into the existing Principal authorization path. The slice is
published on `origin/main` as `aae52af5ba6c514650f2e7135640ac52d8c48f7b`.

The third implementation slice is complete locally. A restartable D1 migration
inventories all legacy Principal-bearing tables without a compound SQL union,
creates exactly one Account and ExternalIdentity per `(issuer, subject)`, and
backfills Account shadow keys, platform-authority child rows, App memberships,
and uniquely derived Playground ownership. Existing audit attribution columns
remain unchanged and resolve through the permanent map. Stage counts and
failures are recorded in the migration journal; reconciliation blocks cutover
for any count, authority, membership, or Playground mismatch. The slice is
published on `origin/main` as `e87c8841dac918ccc91fc179af66a32f8f0c2bcb`.

The fourth implementation slice is complete locally. `@unicas/control-auth`
adds a generic authorization-code + PKCE client that accepts only configured
HTTPS provider endpoints. `@unicas/service` adds the immutable ProviderRegistry,
normalized provider result contract, and fresh invitation-email evidence rules.
Cloudflare adapters now implement Google, Microsoft personal-account, and
GitHub behavior: Google emits evidence only for `email_verified=true`, Microsoft
requires consumers-tenant v2 claims and emits no token-email evidence, and
GitHub keys identity by numeric `/user.id` while accepting only verified Emails
API entries. The adapters are not yet routed from the BFF. The slice is
published on `origin/main` as `309ed44061c8ebe65b96b7a92626f776dbb52453`.

The fifth implementation slice is complete locally. App and platform
invitation admission no longer accepts profile/display email or an
`emailVerified` boolean; both require an exact, unexpired
`VerifiedEmailEvidence` record. Browser/CLI sessions and remote MCP grants carry
Google callback evidence with source, verification time, expiry, and
authentication event. BFF and MCP contexts pass that evidence to the service,
and successful invitation acceptance rotates the session without retaining the
consumed evidence. The slice is published on `origin/main` as
`c6d63fee969ee9c42734a4f36b0d1fda7ecdd849`.

The sixth implementation slice is complete locally. The BFF builds an immutable
registry from Google plus complete optional Microsoft/GitHub credential pairs,
renders only configured choices, and exposes closed start/callback routes while
retaining the legacy Google URLs. Provider, route, state, and continuation are
bound in encrypted pre-login state; CLI accepts only a closed `provider` value,
and multi-provider invitations show a selector without moving the invitation
token into query state. Worker startup runs the one-to-one migration before
injecting `D1AccountRepository`. Provider callbacks now resolve or invitation-
gate creation of a stable Account, store Account/identity/credential-version in
browser and CLI sessions, and revalidate them on each request. Linked providers
share Account admission; stale credentials fail immediately. Invitation
acceptance dual-writes Account ownership/authorities and atomically initializes
only an empty primary verified contact. The slice is published on `origin/main`
as `06393d3f43d7a813427d1d007280f593fc9bb59b`.

The seventh implementation slice is complete locally. `AccountService` and the
D1 repository implement fresh-auth identity linking/unlinking with active-
identity ownership, target conflict, blocked Account, credential-version, and
final-identity invariants. Link inserts one active ExternalIdentity, fills only
empty provider-owned profile values, and increments credential version in one
batch. Unlink requires a different freshly authenticated remaining identity,
closes rather than deletes the target link, clears profile values sourced by it,
and increments credential version atomically. The BFF adds CSRF-protected
two-stage link and guarded unlink routes using encrypted one-time continuations,
then rotates to a session bound to the new credential version. The slice is
published on `origin/main` as `63fcd90c5a39e08baafafbd8198da534b3681e06`.

The eighth implementation slice is published. The administrator v2 protocol
and client now expose Account self, profile update, and linked-identity reads
without generic resource revisions. `AccountService` projects profile,
verified contact, platform authorities, stable avatar fallback, linked login
methods, and configured link choices; the D1 adapter persists field-level user
profile choices. The BFF requires an Account-bound session, strict profile
input, and CSRF for mutations. Link/unlink starts negotiate a JSON redirect for
the Console while retaining redirect compatibility. The user menu opens a
full-width Account view with profile editing, read-only verified contact,
provider rows, fresh-auth link/unlink dialogs, and final-identity protection.
The slice is published on `origin/main` as
`46a6381eb61a89f84de87635cde52145e4d30fb6`.

The ninth implementation slice is published. App member list, People, current-
administrator, remove, CLI, and stdio/remote MCP surfaces now project and target
stable Accounts. The v2 remove command accepts only `accountId`, is idempotent,
does not use an App revision, and atomically enforces actor membership and the
last-member invariant while writing Account-attributed audit evidence. Ordinary
member payloads and search text no longer expose or index exact issuer/subject.
The shared `/admin/me` response is Account-first while retaining deprecated
Principal/Profile aliases, and `unicas account` plus `get_current_account`
provide identity-safe replacements. Legacy v1 Stack member commands retain
their identity locator during the compatibility period. The slice is published
on `origin/main` as `e0a852a1eba092a1af23ee9bed441ed95b16c0f8`.

The tenth implementation slice is published. Platform People, list/detail,
Console, CLI, stdio MCP, and remote MCP now use Account summaries and IDs.
Final v2 contracts expose idempotent single-authority grant/revoke and Account
block/restore commands without whole-set replacement, ETags, or Principal
locators; legacy Principal routes remain outside the generated v2 contract.
D1 transactions enforce actor authorization, self-block and last-active-admin
guards, compatibility shadow writes, Account-attributed audit, and idempotent
snapshot changes. Blocking advances `credentialVersion` exactly once. Ordinary
Platform People rows and invitation rows no longer expose exact issuer/subject
or creator identity. The slice is published on `origin/main` as
`da175f65f604133f1511089cbebd99b45153b8d6`.

The eleventh implementation slice is published. App and platform audit
projections, filters, Console views, CLI commands, stdio MCP, and remote MCP now
use stable Account IDs and summaries while retaining the exact authenticated
ExternalIdentity only as privileged immutable event detail. New audit writes
dual-write Account and ExternalIdentity attribution, migration backfills and
reconciles persisted attribution, and historical unlinked identities remain
resolvable. Strict v2 and MCP schemas reject Principal-shaped audit filters.
The slice is published on `origin/main` as
`5aab332e372a537dd89aa99f927368a56c52519b`.

The twelfth implementation slice is in progress locally. Microsoft invitation
callbacks now use an encrypted challenge continuation, six-digit codes,
hash-only D1 persistence, bounded attempts and resends, delivery-failure
invalidation, and atomic App/platform invitation evidence consumption. Worker
composition adds the structured Email binding and hourly expiry cleanup.
Production sender-domain onboarding and real email delivery are not verified.

At the user's request, the in-progress implementation was committed locally
as `fa54fc2`. The repoledger upgrade to pinned version 0.4.1 is committed as
`0b06d58`. A subsequent pull of `origin/main` reported already up to date;
neither local commit has been pushed. `repoledger doctor` now passes, and
`repoledger status` confirms this task remains owned by `scottwei-office-pc`.

Challenge browser and focused regression checks are now complete locally.
The [local browser fixture](./ChallengeFixture.mts) exercises the real BFF,
App compatibility adapter, D1 challenge and invitation transactions with a fake
Microsoft provider and fake email sender. It listens only on loopback and sends
no external email. Run it with `pnpm --filter @unicas/admin-protocol exec tsx
--conditions=development ../../tasks/ongoing/scottwei-office-pc/support-multi-provider-admin-identity/ChallengeFixture.mts`.

The thirteenth implementation slice adds configured Google, Microsoft, and
GitHub MCP login through the existing provider adapters. New grants bind Account,
ExternalIdentity, and credential version; callback, consent, token exchange and
refresh, request admission, and sensitive operations recheck current Account
state. Legacy grants use only the permanent one-to-one map at initial generation
1, and refresh persists the binding without adopting a newer generation.
Production OAuth transactions use encrypted D1 session storage and atomic
consumption. Consent no longer falls back to exposing raw provider subjects.

The validated challenge and MCP checkpoints are published by this integration;
implementation completion and delivery acceptance are still pending. The local
fixture now also exercises provider selection and consent at `/oauth/authorize`.

The fourteenth slice persists legacy browser/CLI session rotation before request
dispatch, checks original CSRF before mutations, preserves remaining expiry in
the atomic rotation, writes Account metadata, and counts successful migrations.
Only the permanent legacy map at initial credential generation is accepted;
partial or mismatched bindings fail closed. Admin client, CLI, and stdio MCP
persist server-rotated cookie/CSRF pairs without replaying mutations.

On 2026-09-17 the requesting user resolved the rollout review with a different
principle: the service is not publicly launched, no legacy should remain, and
existing data may be cleared. [RolloutReview](./RolloutReview.md) now records
pre-launch replacement, superseding both earlier rollout proposals. Previously
implemented compatibility paths are removal work, not completed target behavior.
The principle does not authorize this session to clear unspecified resources.

Next: remove legacy contracts/adapters and identity-keyed persistence from the
affected administrator surfaces, along with dual writes, migration-only state,
and old session/grant upgrades. Update consumers/tests and validate fresh Account
initialization and explicit bootstrap. Do not build compatibility stage flags or
cutover markers. Then complete the current-model and real-provider/email tests.

## Decisions

- Requesting user, 2026-09-17: accepted pre-launch replacement with no retained
  legacy and disposable data. This supersedes earlier decisions below only where
  they require compatibility, preservation of old records, or migration rollout.
  Keep chronology as history; do not mistake prior implementation for target scope.
- Claim the task only after confirming its platform-access prerequisite is
  archived and no active or backlog task overlaps its identity scope.
- Use the repository ledger's documented manual move fallback because the pinned
  `repoledger` CLI supports `doctor` and `check` but does not expose `status`,
  focused `check --task`, or claim mutation commands.
- Treat the canonical `Task.md` as the scope review artifact; task creation and
  this execution invocation are not approval.
- Record the user's direct 2026-09-16 response that the scope has no issues as
  explicit approval of the requested Scope checkpoint only; it does not approve
  review artifacts that have not yet been prepared and presented.
- Treat the user's direct 2026-09-17 takeover request as explicit coordination
  authorization to transfer the task from `scottwei-home-pc` to
  `copilot-unicas-standalone`; it does not approve any pending review checkpoint.
- Treat the user's direct 2026-09-17 identity-switch request as explicit
  coordination authorization to transfer the task from
  `copilot-unicas-standalone` to `scottwei-office-pc`. Keep the required
  worktree-scoped binding; the matching device-global value remains an
  initialization suggestion rather than an identity fallback.
- Split the target ER model into Account/authorization and
  credential/audit/compatibility views after visual rendering showed that one
  13-entity canvas made cardinalities and relationship labels harder to read.
  Repeated Account and ExternalIdentity boxes denote the same entities.
- Keep [Interface](./InterfaceDesign.md) normative. The linked standalone HTML
  is a responsive review aid that compares only the current interaction shape
  with planned information hierarchy and workflows; it is not a final visual
  specification or production Console implementation.
- Render lifecycle stereotypes through Mermaid entity display aliases so the
  model keeps stable identifiers for relationships while showing literal
  `<<AO>>` and `<<EI>>` labels. For `<<EI>>` credentials, rotation creates a new
  record and expiry, revocation, or pruning ends the old record rather than
  changing its Account/identity/credential-version binding.
- Replace Account's generic status with nullable `blockedAt`; future Merge uses
  an immutable AccountAlias rather than a reserved `merged` status.
- Model platform authorities as Account child rows with composite primary key
  `(accountId, authority)`. Project them as `platformAuthorities`, and mutate
  them through idempotent grant/revoke commands rather than a separate
  PlatformAccess aggregate or whole-set replacement.
- Retain at most one primary verified contact and its provenance on Account.
  Fresh invitation evidence remains ephemeral and is the only email input to
  invitation admission; stored contact text never identifies or links Accounts.
- Remove generic revisions from the new Account, Profile, authority, membership,
  and invitation flows. Keep `credentialVersion` solely as the generation that
  invalidates all Account sessions and MCP grants and protects multi-step
  link/unlink operations from stale authentication state.
- Treat the requesting user's direct 2026-09-17 statement that there were no
  remaining issues and that implementation should begin after plan publication
  as approval of the revised business/data model, architecture, and interface
  checkpoints. It does not constitute delivery acceptance.
- Introduce Account persistence additively before changing authorization reads.
  Existing Principal schemas and tables remain available through the migration
  window; the first implementation checkpoint does not infer or link Accounts
  from email.
- Generate Account IDs from 16 random bytes encoded as unpadded base64url,
  producing the approved `acct_` prefix plus 22-character wire value.
- Reconcile the previously stale progress wording with review-artifact commit
  `d3ef9fd44b7c141993d4307a750c39c817cf225a`; publication does not imply approval.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user, 2026-09-16: explicitly responded that there were no issues after being asked to approve or reject the goal, scope, out of scope, constraints, acceptance criteria, provider set, and prerequisite in [Task](./Task.md). |
| Business and data model | Approved | Requesting user, 2026-09-17: after reviewing the Account `blockedAt`, authority child-row, primary verified contact, generic-revision removal, and `credentialVersion` refinements published in `4f02dea51c7da183369141f0eec706c758bb90e0`, stated there were no remaining issues and directed iterative implementation. |
| Architecture | Approved | Requesting user, 2026-09-17: responding to [RolloutReview](./RolloutReview.md), stated the service is pre-launch, no legacy should remain, and data is disposable. This replaces compatibility rollout proposals with direct current-model replacement; it is not delivery acceptance or a specific reset command. |
| Interface | Approved | Requesting user, 2026-09-17: approved proceeding after the revised interface and HTML comparison were published in `4f02dea51c7da183369141f0eec706c758bb90e0`. |
| Delivery acceptance | Pending | Present the integrated revision and complete validation, security/privacy, deployment/rollback, and manual test evidence after implementation publication. |

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | `origin/main` commit `1b33a29c6ebcc9e7ed66fe273b4ca7c020e43584`. | Published |
| Ownership transfer | `origin/main` commit `1db432c0820218ff821f233b322165149eb1d5f5`, coordinated from `scottwei-home-pc` to `copilot-unicas-standalone`. | Published |
| Ownership transfer to `scottwei-office-pc` | `origin/main` commit `8a58b31971d3d6b4ea47eca8bc6dbf1c5eac2dc2`, coordinated from `copilot-unicas-standalone` to `scottwei-office-pc`. | Published |
| Implementation complete | Pending. | Pending |
| Archive | Pending. | Pending |

## Validation

- `pnpm exec repoledger doctor` passed at the repository root after refreshing
  `origin/main`: 16 tasks, full history, and a valid worktree identity.
- The pinned CLI rejected the skill's newer `status` and `check --task` commands;
  canonical positions were inventoried directly and the repository-supported
  full validation was used instead.
- `pnpm check:tasks` passed before the claim: `repoledger check` validated all 16
  tasks and all 6 focused task-policy tests passed.
- Direct inventory found this task only in backlog before the move, one unrelated
  backlog task, no active task in any identity lane, and no move-sensitive
  references to its backlog path.
- The first post-claim `pnpm check:tasks` run rejected a pending claim milestone,
  confirming the ongoing-task publication invariant; this record now uses the
  required immutable claim commit evidence.
- A second pre-publication check rejected claim evidence without a literal
  commit reference, so the move and its evidence are published together as two
  claim-only commits.
- After publication, `pnpm exec repoledger doctor` passed, local `HEAD` and
  refreshed `origin/main` both resolved to
  `448478c177b4dc78d657649d17225bb1e3633973`, the worktree was clean, and the
  final `pnpm check:tasks` run passed all ledger checks and 6 policy tests.
- The scope approval was published as
  `aa94d2efef95c581dbc67a0493539ed2f42f4ab3` and verified reachable from
  refreshed `origin/main` by `repoledger doctor` and `git merge-base`.
- Read-only code research mapped the current Principal/Profile, invitation,
  platform access, membership, Playground, audit, BFF/session, CLI, MCP, D1,
  protocol, client, and Console ownership surfaces before design.
- Current Google, Microsoft personal-account, GitHub OAuth/Emails API,
  Cloudflare Email Service, and Workers guidance was reviewed for the provider
  and platform constraints recorded in the artifacts.
- `pnpm check:tasks` passed after each new review artifact and after the focused
  credential-migration, identity-redaction, and retired-email retention review
  corrections: all 16 ledger tasks and all 6 policy tests passed.
- `pnpm exec repoledger doctor` passed before takeover after refreshing
  `origin/main`; `repoledger status` resolved the task under `scottwei-home-pc`
  and the current worktree identity as `copilot-unicas-standalone`.
- `pnpm exec repoledger check --task support-multi-provider-admin-identity`
  passed before and immediately after the previewed transfer was applied with
  `--take-from scottwei-home-pc --update-all-refs`.
- `pnpm check:tasks` passed before transfer publication: all 16 ledger tasks and
  all 6 focused task-policy tests passed. Transfer commit
  `1db432c0820218ff821f233b322165149eb1d5f5` was then pushed and verified
  reachable from refreshed `origin/main`; the worktree was clean and aligned.
- `pnpm check:tasks` passed before identity lane reservation publication. The
  reservation is published on `origin/main` as
  `c8185760d18f26672f472b0a16f812835713f3ef` and was verified reachable after a
  remote refresh.
- `pnpm exec repoledger doctor` passed after explicitly rebinding this worktree
  to the registered `scottwei-office-pc` identity.
- `pnpm exec repoledger check --task support-multi-provider-admin-identity`
  passed before and immediately after the previewed transfer was applied with
  `--take-from copilot-unicas-standalone --update-all-refs`; the preview and
  apply results reported no blockers, warnings, or reference edits. Transfer
  commit `8a58b31971d3d6b4ea47eca8bc6dbf1c5eac2dc2` was pushed and verified
  reachable from refreshed `origin/main`.
- Mermaid CLI 11.12.0 rendered both revised ER views through the installed Edge
  browser into nonempty PNGs (106,075 and 110,898 bytes); visual inspection
  confirmed legible entity fields, cardinalities, and relationship labels.
- The standalone HTML prototype loaded without editor diagnostics and passed
  Playwright interaction checks for scenario tabs, Microsoft invitation
  challenge, link and unlink dialogs, and the privileged identity-detail
  drawer. The Account-based People table did not contain exact issuer/subject
  data, and a closed drawer was absent from the accessibility tree with focus
  restored to its trigger after closing.
- Playwright screenshots at 1440px desktop and 390px mobile widths confirmed
  the Sign in, Account, and People comparisons had no horizontal document
  overflow, incoherent overlap, or clipped controls. `pnpm check:tasks` passed
  with all 16 ledger tasks and all 6 task-policy tests after the review-artifact
  changes. Review-artifact commit
  `24eeb2b04add73bed1ca00b37d988c490e78d0e2` was pushed and verified reachable
  from refreshed `origin/main`.
- Mermaid CLI 11.12.0 rendered both ER views after adding entity display aliases
  for `<<AO>>` and `<<EI>>`; visual inspection confirmed all five labels were
  preserved literally without obscuring entity fields or relationships.
  Annotation commit `72b7b4552a65057755aaadfa850b31acda85f1f9`
  was pushed and verified reachable from refreshed `origin/main`.
- Focused residual-term scans found no stale `authRevision`, generic Account
  status, multi-email wire collection, separate PlatformAccess aggregate, or
  Account revision-conflict contract in the revised normative artifacts.
- Mermaid CLI 11.12.0 rendered both simplified ER views into nonempty SVGs.
  Editor diagnostics reported no errors in the four revised Markdown files,
  and `pnpm check:tasks` passed all 16 ledger tasks and all 6 policy tests.
- The user-formatted HTML prototype reloaded successfully. Browser checks
  exercised Account profile feedback, unlink feedback, and privileged People
  detail; the revised `blockedAt`, read-only contact, and credential-version
  text rendered without horizontal overflow at 1440px.
- Revised Task, business/data-model, architecture, interface, and HTML prototype
  artifacts were published on `origin/main` as
  `4f02dea51c7da183369141f0eec706c758bb90e0` and verified reachable after a
  remote refresh, with all three protected implementation checkpoints still
  pending in that publication.
- Approval commit `3be539500b757a7c3cec4c732a6397b4a31ef0e9` was pushed and
  verified reachable from refreshed `origin/main`; `repoledger doctor` passed
  before implementation began.
- `@unicas/admin-protocol` passed all 98 tests across 7 files, including 5 new
  Account schema tests, and passed its production/test TypeScript builds.
- The focused Account ID test generated 100 unique values matching the approved
  128-bit `acct_` wire shape.
- The focused Cloudflare schema suite passed all 6 tests, including additive
  Account migration idempotency, composite authority uniqueness, authority
  enum enforcement, and active external identity uniqueness/history behavior.
- The full `@unicas/service-cloudflare` suite passed all 248 tests across 25
  files after the shared control schema change. `@unicas/admin-protocol`,
  `@unicas/service`, and `@unicas/service-cloudflare` all passed typecheck, and
  editor diagnostics reported no errors in the changed implementation files.
- Account foundation commit `354894e0791e8bc76982920078d0997a20d89135`
  was pushed and verified reachable from refreshed `origin/main`.
- The focused cloud-neutral Account service suite passed 6 tests covering exact
  identity resolution without email, blocked and stale-version denial,
  unlinked/cross-Account credential rejection, alias cycles, atomic creation,
  and duplicate identity conflicts. The full `@unicas/service` suite passed all
  124 tests across 17 files and typecheck passed.
- The focused D1 Account repository suite passed 3 Miniflare tests proving exact
  identity round-trip, duplicate active identity rollback without orphan
  Account/Profile rows, and credential-version invalidation. The full
  `@unicas/service-cloudflare` suite passed all 251 tests across 26 files and
  typecheck passed. Editor diagnostics reported no errors in the second-slice
  files.
- Account service/repository commit `aae52af5ba6c514650f2e7135640ac52d8c48f7b`
  was pushed and verified reachable from refreshed `origin/main`.
- The focused identity migration suite passed 2 Miniflare tests proving
  duplicate display emails remain separate Accounts, reruns are idempotent,
  blocked state and authorities are preserved, Playground owners map exactly,
  old audit attribution fields remain byte-for-byte unchanged, and an unmapped
  owner records a failure and blocks completion.
- Legacy schema/People compatibility tests passed after converting the only
  bare control-table test inserts to explicit columns. The full
  `@unicas/service-cloudflare` suite passed all 253 tests across 27 files and
  typecheck passed; editor diagnostics reported no migration errors.
- Legacy identity migration commit `e87c8841dac918ccc91fc179af66a32f8f0c2bcb`
  was pushed and verified reachable from refreshed `origin/main`.
- `@unicas/control-auth` passed all 6 tests across its OIDC and generic OAuth
  suites and typecheck passed. OAuth tests verify pinned HTTPS endpoints, PKCE
  token exchange, and redacted failures.
- The cloud-neutral authentication suite passed 5 tests for closed provider
  selection and fresh, exact-address evidence, including Microsoft challenge-
  only admission. The full `@unicas/service` suite passed all 129 tests.
- Cloudflare provider adapters passed 4 focused tests for Google verified-email
  behavior, Microsoft consumers-v2 validation, GitHub numeric identity and
  Emails API filtering, and provider token/private-email redaction. The full
  Cloudflare suite passed all 257 tests across 28 files; all four affected
  packages passed typecheck.
- Provider foundation commit `309ed44061c8ebe65b96b7a92626f776dbb52453` was
  pushed and verified reachable from refreshed `origin/main`.
- Focused App/platform invitation service suites passed 27 tests after removing
  the display-email authorization path. Focused BFF/session/platform invitation
  suites passed 63 tests with evidence carried through Google browser and CLI
  flows; service and Cloudflare typechecks passed.
- Remote MCP OAuth now issues bounded Google evidence in grant properties and
  validates its full shape at the MCP server boundary. The previously failing
  D1 service and MCP invitation integrations passed with explicit evidence, and
  the full Cloudflare suite passed all 257 tests across 28 files. The full
  service suite passed all 129 tests across 18 files.
- Fresh invitation-evidence commit `c6d63fee969ee9c42734a4f36b0d1fda7ecdd849`
  was pushed and verified reachable from refreshed `origin/main`.
- Provider configuration tests prove optional credentials must be complete
  pairs. BFF tests cover configured-only rendering, fixed start/callback routes,
  route-provider mismatch rejection, CLI provider selection, invitation
  provider selection, linked Google/GitHub Account admission, and immediate
  stale credential-version rejection.
- D1 acceptance tests prove App membership and platform authority rows receive
  Account ownership, an empty primary contact initializes from consumed fresh
  evidence in the same batch, and an existing primary contact is never
  overwritten. Worker composition tests cover migration initialization and
  retry behavior.
- The full `@unicas/service` suite passed all 129 tests across 18 files and the
  full `@unicas/service-cloudflare` suite passed all 261 tests across 28 files.
  Both packages passed typecheck and editor diagnostics reported no errors in
  the provider runtime slice.
- Provider runtime commit `06393d3f43d7a813427d1d007280f593fc9bb59b` was
  pushed and verified reachable from refreshed `origin/main`.
- Cloud-neutral Account tests cover fresh/stale proofs, other-Account conflicts,
  idempotent same-Account links, remaining-identity ownership, final-identity
  denial, and credential-version advancement. The full service suite passed all
  133 tests across 18 files.
- D1 repository tests prove link/unlink history, profile-source precedence and
  cleanup, active identity uniqueness, and version changes. A Miniflare-backed
  BFF test completes Google reauthentication, GitHub link, Google remaining-
  identity reauthentication, GitHub unlink, and session rotations end to end.
  The full Cloudflare suite passed all 263 tests across 29 files and typecheck
  passed.
- Fresh-auth link/unlink commit `63fcd90c5a39e08baafafbd8198da534b3681e06`
  was pushed and verified reachable from refreshed `origin/main`.
- `@unicas/admin-protocol` passed all 102 tests across 7 files, including
  Account endpoint, strict schema, route, OpenAPI, and image-fallback coverage;
  protocol typecheck passed. The regenerated administrator v2 OpenAPI document
  passed all 4 repository drift checks.
- `@unicas/admin-client` passed all 18 transport tests and typecheck.
  `@unicas/service` passed all 134 tests across 18 files and typecheck, including
  Account self projection and field-level profile updates.
- `@unicas/admin-webui` passed all 91 tests across 11 files, test and production
  typechecks, and its Vite production build. Account workflow tests cover
  profile PATCH without revision, configured-only link choices, fresh-auth
  unlink with a remaining identity, and final-login protection.
- The Miniflare Account flow proves self/profile/identity BFF operations and
  JSON-negotiated link navigation before completing link/unlink with session
  rotation. The full `@unicas/service-cloudflare` suite passed all 264 tests
  across 29 files and typecheck passed. Editor diagnostics reported no errors
  in the changed Account implementation files.
- `pnpm check:tasks` passed all 17 ledger tasks and all 6 policy tests before
  publication. Account self-service commit
  `46a6381eb61a89f84de87635cde52145e4d30fb6` was pushed and verified reachable
  from refreshed `origin/main`.
- Account service tests cover snapshot-bound member listing, Account summaries,
  actor authorization, idempotent remove, and last-member denial. The full
  `@unicas/service` suite passed all 136 tests across 18 files.
- Miniflare tests prove Account-keyed D1 projection, atomic remove/audit,
  repeated-remove no-op behavior, BFF routing, Account-only People search,
  shared `/admin/me` enrichment, and stdio/remote MCP list/remove behavior. The
  full `@unicas/service-cloudflare` suite passed all 265 tests across 29 files.
- `@unicas/admin-protocol` passed all 102 tests, `@unicas/admin-client` all 18,
  `@unicas/admin-cli` all 47, and `@unicas/admin-webui` all 91. The v2 OpenAPI
  document was regenerated and all 4 drift checks passed. All 13 workspace
  package typechecks passed.
- `pnpm check:tasks` passed all 17 ledger tasks and all 6 policy tests before
  publication. Account-keyed App membership commit
  `e0a852a1eba092a1af23ee9bed441ed95b16c0f8` was pushed and verified reachable
  from refreshed `origin/main`.
- D1/Miniflare tests prove Account platform list/detail filtering, idempotent
  authority commands, compatibility shadow writes, self-block and last-admin
  denial, block credential-generation advancement, restore, Account-only
  People search, and Account-bound BFF/remote MCP commands.
- `@unicas/admin-protocol` passed all 109 tests, `@unicas/admin-client` all 19,
  `@unicas/service` all 137, `@unicas/admin-cli` all 47,
  `@unicas/admin-webui` all 91, and `@unicas/service-cloudflare` all 266. All
  workspace package typechecks passed; the regenerated v2 OpenAPI passed all 4
  drift checks and the production Console/Worker build passed.
- `pnpm check:tasks` passed all 17 ledger tasks and all 6 policy tests before
  publication. Account-keyed platform access commit
  `da175f65f604133f1511089cbebd99b45153b8d6` was pushed and verified reachable
  from refreshed `origin/main`.
- Account service and D1 tests cover snapshot-bound App/platform audit paging,
  Account actor/target filters, immutable exact identity detail, unlinked
  historical attribution, and migration reconciliation of persisted shadow
  keys. BFF, Console, CLI, stdio MCP, and remote MCP tests cover Account-only
  filters and authorization.
- `@unicas/admin-protocol` passed all 110 tests, `@unicas/admin-client` all 19,
  `@unicas/service` all 138, `@unicas/admin-cli` all 47,
  `@unicas/admin-webui` all 91, and `@unicas/service-cloudflare` all 267. All
  workspace package typechecks passed; the regenerated v2 OpenAPI passed all 4
  drift checks and the production Console/Worker build passed.
- Account-keyed audit commit `5aab332e372a537dd89aa99f927368a56c52519b`
  was pushed and verified reachable from refreshed `origin/main` by
  `repoledger doctor` and `git merge-base`.
- The previously recorded full audit hash was transcribed incorrectly; the
  corrected value above was obtained from `git show -s --format=%H 5aab332`.
- Challenge validation: service suite passed 142 tests; Cloudflare passed 275
  tests across 31 files on rerun. An initial parallel run timed out the existing
  30-second link/unlink test; its isolated rerun and subsequent full run passed.
  Workspace typecheck, docs checks (3 tests), Console/Worker production build,
  and actual `wrangler deploy --dry-run` passed. The deployment planner only
  prints commands; it is not the Wrangler dry-run validation.
- A focused D1 rerun passed 4 tests after binding verification's compare-and-set
  to the code hash, including a deterministic resend-versus-verify race.
- The aggregate resend-budget regression initially reproduced a bypass; resend
  now checks the same cross-callback send window inside its atomic UPDATE.
  D1/BFF/platform invitation regressions passed all 63 tests after the fix.
  A test-only invitation deadline was extended beyond the simulated resend
  interval to remove a 60-second expiry-boundary flake.
- Browser inspection at 1440px desktop and 390px mobile widths verified the
  actual challenge page, masked destination, invalid-code feedback, focus, and
  layout. The full browser flow verified the challenge, accepted the invitation,
  displayed `fixture-app`, and obtained HTTP 200 from `/admin/me` without
  horizontal overflow. Fixture routing includes the production compatibility
  adapter; initial fixture-only asset/routing omissions were corrected.
- MCP Account/provider tests cover Google compatibility, Microsoft/GitHub
  callbacks, route/provider mismatches, consent-time credential revocation,
  request-time admission/authority checks, safe legacy mapping, and concurrent
  D1 transaction consumption. The complete Cloudflare suite passed 282 tests
  across 31 files after moving SQL into the existing storage/migration adapters.
- MCP browser fixture checks at 1440px desktop and 390px mobile verified Account
  labels without raw subject, focus, and non-overflowing consent/selector layout.
  Microsoft and GitHub consent both reached the mock client completion endpoint.
  No real provider credentials or external email were used.
- Production Console/Worker build, Cloudflare typecheck, docs checks (3 tests),
  and actual Wrangler deployment dry-run passed. Session-cleanup follow-up tests
  passed 15 checks covering Worker routing and persisted session expiry/pruning.
- Session rotation validation passed: full Cloudflare suite 283 tests across
  31 files, admin client 20 tests, CLI 48 tests, and all workspace typechecks.
  Tests cover one-winner D1 rotation, preserved expiry, migration counts,
  Account metadata, old-cookie invalidation before mutations, original CSRF
  validation, stale-generation denial, and client/CLI persistence.

## Blockers

The navigation task owner's remote link, approval, and archive corrections were
merged without rewriting its decisions. The only remaining pre-push diagnostic
was archive publication reachability for an ancestor of the local merge; this
integration publishes that ancestry and must be verified with `repoledger doctor`
after push. No additional task-policy test has been restored.

The architecture decision is resolved by [RolloutReview](./RolloutReview.md).
The earlier unrelated ledger publication blocker has been resolved and verified
by successful repository-wide `repoledger doctor` and `pnpm check:tasks` runs.

Production provider registration, sender-domain onboarding, and real email
delivery remain unverified. No production deployment was performed. The task
remains ongoing until the remaining migration/rollout work and acceptance pass.

## Outcome

Pending.

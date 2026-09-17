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

Next: publish the fresh-evidence checkpoint, then switch BFF login, CLI, and
callback routes to the configured provider registry.

## Decisions

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
| Architecture | Approved | Requesting user, 2026-09-17: approved proceeding after the revised architecture was published in `4f02dea51c7da183369141f0eec706c758bb90e0`, including command-shaped authority changes and credential-version revocation. |
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

## Blockers

None.

## Outcome

Pending.

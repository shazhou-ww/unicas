# Progress

Updated: 2026-09-17

## Checklist

- [x] Publish the claim to the shared primary branch.
- [x] Obtain scope approval before substantive implementation.
- [ ] Complete each applicable interface, business and data model, and
      architecture approval before the affected implementation.
- [ ] Commit and publish substantive work at meaningful checkpoints.
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
refinement awaits publication and does not imply checkpoint approval.

Next: obtain explicit business/data-model, architecture, and interface
decisions on the published review artifacts. Do not begin the implementation
protected by any pending checkpoint.

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
  changing its Account/identity/revision binding.
- Reconcile the previously stale progress wording with review-artifact commit
  `d3ef9fd44b7c141993d4307a750c39c817cf225a`; publication does not imply approval.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user, 2026-09-16: explicitly responded that there were no issues after being asked to approve or reject the goal, scope, out of scope, constraints, acceptance criteria, provider set, and prerequisite in [Task](./Task.md). |
| Business and data model | Pending | Review [Business and data model](./BusinessDataModel.md): Account, ExternalIdentity, VerifiedEmail, Profile precedence, relationship ownership, evidence freshness, future Merge aliases, one-to-one migration, session/grant transition, rollback boundary, retention, and redaction. Explicit user or delegated identity/security-owner approval is required before protected model work. |
| Architecture | Pending | Review [Architecture](./Architecture.md): provider adapters, `control-auth`, cloud-neutral service ports, D1/Email bindings, BFF/MCP composition, account resolution, linking state machines, revocation, deployment stages, and compatibility. Explicit user or delegated architecture-owner approval is required before protected structural work. |
| Interface | Pending | Review [Interface](./InterfaceDesign.md): Account wire types, Account-keyed relationship routes, provider selection/callbacks, Console account flows, CLI/MCP presentation, compatibility sunset, errors, and privacy. Explicit user or delegated product/API-owner approval is required before protected interface work. |
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

## Blockers

- Business/data-model, architecture, and interface approvals are pending. Do not
  begin implementation protected by those checkpoints until the published
  artifacts receive explicit decisions and those decisions are published.

## Outcome

Pending.

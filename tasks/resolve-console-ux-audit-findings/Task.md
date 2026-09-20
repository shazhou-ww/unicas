# Resolve verified Console UX audit findings

Created: 2026-09-20

## Goal

Make the signed-in UniCAS Console's core administration workflows usable and
self-explanatory at 375px, 768px, and 1280px widths, with primary information
and actions reachable without page-level horizontal scrolling, obscured
content, ambiguous state, or raw backend errors.

## Context

A read-only Chromium walkthrough of the production Console at
<https://console.unicas.work/admin/> on 2026-09-20 used an existing platform
administrator session. It covered the no-selection home, mobile navigation,
App Overview, App Members, App Change Logs, Administration Members,
Administration Change Logs, Account, invitation and account-detail overlays,
and Connect AI tools. Measurements below are CSS pixels from the rendered
production UI.

The walkthrough found these reproducible issues:

- **P1 - Audit data is not usable responsively.** At a 370px browser viewport,
  the platform Change Logs table was 1032px wide inside a 323px viewport and
  exposed only Time plus part of Action. Its horizontal scrollbar appeared
  after all 12 rendered rows, so Actor, Target, Result, and Request required a
  full vertical traversal before horizontal navigation. At a 1284px viewport,
  the same screen made the whole document 1368px wide and placed content
  outside the page viewport.
- **P1 - Mobile navigation obscures work and regresses its intended
  hierarchy.** The fixed bottom-right navigation trigger overlays fields,
  cards, table rows, and dialog backdrops on long pages. In the open mobile
  drawer, the profile block follows the App list instead of remaining anchored
  to the bottom. The Create App control measured 24 by 24px, the drawer close
  control 16 by 16px, and the floating navigation control 40 by 40px.
- **P1 - A recoverable issuer failure is presented as a dead end.** App
  Overview rendered the raw `NOT_FOUND` code under Managed issuer while the
  related issuer controls were disabled, without explaining the failed
  resource, cause, permission/configuration state, retry, or next action.
- **P2 - People tables hide context and actions on narrow screens.** At 370px,
  the App Members table was 538px wide and the Administration Members table
  was 686px wide inside 338px containers. Dates, authorities, and row actions
  were off-screen, with no persistent row identity, action column, or cue that
  more content was available. Platform account names looked like plain text
  even though they were the only detail affordance, and their hit areas were
  about 20px high.
- **P2 - Filter and action layouts lose hierarchy across widths.** At a 1284px
  viewport, Administration Members placed Refresh and Invite alone on a second
  line at the far right. Narrow layouts spread related filters and actions
  across three lines without a clear primary sequence. The `Current` people
  filter also mixes Accounts/Members, Pending invitations, and Invitation
  history under a label that does not explain that it changes work queues.
- **P2 - Loading, empty, and failure states are visually inconsistent.** People
  views show `Loading people...` together with an empty table frame, platform
  Change Logs substitutes one text line for the data region, and App Change
  Logs uses low-contrast skeleton rows. These states are easy to confuse with
  an empty result and do not consistently offer retry or preserve context.
- **P2 - Sensitive account and invitation actions lack decision context.** The
  App invitation dialog does not explain what leaving `Email constraint
  (optional)` blank authorizes before enabling Create invitation. Account
  details use a generic title rather than the selected identity, expose raw
  authority codes without plain-language effects or an explicit save/immediate
  application model, and show an empty `App Memberships (0)` section without
  guidance.
- **P2 - Account identity state contradicts itself.** The active Google login
  method was labeled `Current session` and `Last used Never` at the same time.
  The disabled Unlink action had no visible or assistive explanation. Profile
  and audit filter inputs also lacked useful `name` and `autocomplete`
  metadata.
- **P3 - First-use and integration guidance are unnecessarily hard to scan.**
  The no-selection home leaves most of the work area empty and tells users to
  `use +` without a visible Create App label. App Overview becomes a long stack
  of explanatory cards on mobile. Connect AI tools puts two long instruction
  blocks into independently scrolling code regions on desktop and an internally
  scrolling dialog on mobile, while alternating between `MCP prompt` and
  `Configuration prompt` terminology.

The existing `adopt-admin-webui-query-cache` backlog task owns cached App and
issuer reads, background revalidation, and replacement of blocking App
navigation loads. This task owns the interaction, responsive presentation, and
state communication findings above; it must coordinate with that task rather
than duplicate its data-fetching work.

## Scope

- Redesign the responsive presentation of App and platform people/audit data so
  each record's identity, important state, and available actions remain
  understandable and reachable at supported mobile, tablet, and desktop widths.
- Prevent page-level horizontal overflow and avoid controls whose horizontal
  scrollbar is reachable only after traversing a long vertical result set.
- Recompose people filters, refresh/invite actions, and audit filters into clear
  responsive groups with stable ordering and appropriately prominent primary
  actions.
- Keep the mobile navigation trigger from covering page or overlay content,
  restore the bottom-anchored profile block in the mobile drawer, honor safe
  areas, and provide at least 44 by 44px touch targets for primary mobile
  controls.
- Replace raw or ambiguous issuer, people, and audit loading/error/empty states
  with distinct, accessible messages that identify what happened and offer an
  appropriate retry or next step. Coordinate App/issuer fetch lifecycle changes
  with the query-cache task.
- Clarify App invitation constraint consequences, platform account identity and
  authority effects, mutation timing, empty membership state, linked-login
  activity, and unavailable identity actions without changing their underlying
  authorization semantics.
- Improve the no-selection home, App Overview information hierarchy, and
  Connect AI tools presentation so the next action and key information are easy
  to scan without relying on symbol-only instructions or nested two-axis
  scrolling.
- Add focused accessibility and responsive browser coverage for the affected
  workflows, including keyboard focus order/return, accessible action names,
  form metadata, loading/error announcements, long identifiers, and touch
  targets.

## Out of scope

- Changing admin protocol routes, response schemas, OAuth behavior, App/Space
  authorization, authority names, invitation semantics, or production data.
- Implementing the query cache, stale-while-revalidate behavior, or App/issuer
  request deduplication owned by `adopt-admin-webui-query-cache`.
- Restoring the retired Console Playground or implementing the reference file
  App owned by `replace-playground-with-reference-app`.
- Rebranding UniCAS, replacing the existing component system, or redesigning
  public documentation and sign-in pages.

## Acceptance criteria

- [ ] At 375px, 768px, and 1280px viewport widths, the reviewed signed-in
      routes have no page-level horizontal overflow and no navigation control
      obscures readable content, fields, row actions, dialogs, or scrollbars.
- [ ] Platform and App Change Logs expose each event's time, readable action,
      actor, target, result when applicable, request identifier, and relevant
      copy/detail affordances without requiring users to reach the bottom of a
      long list before navigating horizontally.
- [ ] App and platform people results preserve visible row identity while users
      inspect authorities, dates, and actions; detail and destructive-action
      targets meet the 44 by 44px mobile target or provide an equivalent full-row
      interaction without accidental activation.
- [ ] People and audit filters retain a clear reading and tab order at all three
      widths, applied criteria are apparent, work-queue choices are named
      unambiguously, and Refresh/Invite/Apply remain coherently grouped.
- [ ] The mobile drawer keeps its profile and permission-aware Administration
      access at the bottom, its controls meet touch-target and safe-area
      requirements, and its trigger has a non-obscuring placement or reserves
      enough content space on every reviewed route and overlay.
- [ ] Managed issuer failures never expose `NOT_FOUND` or another backend code
      as the sole message; the UI distinguishes absent configuration,
      authorization, loading, and request failure and offers the valid retry or
      next action while explaining disabled controls.
- [ ] People and audit initial-load, background/load-more, empty-filter, stale or
      retained-data, and failure states are visually distinct, announced to
      assistive technology, and do not present an empty table as confirmed
      content while a request is unresolved.
- [ ] Before creating an unconstrained App invitation, the UI clearly explains
      who can redeem it and requires an intentional choice. Account details name
      the selected account, explain authority effects and mutation timing, and
      provide meaningful empty membership and blocked/restored states.
- [ ] Account presents coherent linked-login activity, explains why Unlink is
      unavailable, and gives editable/filter form controls meaningful names,
      input purposes, and autocomplete behavior.
- [ ] The no-selection home exposes a plainly named next action, and App
      Overview and Connect AI tools remain scannable on mobile and desktop
      without nested horizontal and vertical reading traps.
- [ ] Focused Admin WebUI tests cover the corrected state and interaction
      semantics, and automated browser checks capture the affected routes at
      375px, 768px, and 1280px with long identifiers and representative data.
- [ ] `@unicas/admin-webui` tests, typecheck, and build pass without changing
      admin/data-plane package boundaries or the existing route and permission
      contracts.

## Constraints

- Preserve the current hash routes, server-enforced permissions, App/Space
  separation, and admin-client/protocol contracts.
- Keep raw identifiers and event codes available for diagnosis, but pair them
  with readable labels, hierarchy, and copy affordances instead of making them
  the only presentation.
- Use the existing React, Radix, shadcn-style component, and CSS conventions;
  add a shared responsive list/table abstraction only if it removes repeated
  interaction complexity across the people and audit views.
- Coordinate loading and error ownership with
  `adopt-admin-webui-query-cache`; do not add a second cache or competing
  request lifecycle.
- Validate destructive and permission-changing flows with local fixtures or
  isolated test data. Production walkthroughs remain read-only.
- Preserve the product display name `UniCAS` and support reduced motion,
  keyboard navigation, focus restoration, and assistive technology throughout
  responsive transitions.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
published with a pending decision and explicitly approved before the protected
work begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable product owner | This production audit, prioritized findings, scope boundaries, constraints, acceptance criteria, and coordination with adjacent backlog work. | Substantive implementation. |
| Interface | Required | User or delegated Console product owner | Task-owned before/after HTML review covering home, navigation, Overview, people, audit, Account, invitation/account-detail overlays, and Connect AI tools at mobile, tablet, and desktop widths, including loading, empty, error, long-content, and destructive-action states. | Implementing the affected interaction and responsive presentation. |
| Business and data model | Not applicable: the task preserves existing App, account, authority, invitation, audit, issuer, and identity semantics and changes only their presentation. | Not applicable | Not applicable | Not applicable |
| Architecture | Assess during execution: required if implementation introduces a shared responsive data-view abstraction, a new UI dependency, or changes state ownership across views. | User or delegated architecture owner | Proposed component ownership, dependency impact, and state boundaries for any shared abstraction. | Adding that abstraction/dependency or moving state ownership. |
| Delivery acceptance | Required | User or accountable product owner | Integrated revision, focused automated results, responsive screenshots at 375px, 768px, and 1280px, keyboard and assistive-state checks, and read-only production smoke results. | Running `task complete` for the exact approved primary commit. |

## References

- [Admin WebUI shell and routing](/packages/admin-webui/src/ui/app.tsx)
- [Sidebar and mobile navigation](/packages/admin-webui/src/ui/components/app-sidebar.tsx)
- [Responsive styles](/packages/admin-webui/src/ui/styles.css)
- [People and invitation workflows](/packages/admin-webui/src/ui/views/people.tsx)
- [App Change Logs](/packages/admin-webui/src/ui/views/control-audit.tsx)
- [Platform Change Logs](/packages/admin-webui/src/ui/views/platform/audit.tsx)
- [Account view](/packages/admin-webui/src/ui/views/account.tsx)
- [Platform account editor](/packages/admin-webui/src/ui/views/platform/account-editor.tsx)
- [Connect AI tools dialog](/packages/admin-webui/src/ui/mcp-configuration-dialog.tsx)
- [Related query-cache task](/tasks/adopt-admin-webui-query-cache/Task.md)
- [Completed navigation task whose mobile footer behavior must remain true](/tasks/simplify-console-administration-navigation/Task.md)
- [Related reference App task](/tasks/replace-playground-with-reference-app/Task.md)
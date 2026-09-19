# Console UI redesign

Status: implemented UI reference; final delivery acceptance pending

Updated: 2026-09-16

## Design target

Rebuild the entire `@unicas/admin-webui` with source-owned shadcn/ui
primitives and one responsive two-column Console shell. The left navigation is
the durable App and workspace context. The right pane is the selected App or
Platform Administration detail.

The original interactive prototype is [ConsoleMock.html](./ConsoleMock.html).
It is retained as historical design evidence, not the current UI contract.
The implemented Console and acceptance evidence in [Progress](./Progress.md)
are the current reference. They cover:

- selecting Apps from primary navigation;
- switching Overview, Members, and Change Logs in App detail, with Playground
  independently right-aligned and disabled unless the managed issuer is active;
- entering Platform Administration when the Principal is authorized;
- opening the signed-in profile menu from the Sidebar footer;
- inline App creation in the Sidebar, invitation dialogs, and Connect AI tools;
- desktop and mobile Sidebar behavior;
- long App names and table overflow.
- App suspension and restoration;
- managed and custom OAuth issuer management;
- App member invitation listing and revocation.

Do not restore superseded navigation or forms merely to match the prototype.

## Information architecture

```text
Console
├── Sidebar
│   ├── UniCAS brand
│   ├── Apps
│   │   ├── Create App action, when apps.create is effective
│   │   └── App list, ordered by display name
│   ├── Administration, only when platform.admin is effective
│   │   └── Platform access
│   └── Signed-in profile
│       ├── Documentation
│       ├── Connect AI tools
│       └── Sign out
└── Detail
    ├── App
    │   ├── Overview
    │   ├── Members
    │   ├── Change Logs
    │   └── Playground (right-aligned)
    ├── Platform Administration
    │   ├── Members (Principals and invitations)
    │   └── Change Logs
    ├── No-selection starter
    ├── Invitation acceptance
    └── Login error
```

There is no global top Header or mobile context bar. A bottom-right button
opens a right-side mobile navigation Sheet; selecting a destination closes it
and returns focus to that trigger.

### Primary navigation

The App list is the primary navigation rather than a separate `My Apps` page or
an App select control. Each entry shows:

- a stable two-letter visual mark derived from display name;
- display name, truncated to one line with an ellipsis and full name Tooltip;
- selected state with both color and a leading indicator.

Do not show App IDs in primary navigation. They are implementation identifiers,
not useful scanning information. The Overview identity card exposes the App ID
as a compact clickable copy bubble with copied/error feedback.

The list scrolls independently between a fixed brand header and fixed profile
footer. Long display names must never create Sidebar or page-level horizontal
scroll. App count is expected to be small initially; add Sidebar search only
when measured usage warrants it.

App creation is an icon action beside the Apps label. It is absent when
`apps.create` is not effective. An App-only member therefore sees its Apps but
no creation affordance.

The plus inserts an autofocus temporary App row at the top of the list, with
inline Check and X buttons inside the name input. Check/Enter or nonempty blur
outside the whole editor creates the App and navigates to its Overview. Moving
focus to either inline button does not submit. Empty/whitespace blur and Escape
cancel without a write. Invalid names remain editable with an anchored floating
hint. Pending submission disables both actions and retries preserve idempotency.
With no App selected, show only a short starter message, not a duplicate list
or creation card. The message mentions creation only when `apps.create` applies.

### Platform entry

Show the Administration group only when `/admin/me` includes
`platform.admin`. The entry uses a shield icon and the Platform access label
within the same Console navigation. The detail title identifies the privileged
workspace as Platform Administration.

Client-side conditional rendering is not authorization. Direct navigation to a
platform route must still receive a server-side `PLATFORM_ADMIN_REQUIRED`
response and render a non-disclosing forbidden state.

### App detail navigation

Overview, Members, and Change Logs are line-style top Tabs under the selected
App heading, followed by right-aligned Playground. Invitations are rows in
Members, not a separate tab. These pages are not Sidebar entries and there is
no second App switcher. App and Platform reuse the same heading/tab component;
each selected tab controls a real, labelled tabpanel.

Selecting an App in the Sidebar opens its Overview. Do not render previous App
data/revisions while the next resource is loading; unsaved drafts are App-scoped.

Long App names also ellipsize in the detail heading rather than resizing the
page or displacing actions. The full name remains available through the Sidebar
Tooltip and accessible name.

The route, not component-local state, is authoritative:

```text
/admin/#/apps/{appId}/overview
/admin/#/apps/{appId}/members
/admin/#/apps/{appId}/playground
/admin/#/apps/{appId}/change-logs
```

Use `overview` as the canonical redirect for `/apps/{appId}`. Retain hash
routing for this rewrite unless deployment is deliberately changed to provide
SPA fallback for path routing.
Old `/apps/{appId}/invitations` links redirect to Members with the pending filter.

### Profile menu

Place the current profile in `SidebarFooter`. The complete footer button shows
avatar/initials, display name, and effective context such as `Platform admin`
or `3 App memberships`.

Use shadcn `DropdownMenu`, opened upward and aligned to the Sidebar width. Its
only actions are:

1. Documentation, opening `https://docs.unicas.work` in a new tab;
2. Connect AI tools, opening the existing configuration Dialog;
3. Sign out, styled destructive and separated from non-destructive actions.

Remove Documentation, Connect AI tools, and Sign out from all Header and App
navigation implementations.

## Platform workspace

Platform Administration reuses the same detail shell and line Tabs:

```text
/admin/#/platform/people
/admin/#/platform/audit
```

The visible labels are Members and Change Logs; technical `people`/`audit`
routes remain stable. Members owns search/filter controls, the mixed Principal
and invitation table, Invite Dialog, conditional revocation, and Principal detail
Sheet. It does not render statistics or request access-summary. The existing
protected summary API remains available to other clients.

Both App and Platform member tables use an Invite toolbar action, with distinct
App-member and platform-authority dialogs. App membership and platform grants
remain separate. Default lists include existing identities and pending invitations;
accepted/expired/revoked invitations are available through history filtering.
Old platform `/principals` and `/invitations` links redirect to `/people` with
Principal-only or pending selection respectively.

Both Change Logs pages use unframed tables, including column headers and an
empty table row when no events exist. Keep platform filter controls without
adding a card wrapper or a duplicate in-page heading.

## App operational status

Use the existing protocol terms `active` and `suspended`. Product actions are
`Suspend App` and `Restore App`; do not introduce `inactive` or `deactivate` as
aliases.

Suspension is a reversible emergency stop with this boundary:

- all App Space data-plane reads, writes, and management operations fail closed;
- no new managed capabilities are issued;
- existing external or managed capabilities stop authorizing requests within
  the defined authority-cache bound;
- Playground is unavailable because it is a data-plane client;
- App administrators may still read App configuration, members, invitations,
  issuers, usage history, and audit;
- control-plane mutations needed to repair or recover the App remain available,
  including metadata, membership, issuer configuration, and Restore.

The Overview heading shows current status. Put Suspend/Restore at the very
bottom of Overview in a dedicated `Danger zone`, separated from everyday
metadata and issuer controls. Suspend requires an AlertDialog that states both
blocked and retained behavior. The App remains in Sidebar navigation with a
visible suspended marker; do not hide it or treat suspension as deletion.

Full enforcement is a separate prerequisite task because current authority
resolution does not yet consistently join App status.

## Overview content

Overview contains:

- operational metrics;
- App identity and copyable App ID;
- managed issuer URL and Activate/Disable control;
- current production OAuth issuer and Change issuer workflow.

Place App identity and one `OAuth issuers` card side by side. The issuer card
contains compact, symmetrical `Managed` and `Production` sections. Each section
uses one title/action row followed by a full-width clickable URL copy bubble.
Activate/Disable and Change use the same fixed action width and right alignment.
Managed does not show a separate status label. Its enabled state is represented
by a copyable URL bubble and `Disable`; when disabled, the URL bubble is gray
and non-interactive and the action reads `Activate`. A healthy configured
Production issuer likewise does not show a redundant `Active` label. Show a
Production status badge only for actionable abnormal states such as `stale` or
`incompatible`. `Production` is the Console label for the protocol's
custom/external issuer. Do not add a dedicated suspension behavior card;
the heading status, Suspend/Restore action, and confirmation dialog carry that
workflow. The compact Custom row does not show its JWKS URL; discovery details
belong in the inspect/change workflow.

Remove Quick Actions. Playground and Members are already adjacent top-level
Tabs, so repeating them consumes space without shortening the workflow.

Changing an active custom issuer is staged: inspect discovery/JWKS and verify
ownership while the current issuer remains active, then atomically activate the
replacement. The UI must never create a gap where an unverified replacement is
authoritative. Managed issuer state remains independently visible and
controllable through its existing enable/disable API.

## Visual direction

The mock customizes shadcn's neutral structure rather than imitating a stock
block:

- cool gray page and Sidebar surfaces;
- deep mineral teal for selected context, focus, healthy state, and primary
  structural accents;
- sparing warm coral for Platform Admin authority and destructive context;
- Manrope for compact operational typography and Cascadia Code for identifiers;
- square, dense work surfaces with radius no larger than 8px;
- subtle grid texture on detail background;
- borders and spacing carry hierarchy instead of decorative shadows;
- no dark-mode-first palette, gradients, nested cards, hero sections, or
  oversized headings.

Use semantic CSS variables as the only color source. Map shadcn tokens to
UniCAS values in the global stylesheet and add Sidebar-specific tokens. Do not
scatter literal utility colors through feature views.

The implementation may retain the current system font stack if loading a web
font conflicts with the deployment's privacy or CSP policy; typography must
still be explicitly chosen and tested rather than accepting shadcn defaults.

## shadcn/ui foundation

shadcn/ui is copied source, not a runtime component library. Generated
components live inside `@unicas/admin-webui` and can be reviewed, modified, and
tested with the product.

### Existing-project setup

Adopt the current shadcn Vite guidance:

- Tailwind CSS 4;
- `@tailwindcss/vite` in the existing Vite config;
- `@/*` resolving to `packages/admin-webui/src/*` in both Vite and this package's
  TypeScript config;
- one `components.json` rooted in `packages/admin-webui`;
- global tokens and Tailwind import in the WebUI stylesheet;
- preserve `base: "/admin/"` and deterministic output names required by the
  BFF shell.

Run shadcn CLI from the WebUI package or specify that package explicitly. Review
all generated dependency and source changes; do not scaffold another Vite app
or workspace package.

### Initial component set

Generate only components required by known workflows:

```text
avatar
badge
button
card
checkbox
dialog
dropdown-menu
empty
input
label
select
separator
sheet
sidebar
skeleton
table
tabs
tooltip
```

Add `alert`, `alert-dialog`, `scroll-area`, `sonner`, or other primitives only
when an implemented workflow requires them. Do not install a broad catalog in
advance.

Continue using `lucide-react`, which is already a direct dependency. Utility
composition should use the shadcn-standard `cn` helper and its required local
dependencies. No package under another UniCAS access plane may depend on these
browser UI primitives.

## React component ownership

Current source structure (selected files):

```text
src/
├── components/ui/          source-owned shadcn primitives
└── ui/
  ├── components/
  │   ├── app-sidebar.tsx
  │   ├── app-detail-tabs.tsx
  │   ├── app-create-row.tsx
  │   └── copy-bubble.tsx
  ├── views/
  │   ├── stack-overview.tsx
  │   ├── file-playground.tsx
  │   ├── people.tsx
  │   ├── control-audit.tsx
  │   └── platform/
  │       ├── principal-editor.tsx
  │       └── audit.tsx
  ├── user-menu.tsx
  ├── app.tsx
  ├── api.ts
  ├── router.ts
  └── styles.css
```

`components/ui` contains low-level source-owned primitives. Console components
compose them into product behavior. Views own API loading and domain workflow.
Do not put API calls, UniCAS authorization decisions, or invitation workflow in
shadcn primitive files.

The source-owned AppSidebar implements the two-column shell and uses Sheet for
mobile navigation. Use DropdownMenu for profile actions, line-style Tabs with
TabsContent for detail, Dialog for invitations/confirmations, and Sheet for
Principal details. App creation is inline, not a Dialog. Shared CopyBubble owns
click/keyboard copying and localized Sonner success/error feedback for App IDs,
managed issuer URLs, and one-time invitation receipts.

## Unified people lists amendment

User-requested direction on 2026-09-16 supersedes separate member/Principal and
invitation navigation in the original proposal. See the implemented query contract in
[API design](./ApiDesign.md#unified-people-query-amendment).

- App detail navigation becomes Overview, Members, Change Logs, with Playground
  independently right-aligned and disabled unless the managed issuer is active.
  Members presents existing members and pending invitations in one table.
- Platform detail navigation displays Members and Change Logs. Members presents existing
  Principals (including blocked/no-access states) and pending invitations in one
  table. Retain the Principal details/authority editor, without statistics blocks.
- Each table has a search/filter toolbar, refresh action, and right-aligned
  Invite button. Invite opens the existing creation/receipt workflow in a Dialog.
  Keep email constraints, authority selection on platform invitations, one-time
  receipt handling, copy feedback, and expiry display.
- App columns: person/email, state, joined/invited timestamp, expiry, actions.
  Platform columns: person/email, effective state, current/proposed authorities,
  App membership count, created/invited timestamp, expiry, actions. Invitation
  rows have no fabricated App membership count or effective-access state.
- Filters show current entries by default, members/Principals only, pending
  invitations only, or invitation history. Platform retains authority and
  effective-access filters with the API amendment's explicit semantics.
- Principal rows open the existing detail editor. App member rows offer member
  removal; pending invitation rows offer revoke confirmation. Preserve App and
  invitation ETags, self-block and last-admin protections. Never delete a member
  merely because its email matches an invitation being revoked.
- Keep accepted invitations out of the default view and retain them in history.
  Multiple records with the same email remain distinct. Labels identify whether
  a row is a member, Principal, or invitation, independent of color.
- Old App `/invitations` links redirect to Members with the pending filter;
  old platform `/principals` and `/invitations` links redirect to Members with
  Principal and pending selection respectively. Filter/search changes reset
  pagination; mutations refresh the unified list. No summary fetch is needed.
- Use source-owned controls and a shared toolbar/table presentation where useful,
  but keep App and Platform query hooks, mutation handlers, and authorization
  context separate. Preserve mobile wrapping, local table scrolling, focus
  return, empty/loading/error states, and clear privileged-context presentation.

## Data loading and API alignment

The shell should make one current-session request and one App-list request in
parallel after authentication:

```text
GET /admin/me
GET /admin/apps?limit=...
```

`/admin/me` determines:

- current Principal and display Profile;
- `apps.create` visibility;
- `platform.admin` navigation visibility;
- App memberships used for authorization context.

`GET /admin/apps` remains the canonical source for App display metadata and
Sidebar order. Do not expand `/admin/me` with complete App objects only to save
this request.

The Sidebar keeps its App list mounted while detail routes change. Revalidate
it after App creation, App metadata changes, membership acceptance/removal, or
an authorization error indicating access changed.

The original navigation redesign required no additional platform endpoint.
The unified people-list amendment implements separate App/platform combined
read endpoints for coherent search, ordering, and pagination. `/admin/me`
continues to determine navigation visibility and App creation; existing detail,
mutation, summary, and audit endpoints retain their responsibilities.

Three App-level prerequisites are intentionally separate from this Console
rewrite: complete suspension enforcement, member invitation list/revoke, and
zero-downtime replacement of an active custom issuer. The Console consumes
their accepted contracts rather than implementing security semantics in view
code.

- [App suspension boundary](/tasks/enforce-app-suspension-boundary/Task.md)
- [App member invitation management](/tasks/manage-app-member-invitations/Task.md)
- [Active App OAuth issuer replacement](/tasks/replace-active-app-oauth-issuer/Task.md)

## Responsive behavior

At desktop widths:

- Sidebar is fixed at 17rem and detail scrolls independently;
- Sidebar header and profile footer remain visible;
- Sidebar content alone scrolls when the App list is long;
- detail content is constrained to 1160px;
- wide tables scroll inside their own container.

Below 900px:

- Sidebar becomes an off-canvas shadcn Sheet controlled by `SidebarTrigger`;
- a scrim blocks detail interaction while open;
- selecting an App or platform route closes it and returns focus to the trigger;
- current context appears beside the trigger.

Below 640px:

- page actions wrap below headings;
- line Tabs scroll horizontally without wrapping;
- metric grids become one column;
- Playground changes from side-by-side tree/editor to stacked fixed tree and
  editor regions;
- tables remain horizontally scrollable without widening the body.

At every viewport, Playground consumes the remaining visible detail height
below the App heading and Tabs. Its file tree and editor scroll internally;
the page must not leave a large unused area below the working surface. Use
`minmax(0, 1fr)` in the production shell rather than relying on one hard-coded
viewport subtraction.

Verified mock dimensions:

- desktop at 1622px: body and Sidebar have no horizontal overflow;
- mobile at 390x844: body width remains 390px and off-canvas Sidebar is 288px;
- long App names truncate without a visible horizontal scrollbar;
- mobile Playground controls, Tabs, file tree, and editor do not overlap.

## Accessibility requirements

- Use native links for route navigation when practical; preserve open-in-new-tab
  behavior for Documentation.
- App and platform Tabs expose selected state and keyboard navigation through
  the shadcn primitive.
- Sidebar mobile Sheet traps focus, closes on Escape, and restores focus.
- DropdownMenu and Dialog use library focus management rather than custom global
  listeners.
- Icon-only actions have accessible names and Tooltips where the icon is not
  universally clear.
- Selection, authority, status, and destructive state never rely on color alone.
- Loading uses Skeleton where layout is known; failures and empty results use a
  shared accessible state component.
- Test at 200% zoom, reduced motion, keyboard-only navigation, and long localized
  labels in addition to desktop/mobile screenshots.

## Migration sequence

This is a whole-Console rewrite, but it should remain executable after each
milestone:

1. Add Tailwind/shadcn infrastructure, aliases, theme tokens, and primitive
   tests without changing routes.
2. Build the global Sidebar shell, route-based App detail Tabs, profile menu,
   mobile Sheet, and async shell states against existing APIs.
3. Port Overview and its App metadata, issuer, and usage workflows.
4. Port Members, Invitations, and Change Logs, preserving conditional mutation
  and pagination.
5. Port Playground last because it has the richest local cache, file workflow,
   responsive layout, and focus behavior.
6. Add Platform Administration views after the platform protocol/client routes
   exist.
7. Remove superseded `components.tsx`, old Header/App Sidebar, old CSS selectors,
   and obsolete tests only after every workflow has moved.

Do not maintain a long-lived compatibility wrapper that makes new shadcn
components look like the old generic `Card`, `Page`, `Tabs`, and `Button` API.
Short-lived migration adapters are acceptable within one implementation branch
but must be removed before acceptance.

## Validation plan

For each migrated view:

- port or replace its existing React Testing Library coverage;
- assert route and selected navigation state;
- assert authority-dependent visibility;
- assert keyboard and Escape behavior for menus, Sheets, and Dialogs;
- run WebUI typecheck, tests, and build;
- verify BFF-generated asset integration remains deterministic;
- use Playwright screenshots at desktop and 390px mobile;
- inspect page-level and component-level scroll widths;
- exercise App switching while each detail Tab is active;
- exercise a Principal without `apps.create` and one without `platform.admin`.

The final task validation must also cover the platform API/BFF/MCP security
criteria in [ApiDesign.md](./ApiDesign.md); UI visibility tests alone are never
sufficient authorization evidence.

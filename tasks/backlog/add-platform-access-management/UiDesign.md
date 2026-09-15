# Console UI redesign

Status: discussion draft

Updated: 2026-09-15

## Design target

Rebuild the entire `@unicas/admin-webui` with source-owned shadcn/ui
primitives and one responsive two-column Console shell. The left navigation is
the durable App and workspace context. The right pane is the selected App or
Platform Administration detail.

The interactive reference is [ConsoleMock.html](/tasks/backlog/add-platform-access-management/ConsoleMock.html). It covers:

- selecting Apps from primary navigation;
- switching Overview, Members, Invitations, Playground, and Change Logs in the
  App detail;
- entering Platform Administration when the Principal is authorized;
- opening the signed-in profile menu from the Sidebar footer;
- opening App creation, developer invitation, and Connect AI tools dialogs;
- desktop and mobile Sidebar behavior;
- long App names and table overflow.
- App suspension and restoration;
- managed and custom OAuth issuer management;
- App member invitation listing and revocation.

`ConsoleMock.html` is the sole interactive reference for the Console shell,
workflows, and visual direction.

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
    │   ├── Invitations
    │   ├── Playground
    │   └── Change Logs
    ├── Platform Administration
    │   ├── Principals
    │   ├── Invitations
    │   └── Audit
    ├── Invitation acceptance
    └── Login error
```

There is no global top Header. The mobile-only bar contains only the Sidebar
trigger and current context label; it is navigation affordance, not a second
Header action surface.

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

### Platform entry

Show the Administration group only when `/admin/me` includes
`platform.admin`. The entry has a restrained privileged accent and an `Admin`
badge, but it remains part of the same Console navigation.

Client-side conditional rendering is not authorization. Direct navigation to a
platform route must still receive a server-side `PLATFORM_ADMIN_REQUIRED`
response and render a non-disclosing forbidden state.

### App detail navigation

Overview, Members, Invitations, Playground, and Change Logs are line-style top
Tabs under the selected App heading, in that order. Members and Invitations are
sibling pages; Playground is penultimate. These pages are no longer Sidebar
entries and there is no second App switcher.

Switching App preserves the current App section when that section exists for
all Apps. Example: switching from Canvas Sync Playground to Archive Tools keeps
Playground selected. This supports repeated comparison and avoids resetting the
operator's task context.

Long App names also ellipsize in the detail heading rather than resizing the
page or displacing actions. The full name remains available through the Sidebar
Tooltip and accessible name.

The route, not component-local state, is authoritative:

```text
/admin/#/apps/{appId}/overview
/admin/#/apps/{appId}/members
/admin/#/apps/{appId}/invitations
/admin/#/apps/{appId}/playground
/admin/#/apps/{appId}/change-logs
```

Use `overview` as the canonical redirect for `/apps/{appId}`. Retain hash
routing for this rewrite unless deployment is deliberately changed to provide
SPA fallback for path routing.

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
/admin/#/platform/principals
/admin/#/platform/invitations
/admin/#/platform/audit
```

The Principals page owns aggregate counts, search/filter controls, the Principal
table, the access detail Sheet, and authority/block mutations. Invitations owns
creation and revocation. Audit owns platform event filtering and pagination.

App invitation remains in each App's Invitations page. Platform invitation
remains in Platform Administration. The labels must distinguish `Invite member`
from `Invite developer`.

Members lists current equal-authority App members. The sibling Invitations page
lists pending, accepted, expired, and revoked invitations and permits
conditional revocation of pending invitations. This deliberately mirrors the
Platform workspace without conflating App membership with platform authority.

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

Recommended source structure:

```text
src/ui/
├── components/
│   ├── ui/                 copied shadcn primitives
│   ├── app-sidebar.tsx
│   ├── app-detail-tabs.tsx
│   ├── profile-menu.tsx
│   ├── page-heading.tsx
│   └── async-state.tsx
├── views/
│   ├── app-overview.tsx
│   ├── app-playground.tsx
│   ├── app-members.tsx
│   ├── app-change-logs.tsx
│   └── platform/
│       ├── principals.tsx
│       ├── invitations.tsx
│       └── audit.tsx
├── app.tsx
├── api.ts
├── router.ts
└── styles.css
```

`components/ui` contains low-level source-owned primitives. Console components
compose them into product behavior. Views own API loading and domain workflow.
Do not put API calls, UniCAS authorization decisions, or invitation workflow in
shadcn primitive files.

Use `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`,
`SidebarGroup`, `SidebarMenu`, `SidebarFooter`, `SidebarInset`, and
`SidebarTrigger` for the shell. Use `DropdownMenu` for the profile actions,
line-style `Tabs` for App/platform detail, `Dialog` for creation, and `Sheet`
for Principal access detail on desktop and mobile.

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

The navigation redesign requires no additional platform endpoint beyond the
API draft. The draft's `/admin/me` extension is sufficient for conditional
navigation and App creation. Platform summary, Principal list/detail,
invitation, mutation, and audit endpoints map directly to the platform views.

Three App-level prerequisites are intentionally separate from this Console
rewrite: complete suspension enforcement, member invitation list/revoke, and
zero-downtime replacement of an active custom issuer. The Console consumes
their accepted contracts rather than implementing security semantics in view
code.

- [App suspension boundary](/tasks/archived/enforce-app-suspension-boundary/Task.md)
- [App member invitation management](/tasks/ongoing/scottwei-home-pc/manage-app-member-invitations/Task.md)
- [Active App OAuth issuer replacement](/tasks/backlog/replace-active-app-oauth-issuer/Task.md)

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

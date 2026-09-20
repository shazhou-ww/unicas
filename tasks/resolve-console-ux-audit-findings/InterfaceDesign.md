# Console interface design intent

Status: Pending interface approval

This document records the intended interaction and presentation behavior for
the Console UX work. [`Task.md`](./Task.md) owns scope and acceptance criteria.
[`UiReview.html`](./UiReview.html) is an illustrative comparison and must not be
treated as the only definition of behavior.

## Decision requested

Approve the design direction below before implementation:

- keep system state attached to the region it affects;
- preserve context and actions without two-dimensional scrolling;
- make privileged choices explicit before mutation; and
- present Console, MCP, and CLI browser handoffs as one coherent UniCAS
  experience without coupling their runtimes.

## Design principles

### Preserve place

Loading, empty, error, and stale states belong inside the destination they
describe. The surrounding shell, heading, navigation, and previously usable
content should remain stable whenever the data lifecycle permits it. A request
must not collapse the page to an indicator in a viewport corner.

### Preserve record context

An administrator must be able to associate an action with its Account,
invitation, or event. Desktop can retain dense tables. Narrow layouts should
use record summaries or another responsive representation that keeps identity,
state, important metadata, and actions together. A horizontal scrollbar at the
end of a long vertical result set is not an acceptable primary interaction.

### Explain authority before action

Permission-changing and bearer-link actions must state who gains access, when
the change applies, and how to recover. Internal authority names and request
identifiers remain available for diagnosis, but readable labels and effects
come first.

### Use motion as status, not decoration

Loading motion should be quiet, local, and unambiguous. It must not resemble
device discovery, scanning, or content analysis. All motion has a useful static
fallback under `prefers-reduced-motion`.

## Authentication entry

- Present the UniCAS brand and provider choices inside one bounded sign-in
  surface rather than placing controls directly on the page grid.
- Keep the brand at the upper-left of the panel and `Restricted console` at the
  upper-right, aligned to the brand's top edge. The eyebrow is secondary status,
  not a separate vertical section.
- Use the concise helper `Choose a sign-in method.` and keep it on one line at
  supported widths.
- Use the official Google, Microsoft, and GitHub marks. Each mark is decorative
  to assistive technology because the adjacent button label names the provider.
- Fix each provider mark to the left side of its button while centering the
  label against the full button width. The mark must not shift the label's
  visual center.
- Normal, access-restricted, and authentication-error states use the same panel
  geometry and hierarchy. Upstream provider pages remain unchanged.

## Loading and asynchronous state

- Initial session loading may use a dedicated centered shell. Route-level
  loading keeps the Console navigation and destination heading visible.
- A loading status uses a bounded panel with a stable footprint, a specific
  label such as `Loading App overview`, and short supporting text.
- The proposed loading treatment has no small spinner. A restrained highlight
  travels only around the 1px panel outline; the panel interior is fully opaque
  and static. It must not create a radial or radar-like scan across the content.
- Under `prefers-reduced-motion`, replace the moving highlight with a static
  emphasized outline.
- Loading and retry semantics for cached App data remain coordinated with
  `adopt-admin-webui-query-cache`; this design does not introduce another
  request lifecycle.

## Mobile navigation

- At desktop widths, retain the persistent list/detail shell: App navigation
  and the signed-in Account remain in the left sidebar while the selected App
  or administration detail occupies the right content region. Desktop does not
  use the floating trigger or slide-over drawer.
- Keep the right-handed bottom-right navigation trigger and right-side drawer.
  This mobile mode applies below the existing 900px shell breakpoint. The
  trigger uses the familiar Menu glyph, not the word `Menu`, and retains the
  accessible name `Open navigation`.
- The drawer is an overlay. Opening it must not resize, reflow, or squeeze the
  underlying main content.
- While open, show a scrim, prevent background interaction and scrolling, trap
  focus inside the drawer, support Escape, and return focus to the trigger when
  closed.
- Reserve enough safe-area-aware bottom space in the closed state that the
  44-by-44px trigger never covers content, controls, or horizontal scrollbars.
- Keep the signed-in profile and permission-aware Administration destination
  anchored to the drawer bottom independently of App-list length.
- Keep primary mobile controls effectively targetable across at least 44 by 44
  CSS pixels. A familiar compact glyph may have a smaller painted footprint
  when an invisible, non-overlapping hit area supplies the remaining target.
- Prefer familiar glyph-only controls for established compact actions such as
  open navigation, close, create/add, refresh, copy, and row menus. Preserve a
  clear accessible name and a hover/focus tooltip. Keep visible text for
  unfamiliar commands, consequential decisions, and destructive actions whose
  meaning should not depend on icon recognition.
- On desktop, compact glyph actions such as Create App use a light neutral
  border and surface at rest, then strengthen the background and border on hover
  and keyboard focus. Keep the painted control compact rather than rendering a
  touch-sized toolbar button in a pointer-oriented layout.
- When actions share a toolbar row with inputs or selects, match the visible
  control height and baseline of those fields. Compact standalone actions such
  as sidebar Create App may remain smaller.

## People and Change Logs

- Keep tables at widths where all important columns and actions remain
  scannable. Use record summaries on narrow screens rather than compressing or
  clipping the desktop table.
- A mobile person summary keeps name, Account ID, effective access,
  authorities, App count, relevant time, and its action in one bounded record.
- A mobile audit summary keeps readable action, timestamp, actor, target,
  result, and a details/copy path together. Preserve the raw event code and
  request ID as secondary diagnostic data.
- Filters appear before results in a stable reading and keyboard order. Replace
  the ambiguous `Current` queue label with the actual selected collection, such
  as `Accounts`, `Members`, `Pending invitations`, or `Invitation history`.
- Keep Apply with the filters it commits. Group Refresh and Invite as dataset
  actions without allowing responsive wrapping to imply a different order.
- Initial loading, retained-data refresh, empty results, errors, and load-more
  progress are distinct states and use appropriate live-region semantics.

## App and access decisions

- Preserve a compact App identity summary and reduce repeated explanatory copy
  so configuration remains scannable on narrow screens.
- Before creating an App invitation, require an explicit choice between an
  email-constrained invitation and an unconstrained one-time bearer link.
  Explain the redemption consequence next to the choice.
- Account details use the selected Account's display name as the title, retain
  its ID as secondary data, translate authority codes into readable effects,
  and state whether changes apply immediately or require an explicit save.
- Empty membership and unavailable unlink states explain why the action or data
  is unavailable and what can change that state.

Managed issuer presentation is not part of this design. The active
`retire-playground-and-managed-issuer` task owns removal of that UI and its
loading/error states; this task must not add a replacement treatment.

## Account identity

- `Current session` and last-used information must agree. A current identity
  cannot simultaneously be presented as `Last used Never`.
- Disabled identity actions expose their reason visually and through accessible
  description, not only through disabled styling or hover behavior.
- Editable profile and filter controls have stable names, labels, input types,
  and appropriate autocomplete behavior.

## AI setup and browser authorization handoff

- Present one setup path at a time: remote MCP or CLI/stdio. Keep the server URL
  independently copyable and use one consistent name for each prompt.
- Avoid side-by-side code regions that require nested horizontal and vertical
  scrolling. Long commands remain copyable and readable on narrow screens.
- CLI/MCP loopback success, failure, missing-code, state-mismatch, and not-found
  pages use a small self-contained UniCAS status page with a document title,
  viewport metadata, clear outcome, and explicit next step.
- Reuse the sign-in panel hierarchy for these result pages: UniCAS branding at
  the upper-left, a concise outcome label at the upper-right, and left-aligned
  title and explanation. Center the compact closing guidance below the content
  as the completion affordance. Do not introduce a separate oversized success
  or error icon.
- Loopback pages must not require remote assets or scripts. Continue escaping
  provider-supplied text, and never display authorization codes, state,
  credentials, or secrets.

## Responsive behavior

| Width | Intended behavior |
| --- | --- |
| 375px | Single-column content, record summaries, overlay drawer, 44px targets, no document-level horizontal scrolling. |
| 768px | Filters may use two columns; records retain complete context; drawer remains an overlay below the current 900px shell breakpoint. |
| 1280px | Persistent sidebar and compact data tables; toolbars remain one coherent group without orphaned actions or page overflow. |

Exact component breakpoints may be tuned during implementation if these
behavioral outcomes continue to hold at intermediate widths.

## Accessibility and content

- Preserve semantic headings, labels, tables where tables remain appropriate,
  dialogs/sheets, status and alert roles, and visible `:focus-visible` states.
- Use roving keyboard behavior for tablists, logical document order for
  filters, focus containment in overlays, and focus restoration to the opener.
- Do not rely on color, icon shape, animation, placeholder text, or hover alone
  to communicate state or available action.
- Long names, emails, identifiers, provider subjects, translations, and empty
  values must not overlap adjacent content or resize fixed controls.
- Use `Intl` formatting for user-facing dates and times while preserving raw
  identifiers for support workflows.

## Validation intent

- Add focused component tests for state semantics, accessible names, focus
  behavior, invitation choices, and unavailable-action explanations.
- Add browser checks at 375px, 768px, and 1280px for the reviewed routes and
  standalone authentication result pages.
- Exercise both People and Change Logs, drawer open and closed states, long
  identifiers, empty/error/loading states, and reduced motion.
- Production verification remains read-only and uses no customer data or
  destructive action.

## Open implementation choice

The visual behavior is the approval subject. If implementation would share an
authentication-page renderer or runtime styling code across
`@unicas/admin-webui`, `@unicas/service-cloudflare`, and `@unicas/admin-cli`,
the task's architecture checkpoint must be opened before introducing that
cross-package ownership.
# Simplify Console administration navigation

Created: 2026-09-17

## Goal

Make the Apps list the Console sidebar's only main navigation section for every
signed-in user, with a bottom-anchored user profile block exposing one
permission-aware `Administration` destination whose detail page is also titled
`Administration`.

## Context

The current Console renders an `Administration` section in the scrollable
sidebar with a nested `Platform access` destination, while the user profile menu
is a separate footer. This gives platform administrators a different main-list
hierarchy from App-only users and uses two names for one administration area.

The intended hierarchy keeps the main sidebar focused on Apps for every user.
Administration becomes a single conditional destination associated with the
user profile block at the bottom of the navigation.

## Scope

- Keep the Apps heading, creation control, and App destinations as the only
  items in the sidebar's main scrolling navigation region.
- Present the signed-in user's profile block at the bottom of the sidebar and
  include exactly one `Administration` destination there when the existing
  authorization state grants platform administration access.
- Remove the standalone administration section and the `Platform access`
  navigation label without changing the destination's route or authorization
  guard.
- Rename the platform administration detail-page title and corresponding
  accessible navigation label to `Administration`.
- Preserve the same information hierarchy, conditional visibility, focus
  behavior, and usable layout in desktop navigation and the mobile drawer.
- Update focused Console shell tests and styles for the new placement, labels,
  permission states, and responsive behavior.

## Out of scope

- Changing platform administration authorities, route guards, API behavior, or
  access-control decisions.
- Changing Account/Profile persistence, authentication, account linking, or
  user-menu commands unrelated to the administration destination.
- Redesigning the Apps list, App creation flow, Administration tabs, People
  view, or audit content.

## Acceptance criteria

- [x] For both platform administrators and App-only users, the main scrolling
      sidebar region contains the Apps section and no standalone
      Administration section.
- [x] The signed-in user profile block remains anchored to the bottom of the
      desktop sidebar and mobile drawer while a long Apps list scrolls without
      obscuring or displacing it.
- [x] A platform administrator sees exactly one navigation destination labeled
      `Administration` in the bottom profile block, and activating it opens the
      existing platform administration route.
- [x] An App-only user sees the same Apps-list hierarchy and profile block but
      no `Administration` destination; direct-route authorization continues to
      fail closed as it does today.
- [x] The destination detail heading is `Administration`, and its accessible
      navigation name uses the same terminology; the old `Platform access` and
      `Platform Administration` navigation/title text is absent from this flow.
- [x] Existing App selection, App creation visibility, user-menu commands,
      mobile drawer close/focus behavior, and Administration tab routing remain
      functional.
- [x] Focused automated tests cover authorized and unauthorized visibility,
      navigation, title semantics, and mobile behavior, and the relevant
      Admin WebUI validation passes.

## Constraints

- Reuse the current platform-administration route and `hasPlatformAdmin`
  decision; this task changes presentation, not authority semantics.
- Keep the profile block and navigation operable by keyboard and expose an
  unambiguous current-page state and accessible name.
- Coordinate implementation with the ongoing multi-provider administrator
  identity work because both may touch the Console shell, user menu, and shell
  tests; preserve that task's approved Account UI and authentication behavior.
- Preserve the administrator/data-access plane boundary and do not introduce
  new package dependencies for this layout change.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
published with a pending decision and explicitly approved before the protected
work begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable product owner | This task's goal, included and excluded behavior, constraints, acceptance criteria, and coordination boundary with the ongoing identity task. | Substantive implementation. |
| Interface | Required | User or delegated Console product owner | Task-owned concise before/after review showing administrator and App-only sidebar/profile states, the Administration detail title, and desktop/mobile behavior. | Implementing the affected Console navigation and responsive interaction. |
| Business and data model | Not applicable: the change does not alter business rules, entities, relationships, schemas, or migrations. | Not applicable | Not applicable | Not applicable |
| Architecture | Not applicable: the change stays within the existing Admin WebUI shell, route, authorization input, and component boundaries without new dependencies. | Not applicable | Not applicable | Not applicable |
| Delivery acceptance | Required | User or accountable product owner | Integrated revision, focused automated validation, and desktop/mobile visual and interaction results for administrator and App-only states. | Marking the task completed and archiving it. |

## References

- [Current Console sidebar](/packages/admin-webui/src/ui/components/app-sidebar.tsx)
- [Current platform detail composition](/packages/admin-webui/src/ui/app.tsx)
- [Current Console shell coverage](/packages/admin-webui/tests/ui-mcp-configuration.test.tsx)
- [Related multi-provider administrator identity task](/tasks/ongoing/scottwei-home-pc/support-multi-provider-admin-identity/Task.md)

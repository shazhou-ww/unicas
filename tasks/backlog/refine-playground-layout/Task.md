# Refine Playground layout

Created: 2026-09-16

## Goal

Polish the Console Playground layout across desktop and mobile without changing
its file-management, cache, or authorization behavior.

## Context

The requesting user accepted the management Console implementation at `8ef3391`
and explicitly asked to defer remaining Playground layout refinements to the
backlog rather than block the Platform Access release. The specific visual
adjustments must be reviewed with the user before implementation; this task
does not invent an unreported defect list.

## Scope

- Review current Playground screenshots at 375, 768, 1280, and 1920px and agree
  the remaining layout changes with the requesting user.
- Refine file-root navigation, breadcrumbs/action toolbar, file-table density,
  usage layout, spacing, wrapping, and responsive behavior as agreed.
- Reuse the existing source-owned shadcn primitives and restrained Console theme.
- Preserve loading/error/empty states, keyboard focus, reduced motion, icon
  labels/tooltips, copy feedback, and accessible selection states.

## Out of scope

- Platform Access, Google/OIDC login, bootstrap, deployment, or role changes.
- Changes to CAS/file protocols, capability issuance, cache semantics, root
  identity, file operations, or garbage-collection rules.
- Unrelated Console redesign or production data operations.

## Acceptance criteria

- [ ] The user approves a concrete before/after layout proposal and affected views.
- [ ] Agreed layout changes are implemented consistently on all four viewports,
      without overlapping content or page-level horizontal overflow.
- [ ] Existing file/root/upload/download/selection/usage workflows remain covered
      by tests; keyboard, focus, and reduced-motion behavior remain usable.
- [ ] WebUI tests, `tsc --noEmit -p tsconfig.test.json`, build, and focused browser
      checks pass; actual screenshots and validation limits are recorded.
- [ ] The user explicitly accepts the final integrated refinement.

## Constraints

- Keep this work in backlog until claimed; current Platform Access work remains
  the owner of release readiness and production verification.
- Use isolated local test data and generated local-only signing material for
  Playground validation. Never commit credentials or production identities.
- Preserve public APIs and the App/Platform and admin/data-plane boundaries.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | Specific layout issues, included/excluded areas, and acceptance criteria. | Implementation. |
| Interface | Required | Requesting user | Before/after desktop/mobile screenshots and interaction proposal. | UI changes. |
| Business and data model | Not applicable: layout-only; storage and authorization semantics remain unchanged. | Not applicable | Not applicable | Not applicable |
| Architecture | Assess during execution: required if component ownership or dependencies change. | Requesting user | Proposed component/dependency changes, if any. | Structural changes. |
| Delivery acceptance | Required | Requesting user | Integrated revision, screenshots, and test/browser evidence. | Completion and archive. |

## References

- [Platform Access task](/tasks/ongoing/scottwei-home-pc/add-platform-access-management/Task.md)
- [Current UI design](/tasks/ongoing/scottwei-home-pc/add-platform-access-management/UiDesign.md)
- [Playground implementation](/packages/admin-webui/src/ui/views/file-playground.tsx)
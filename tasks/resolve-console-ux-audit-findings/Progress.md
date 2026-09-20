# Progress

Updated: 2026-09-20

## Current state

The approved Console UX direction is implemented across the Admin WebUI,
Admin BFF, remote MCP authorization pages, and Admin CLI loopback callback.
Task-owned tests, package typechecks, production build, repository boundaries,
and desktop/tablet/mobile browser checks pass. The next action is publication
to primary followed by delivery review of the exact implementation commit.

## Decisions

- Keep Managed issuer presentation out of this task. The completed
  `retire-playground-and-managed-issuer` task owns and removed that surface.
- Preserve the desktop list/detail shell. Below the existing 900px shell
  breakpoint, use the existing Radix right-side overlay with safe-area spacing,
  44px trigger/close targets, an anchored profile footer, and focus restoration.
- Render People and Change Logs as tables above 768px and complete record cards
  at 768px and below. Keep readable action names primary and raw event/Account
  identifiers available for diagnosis and copying.
- Keep responsive records within their existing view owners. Add only a small
  WebUI-local width hook and loading component; introduce no dependency, shared
  data-view framework, cross-package runtime renderer, or state-ownership move.
- Use explicit App invitation scope choices. Email-bound invitations require an
  address; unconstrained invitations require choosing the one-time-link option.
- Keep Console, remote MCP, and CLI callback pages runtime-independent but
  visually consistent. Browser failures are escaped, self-contained, and do
  not expose authorization codes or state.
- Use bounded outline loading states with opaque interiors and a static
  reduced-motion fallback. Retain loaded People/audit data during manual
  refresh and reject stale audit responses after filter changes.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user, 2026-09-20: approved starting implementation after reviewing the narrowed [`Task.md`](./Task.md) at primary commit `5e51339bc2da72da668d0a4d7c5f7bd2467e4706`. |
| Interface | Approved | Requesting user, 2026-09-20: iterated and approved [`InterfaceDesign.md`](./InterfaceDesign.md) and [`UiReview.html`](./UiReview.html) at commit `5e51339bc2da72da668d0a4d7c5f7bd2467e4706`, then explicitly said implementation could begin. |
| Business and data model | Not applicable | The task preserves existing App, Account, authority, invitation, audit, and identity semantics and changes only presentation. |
| Architecture | Not applicable | Implementation stayed within existing package and view owners, added no dependency or cross-package runtime sharing, and did not introduce the task's review trigger. |
| Delivery acceptance | Pending | Review the published implementation, validation below, and final read-only browser results before approving the exact primary commit. |

## Validation

- `pnpm --filter @unicas/admin-cli test`: 50 tests passed.
- `pnpm --filter @unicas/admin-cli typecheck`: passed.
- Final focused Cloudflare auth suites passed: Admin BFF 45 tests and MCP OAuth
  17 tests, including provider selection, branded failures, status preservation,
  CSP headers, and OAuth redirect behavior.
- `pnpm --filter @unicas/service-cloudflare typecheck`: passed on the completed Managed issuer retirement baseline.
- Task-owned Admin WebUI regression groups: 58 tests passed, including shell,
  Account, AI setup, People, App/platform audit, mobile cards, loading states,
  explicit invitation scope, dialog focus, and stale-response races.
- `pnpm --filter @unicas/admin-webui typecheck`: passed.
- `pnpm --filter @unicas/service-cloudflare build`: passed; Vite emitted only
  the existing component sourcemap warnings.
- `pnpm check:workspace`: 111 tests passed.
- `pnpm check:tasks`: passed with only pre-existing legacy-task notices and
  pending delivery warnings for other tasks.
- The complete Admin WebUI suite passed 75 of 76 tests. The sole failure is the
  existing `IssuerView` test that still searches for retired `Mode:` copy while
  current primary renders `Status:`; Managed issuer/issuer retirement is outside
  this task. All task-owned groups pass independently.
- Integrated-browser checks used isolated local data at 375px, 768px, and
  1280px. Results: no document-level horizontal overflow; 375/768px People and
  audit routes render cards rather than tables; 1280px retains the desktop
  sidebar/table layout; the mobile drawer overlays full-width content, closes
  with Escape, restores focus, keeps its footer at the bottom, and exposes 44px
  trigger/close controls. At exactly 375px, the People card measured 343px wide,
  the Menu trigger measured 44px, and the sign-in provider measured 44px high.
- Browser checks also verified the bounded loading panel, compact bordered
  Create/Refresh glyphs, grouped filter commands, one-path-at-a-time AI setup,
  official provider marks, centered provider labels, and responsive sign-in
  panel geometry.
- The real Admin CLI loopback callback was served locally and inspected at
  390px and 1280px. Branding/status top edges aligned, closing guidance was
  centered, there was no overflow, and the callback code was absent from page
  text.
- Local Account route visual smoke was unavailable because the isolated local
  runtime returned `HTTP_404` for `/admin/account`; Account behavior is covered
  by six focused component tests, including loading, activity wording, disabled
  unlink description, 44px dialog close, and focus restoration.

## Blockers

- None for this task's implementation. The unrelated stale `IssuerView`
  assertion prevents the repository's complete Admin WebUI package suite from
  being entirely green, but all task-owned tests and package build/typecheck
  pass.

## Outcome

The Console now has deliberate authentication and authorization handoff pages,
stable asynchronous states, responsive navigation and record workflows,
explicit privileged decisions, coherent Account identity feedback, and a
single-path AI connection workflow. Lifecycle remains `ongoing` until the user
accepts the published implementation commit for delivery.
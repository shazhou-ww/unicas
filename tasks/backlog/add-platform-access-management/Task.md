# Rebuild the Console with platform access management

Created: 2026-09-15

## Goal

Rebuild the UniCAS Console on shadcn/ui with one consistent two-column
information architecture and add deny-by-default platform authorization, so
Google authentication alone grants no access, only explicitly entitled
Principals can create Apps, and an App invitation grants access to that App
without granting App creation.

## Context

The current administrator BFF and remote MCP authenticate Google identities and
optionally restrict them through the deployment-time `ADMIN_EMAIL_ALLOWLIST`.
An accepted administrator can create Apps, while an App membership grants equal
administrator authority over that App. This is sufficient for a small static
operator group but cannot express or audit who may enter the platform, who may
create Apps, or who is present only because an App administrator invited them.

UniCAS is not ready for open access by arbitrary Google accounts. Initially,
only a small internal group may create Apps. Each App must still be able to
invite its own members, but those members must not thereby gain authority to
create other Apps.

The Platform Admin experience will reuse `console.unicas.work` and the existing
WebUI shell. It is a separate workspace and server-side authorization boundary,
not a separate frontend deployment or origin.

The current Console also mixes a global header, an App switcher, nested App
navigation, and page-specific components built without a shared component
system. The accepted replacement uses shadcn/ui as source-owned UI primitives,
customized for UniCAS, and makes the App list the primary navigation.

## Scope

- Add a persistent, deny-by-default platform authorization model for immutable
  Principals, including Platform Admin and App-creation authority.
- Enforce platform admission and App-creation authority consistently across the
  administrator BFF, HTTP APIs, CLI, and MCP surfaces that expose the affected
  operations.
- Permit an eligible App invitation to establish only the access needed to
  accept the invitation; after acceptance, permit the Principal to use the
  Console for Apps in which it has membership without granting App creation.
- Add Platform Admin API resources for listing platform Principals, granting or
  revoking platform authority, and inspecting the effective access needed to
  operate the authorization workflow.
- Add a Platform Admin workspace to the existing Console with separate routing,
  navigation, API ownership, authorization states, and clear privileged-context
  presentation.
- Replace the current hand-built Console component layer with a reviewed
  shadcn/ui setup for the existing React and Vite package, including local
  source-owned primitives, Tailwind integration, theme tokens, and accessible
  interaction behavior.
- Rebuild the full Console shell as a responsive two-column layout: persistent
  App-list navigation on the left and the selected App or platform workspace on
  the right.
- Remove the global top Header. Put App Overview, Members, Invitations,
  Playground, and Change Logs in that order in top navigation within the
  selected App detail page.
- Put the signed-in user at the bottom of the left navigation and move
  Documentation, Connect AI tools, and Sign out into its profile menu.
- Show the Platform Administration navigation entry only when `/admin/me`
  reports effective Platform Admin authority, while retaining server-side route
  authorization as the security boundary.
- Preserve every existing Console workflow, loading/error/empty state, mobile
  behavior, browser cache boundary, and accessibility requirement through the
  rewrite.
- Make platform grant, revocation, App-creation denial, and related administrative
  actions observable through durable audit records.
- Define a bootstrap and migration path from `ADMIN_EMAIL_ALLOWLIST` that avoids
  locking out the initial Platform Admins and has an explicit rollback or
  break-glass procedure.
- Update source contracts, generated protocol artifacts, clients, tests,
  operations documentation, domain topology, and terminology where the settled
  design changes their current contracts.

## Out of scope

- A separate Platform Admin frontend deployment, hostname, or identity provider.
- A separately published design-system package or generic component library for
  products outside the UniCAS Console.
- Open registration, automatic authorization for any Google account, or public
  self-service App creation.
- An end-user application surface, App-owned end-user identity, Space-level ACLs,
  or changes to data-plane capability authorization.
- General-purpose organization, team, billing, subscription, or support-agent
  role systems.
- Changes to the frozen `unicas.shazhou.work` legacy environment.
- Implementing complete App suspension enforcement, App member invitation
  list/revoke APIs, or active custom issuer replacement; those are separate
  prerequisite tasks and this task consumes their accepted contracts in the
  Console.

## Dependencies

- [Enforce the App suspension boundary](/tasks/backlog/enforce-app-suspension-boundary/Task.md)
- [Manage App member invitations](/tasks/backlog/manage-app-member-invitations/Task.md)
- [Replace an active App OAuth issuer](/tasks/backlog/replace-active-app-oauth-issuer/Task.md)

## Design decisions to settle

- Choose the persistent platform-grant resource, capability vocabulary, storage
  ownership, revision model, and whether Platform Admin implicitly includes App
  creation.
- Decide whether existing equal-authority App membership remains the intended
  App-local role or whether App administration and App use require distinct
  membership roles. In either case, App membership must not imply App creation.
- Define how an email-constrained pending invitation passes the initial login
  gate without turning verified email into the long-term Principal identity or
  granting unrelated Console access.
- Define the Platform Admin HTTP resource hierarchy, error semantics,
  idempotency and concurrency controls, client surface, and the effective
  authorization fields returned by `/admin/me`.
- Design the Platform Admin routes, navigation, grant and revoke workflows,
  confirmation states, empty states, and audit views within the existing WebUI.
- Select the exact shadcn/ui base, generated components, Tailwind version,
  package aliases, theme tokens, and migration sequence for the existing Vite
  package without introducing another frontend workspace.
- Define bootstrap, migration, emergency access, session invalidation, MCP token
  invalidation, and cache-staleness behavior for grant revocation.
- Decide which authorization events belong in platform audit versus existing
  App control audit while preserving immutable Principal identity in both.

## Acceptance criteria

- [ ] A Google-authenticated Principal without a platform grant, an eligible
      pending invitation, or an existing App membership is denied Console, CLI,
      and remote MCP access without an authorization record being created
      implicitly.
- [ ] A Platform Admin can list effective platform access and grant or revoke
      Platform Admin and App-creation authority through protected APIs and the
      Platform Admin Console workspace.
- [ ] App creation succeeds only for a Principal with effective App-creation
      authority; an App member without that authority is denied by the server
      and is not offered App creation in the Console.
- [ ] An invited Principal outside the internal creator group can authenticate,
      accept an eligible invitation, and access only Apps authorized by its
      memberships without receiving platform or App-creation authority.
- [ ] Platform Admin APIs and UI routes fail closed for non-Platform Admins even
      when they hold valid App memberships or delegated OAuth scopes.
- [ ] Revoking a platform grant or App membership takes effect within a defined,
      tested bound for existing browser sessions and MCP access; revocation does
      not rely on hiding client-side controls.
- [ ] Platform grants, revocations, denied App-creation attempts, and relevant
      invitation transitions produce audit evidence keyed by immutable Principal
      identity and do not expose invitation tokens or authentication secrets.
- [ ] The production bootstrap and migration procedure establishes at least one
      Platform Admin, replaces the static allowlist as an authorization source
      without an access gap, and documents rollback and emergency recovery.
- [ ] The existing Console remains the single human frontend while App and
      Platform Admin workspaces retain separate route, code, and server-side
      permission boundaries.
- [ ] The Console uses reviewed, source-owned shadcn/ui primitives customized
  with UniCAS theme tokens; the previous generic component layer and
  superseded layout styles are removed rather than maintained in parallel.
- [ ] Desktop and mobile Console navigation make the App list primary, expose
  Platform Administration only to effective Platform Admins, and keep the
  signed-in profile and its Documentation, Connect AI tools, and Sign out
  actions at the navigation bottom.
- [ ] Selecting an App renders Overview, Members, Invitations, Playground, and
  Change Logs as top detail navigation in that order, with direct-linkable route
  state and no global top Header or second App switcher.
- [ ] Existing App creation, App settings, issuer, usage, Playground, member,
  invitation, audit, login-error, and logout workflows remain functionally
  covered after the component and navigation rewrite.
- [ ] Keyboard navigation, focus management, screen-reader semantics, reduced
  motion, narrow mobile viewports, long App names, and overflow behavior are
  verified for the new Sidebar, Tabs, menus, dialogs, tables, and states.
- [ ] Focused authorization, protocol, client, BFF, MCP, WebUI, migration, and
      audit tests cover allowed, denied, invitation, revocation, and privilege-
      escalation paths, and the relevant repository validation commands pass.

## Constraints

- Authoritative identity remains `(issuer, subject)`; verified email may
  constrain invitations or bootstrap migration but must not become the durable
  authorization key.
- OAuth scopes describe delegated operation classes and must not substitute for
  current platform grants or App membership checks.
- All security decisions are enforced server-side and default to denial when
  grant state is absent, stale beyond its allowed bound, or unavailable.
- Preserve the credential boundary between administrator sessions, MCP grants,
  and App/Space data-plane capabilities.
- Treat shadcn/ui as copied application source rather than an opaque runtime UI
  dependency; keep browser dependencies inside `@unicas/admin-webui` and
  preserve `[admin-webui] -> admin-client -> admin-protocol` direction.
- Use explicit idempotency and optimistic concurrency for grant mutations where
  retries or competing administrators could otherwise overwrite authority.
- Never place credentials, invitation bearer tokens, private profile data, or
  production Principal details in task artifacts, documentation, logs, or tests.

## References

- [Console UI redesign](./UiDesign.md)
- [Interactive Console mock](./ConsoleMock.html)
- [Platform access API design](./ApiDesign.md)
- [Superseded Platform-only exploration mock](./PlatformAdminMock.html)
- [UniCAS architecture](/docs/cas-architecture.md)
- [UniCAS control-plane CLI](/docs/cas-control-plane-cli.md)
- [UniCAS control-plane MCP](/docs/cas-control-plane-mcp.md)
- [UniCAS domain topology](/docs/domain-topology.md)
- [UniCAS terminology](/docs/terminology.md)
- [Admin WebUI application shell](/packages/admin-webui/src/ui/app.tsx)
- [Administrator BFF](/packages/service-cloudflare/src/admin-bff/bff.ts)

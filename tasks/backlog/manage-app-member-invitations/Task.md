# Manage App member invitations

Created: 2026-09-15

## Goal

Let an App administrator list the App's invitation lifecycle and revoke a
pending invitation without exposing bearer tokens, completing the existing
create-and-accept workflow.

## Context

UniCAS already persists App member invitations with pending, accepted, expired,
and revoked statuses. The v2 administrator contract can create an invitation
and accept its one-time bearer URL, but it cannot list or revoke invitations.
Consequently an administrator cannot review outstanding access, cancel a link
sent in error, or distinguish accepted and expired invitations in the Console.

The redesigned Members page uses Administrators and Invitations views and needs
the invitation lifecycle to be symmetric with Platform Administration.

## Scope

- Add snapshot-paginated v2 listing for one App's member invitations, with
  status filtering and no bearer token or accept URL in list responses.
- Add an optimistic-concurrency mutation that revokes a pending, unexpired
  invitation without physically deleting its audit-relevant record.
- Reconcile time-based expiry consistently so reads, acceptance, and revocation
  agree on effective invitation status.
- Expose the operations through admin protocol/OpenAPI, admin client, CLI, and
  MCP where the existing member security surface is available.
- Add App control audit events for invitation revocation and any newly explicit
  expiry transition needed by the accepted persistence design.
- Integrate the accepted contract into the Console Members invitation view and
  update operations documentation.

## Out of scope

- Platform authority invitations or Platform Principal management.
- Resending an invitation, extending its expiry, or recovering its bearer URL.
- App membership roles beyond the existing equal administrator authority.
- Email delivery; invitation URLs continue to be delivered through a trusted
  channel selected by the administrator.
- Permanent physical deletion of invitation or audit history.

## Acceptance criteria

- [ ] An App member can list that App's invitations with opaque snapshot-bound
      pagination and filter by pending, accepted, expired, or revoked status.
- [ ] List responses never contain the invitation token, token hash, accept URL,
      session data, or authentication secrets.
- [ ] A pending unexpired invitation can be conditionally revoked; stale
      revisions and non-pending invitations return stable conflict semantics.
- [ ] Expired invitations cannot be accepted or revoked and are represented
      consistently across list, accept, storage, and audit behavior.
- [ ] Invitation creation, acceptance, expiry, and revocation retain immutable
      App, actor, and Principal identity evidence without retaining bearer data.
- [ ] A member of another App and a non-member cannot list or revoke the target
      App's invitations.
- [ ] Console Administrators/Invitations navigation supports create, list,
      status, copy-on-create, and revoke workflows at desktop and mobile widths.
- [ ] Focused protocol, route, service, repository, client, CLI/MCP, WebUI, and
      security tests pass with relevant repository validation.

## Constraints

- Preserve the current short-lived, single-use invitation and verified-email
  constraint semantics.
- Use `Idempotency-Key` for creation and exact `If-Match` revision for
  revocation; never make a destructive retry ambiguous.
- Authoritative accepted identity remains `(issuer, subject)`; email remains a
  non-authoritative invitation constraint and display field.
- Keep App invitation authorization distinct from platform authority.

## References

- [Platform access API discussion](/tasks/backlog/add-platform-access-management/ApiDesign.md)
- [Console UI discussion](/tasks/backlog/add-platform-access-management/UiDesign.md)
- [App v2 contract](/packages/admin-protocol/src/app-v2-contract.ts)
- [App member UI](/packages/admin-webui/src/ui/views/members.tsx)
- [Control schema](/packages/service-cloudflare/src/control-schema.ts)

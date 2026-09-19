# Enforce the App suspension boundary

Created: 2026-09-15

## Goal

Make `App.status = suspended` a reversible, fail-closed emergency stop that
denies every Space data-plane operation within a defined bound while preserving
the App control-plane access required to inspect, repair, and restore it.

## Context

The v2 App contract already exposes `active | suspended`, and managed capability
issuance rejects a suspended App. However, the v2 App mutation does not accept a
status transition and issuer authority resolution currently selects active
issuer records without joining App status. Suspension therefore does not yet
provide a complete or externally operable App-wide boundary.

The Console redesign needs one unambiguous Suspend/Restore workflow. A partial
mode that blocks only new writes or only managed capability issuance would be
hard to explain and unsafe during incident response.

## Scope

- Extend conditional v2 App mutation to transition between `active` and
  `suspended` under the current App revision.
- Deny all Space data-plane read, write, and management operations for a
  suspended App, including requests using previously issued external or managed
  capabilities, within a documented bounded-staleness interval.
- Make authority resolution, protected-resource metadata, managed issuer
  documents, and managed capability issuance consistently respect App status.
- Keep authenticated App control-plane reads and recovery mutations available,
  including metadata, membership, invitations, issuer configuration, audit, and
  Restore.
- Add App control audit events and operational observability for suspend,
  restore, and suspended data-plane denials.
- Update protocol, generated OpenAPI, client, CLI/MCP surfaces, tests, and stable
  architecture/operations documentation.

## Out of scope

- App deletion, archival, data export, Root Ref release, or garbage collection.
- Removing memberships or issuer configuration when an App is suspended.
- Platform Principal blocking or platform authorization.
- Replacing the active custom OAuth issuer.
- Rebuilding the Console UI beyond consuming the accepted status contract.

## Acceptance criteria

- [x] An App administrator can conditionally suspend and restore an App through
      the v2 administrator contract, with stale revisions rejected.
- [x] While suspended, every App Space data-plane read, write, and management
      operation fails closed with one stable error regardless of managed or
      external issuer mode.
- [x] Capabilities issued before suspension stop authorizing within the defined
      and tested hard stale bound; refresh failure does not extend authority.
- [x] Protected-resource metadata, managed issuer documents, and managed
      capability issuance do not advertise or serve a suspended App as active.
- [x] App members can still inspect control-plane configuration and perform the
      explicitly allowed repair and recovery mutations, including Restore.
- [x] Suspension does not delete App data, change membership, remove issuer
      records, release Root Refs, or trigger garbage collection.
- [x] Suspend, restore, and representative denied data-plane requests produce
      useful audit/observability evidence without logging capabilities.
- [x] Focused service, Cloudflare adapter, protocol, client, CLI/MCP, cache-bound,
      and cross-issuer tests pass together with relevant repository validation.

## Constraints

- Use public status values `active` and `suspended` and product actions Suspend
  and Restore; do not introduce `inactive` or `deactivate` aliases.
- Preserve App and Space credential isolation and fail closed when status or
  authority state is stale beyond its allowed bound.
- Suspension is reversible operational state, not a retention or deletion
  mechanism.
- Preserve frozen v1 compatibility unless an explicit reviewed mapping is
  required to close a production privilege bypass.

## References

- [Platform access API discussion](/tasks/add-platform-access-management/ApiDesign.md)
- [Console UI discussion](/tasks/add-platform-access-management/UiDesign.md)
- [UniCAS architecture](/docs/cas-architecture.md)
- [App v2 contract](/packages/admin-protocol/src/app-v2-contract.ts)
- [Cloudflare authority resolver](/packages/service-cloudflare/src/control-authority.ts)

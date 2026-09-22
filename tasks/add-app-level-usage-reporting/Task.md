# Add App-level usage reporting

Created: 2026-09-21

## Goal

Give an authorized App administrator a current, trustworthy view of aggregate
CAS usage across every Space in that App through the Admin control plane and
the UniCAS Console, without requiring or minting a Space capability.

## Context

UniCAS currently calculates usage only for one exact App-and-Space partition
through `GET /v2/apps/{appId}/spaces/{spaceId}/cas/usage`. That data-plane
operation requires a `cas:usage:read` capability signed for the requested
Space. Its response reports node count, ready logical and physical bytes,
reserved bytes, not-ready nodes, and leased nodes.

The Console already shows a Usage card on App Overview, but it is intentionally
only explanatory text: an administrator session carries no Space capability,
and the Admin protocol and client expose no App usage operation. As a result,
an App administrator cannot inspect total App storage from the control plane,
even though App-scoped accounting state is available to the service adapter.

App usage must be an authoritative server-side aggregate, not browser fan-out
to guessed Spaces or reuse of an administrator credential on the Space data
plane. The implementation also needs a reviewed accounting strategy that is
accurate for reservations and physical storage without making the endpoint's
cost grow through one internal HTTP request per Space.

## Scope

- Define the App-level usage metric and aggregation contract. Preserve the
  meanings of the existing Space usage fields and count storage independently
  in each Space, including identical node hashes stored in different Spaces.
- Add a typed, authenticated Admin control-plane read operation for current
  App usage, with the existing App visibility and membership policy applied to
  known, unknown, suspended, and unauthorized Apps.
- Implement the cloud-neutral service operation and Cloudflare persistence
  adapter needed to aggregate all usage-bearing Space partitions for one App.
- Choose and document a bounded accounting strategy for ready logical bytes,
  ready physical bytes, upload reservations, not-ready nodes, and active
  leases. If a persisted projection is introduced, define its keys, update
  points, consistency model, repair/backfill behavior, and migration.
- Keep App aggregation inside the Admin service path. Do not enumerate or call
  Space data-plane routes, mint Space capabilities, or weaken the separation
  between administrator and data-access credentials.
- Extend `@unicas/admin-protocol` and `@unicas/admin-client` with the accepted
  request and response types while preserving the established dependency
  direction from WebUI to client to protocol.
- Replace the App Overview Usage placeholder with compact aggregate metrics
  and explicit first-load, empty, refresh, and error behavior consistent with
  the existing Console design.
- Add focused protocol, authorization, service, Cloudflare adapter/BFF,
  client, and WebUI tests, including cross-App isolation and aggregation over
  multiple Spaces.
- Update stable control-plane, operations, architecture, and terminology
  documentation with the accepted endpoint, metric semantics, authorization
  boundary, consistency guarantees, and operational limitations.

## Out of scope

- Changing the existing Space usage route, `cas:usage:read` permission, Space
  capability format, or App-user data-plane workflow.
- Adding per-Space browsing, Space registration or lifecycle management, or a
  list of Space identifiers to the administrator surface.
- Usage history, charts, billing, chargeback, quotas, rate limits, alerts,
  retention policy, forecasting, or export/report scheduling.
- Deduplicating bytes across Spaces merely because their node hashes match;
  Space remains the storage ownership and accounting boundary.
- Changing node, lease, upload reservation, Root Ref, garbage collection, or
  application suspension semantics except where an accounting projection must
  observe their existing state transitions.
- Migrating the Console broadly to a new query-cache architecture; this task
  uses the query conventions present when implementation begins.
- Modifying the frozen `unicas.shazhou.work` environment or migrating its
  production data.

## Acceptance criteria

- [ ] The Admin protocol publishes one typed App usage read operation whose
      field definitions, validation, generated interface artifacts, and client
      behavior agree with the reviewed contract.
- [ ] An authorized administrator can read usage for an App without a Space
      capability; unauthorized and cross-App requests retain the Admin
      plane's established concealment and denial behavior.
- [ ] For an App with multiple Spaces, every reported total equals the sum of
      the corresponding Space-owned accounting state, including duplicate
      hashes in distinct Spaces and reservation-only state.
- [ ] An App with no usage-bearing state returns a successful zero-valued
      report, and suspended-App behavior matches the reviewed control-plane
      policy without changing Space data-plane behavior.
- [ ] Ready logical bytes, ready physical bytes, reserved bytes, not-ready node
      count, and leased node count remain semantically consistent with Space
      usage during lease, upload, replacement, expiration, and garbage
      collection transitions.
- [ ] The production read uses a reviewed bounded server-side aggregation or
      projection strategy and does not discover Spaces by client-side or
      internal HTTP fan-out to the Space data plane.
- [ ] App Overview renders current aggregate usage with accessible labels and
      stable number/byte formatting, plus tested loading, zero, refresh, and
      recoverable error states; the explanatory placeholder is removed.
- [ ] Focused tests prove multi-Space aggregation, reservation and physical
      byte accounting, empty state, cross-App isolation, authorization,
      client decoding, and Console state rendering.
- [ ] Existing Space usage, capability authorization, upload, lease, GC, and
      App administration regression suites continue to pass.
- [ ] The user explicitly accepts the implemented API, accounting semantics,
      and Console result for the exact reviewed primary commit.

## Constraints

- App usage is a derived read over Space-owned state; it must not become a new
  ownership boundary or allow an administrator credential to access node
  content, metadata, Root Refs, GC, or other Space operations.
- Scope every repository query, projection key, cache key, and authorization
  decision by exact `appId`; never infer App ownership from a caller-supplied
  Space identifier.
- Preserve existing Space metric definitions unless interface review approves
  and documents a coordinated compatibility change for both surfaces.
- Define consistency honestly across D1 metadata and R2 object state. Do not
  present an estimate as exact or silently omit incomplete uploads,
  reservations, replacement objects, or asynchronous repair windows.
- Keep the cloud-neutral accounting semantics and ports in `@unicas/service`;
  keep D1, R2, Durable Object, migration, and BFF details in
  `@unicas/service-cloudflare`.
- Keep `@unicas/admin-client` a thin transport wrapper and keep rendering and
  formatting policy in `@unicas/admin-webui`.
- Coordinate WebUI data loading with
  [the Admin query-cache task](../adopt-admin-webui-query-cache/Task.md) and
  implementation naming with
  [the App/Space concept-refactor task](../complete-app-space-concept-refactor/Task.md)
  without absorbing either task's independent outcome.
- Do not edit generated `dist`, OpenAPI, or bundled UI assets by hand;
  regenerate tracked artifacts from their source definitions.
- Never place administrator sessions, Space capabilities, presigned URLs,
  production identifiers, or customer usage data in task artifacts, fixtures,
  logs, or documentation.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's goal, aggregate-only boundary, included package surfaces, exclusions, constraints, acceptance criteria, and coordination with adjacent backlog tasks. | Substantive implementation. |
| Interface | Required | User or delegated API and Console owner | Task-local contract and UI review covering route, response fields, metric definitions, authorization/error behavior, loading/empty/error states, formatting, and compatibility with the existing Space usage API. | Changing the Admin protocol/client, generated interface, BFF route, or Console Usage view. |
| Business and data model | Required | User or delegated data owner | Task-local model review covering the App aggregate's derivation from Space-owned nodes and reservations, duplicate-hash treatment, projection keys and lifecycle if used, consistency, repair/backfill, and migration impact. | Adding or changing persisted accounting state, update hooks, repair logic, or migration behavior. |
| Architecture | Required | User or delegated architecture owner | Task-local design covering control-plane authorization, service and adapter ownership, bounded aggregation strategy, D1/R2 consistency, failure behavior, and observability. | Implementing the aggregate service path or Cloudflare storage/BFF integration. |
| Delivery acceptance | Required | Requesting user | Published implementation, reviewed API/UI and accounting result, focused automated evidence, migration/repair evidence when applicable, and manual Console verification. | Running `task complete` for the exact approved primary commit. |

## References

- [Current Console Usage placeholder](/packages/admin-webui/src/ui/views/usage.tsx)
- [Space usage protocol contract](/packages/space-protocol/src/space-contract.ts)
- [Cloud-neutral Space usage operation](/packages/service/src/node-usage.ts)
- [Cloudflare usage repository](/packages/service-cloudflare/src/node-usage.ts)
- [Admin protocol](/packages/admin-protocol/src/app-v2-contract.ts)
- [Admin client](/packages/admin-client/src/client.ts)
- [App-user HTTP usage reference](/packages/docs-site/content/app-user-api/http-api.md)
- [CAS architecture](/packages/docs-site/content/cas-architecture.md)
- [Admin package boundaries](/.github/instructions/packages.instructions.md)
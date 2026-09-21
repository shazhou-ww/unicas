# Split App Space operation permissions

Created: 2026-09-20

## Goal

Replace the coarse App/Space v2 `cas:read`, `cas:write`, and `cas:manage`
authorization buckets with independently grantable operation authorities so an
App client can lease and upload nodes without gaining authority to mutate
durable Root Ref state, while App backends, client-only Apps, and operators can
receive only the additional capabilities their workflows require.

## Context

The public v2 Space API currently maps node content and metadata reads plus
Root Ref listing to `cas:read`, node lease/upload plus Root Ref updates to
`cas:write`, and usage inspection plus garbage collection to `cas:manage`.
The service enforces those three exact permission strings, but the grouping
crosses distinct trust boundaries.

In the common App architecture, a frontend may safely prepare immutable state
by reading, leasing, and uploading nodes. Updating Root Refs commits or
releases durable business state and should normally remain with the App
backend because it must coordinate that transition with the App database.
Client-only Apps may deliberately grant that authority, but doing so must be
an explicit capability decision rather than a consequence of granting lease
authority. Root Ref visibility, Space accounting, and garbage collection are
also independent authorities and should not be coupled to generic read or
manage buckets.

The ongoing [Redesign node upload through lease](/tasks/complete-direct-node-upload/Task.md)
task changes the lease/upload contract but explicitly leaves Root Ref semantics
and authorization unchanged. Implement this task from that task's integrated
protocol and lease behavior rather than duplicating or reverting its work.

## Scope

- Define an App/Space capability vocabulary with independent authorities for
  node reads, node lease/upload, Root Ref listing, Root Ref updates, usage
  inspection, and garbage collection. Keep the required signed `spaceId` claim
  as the sole Space scope; do not duplicate it in v3 permission strings.
- Preserve one authority for content and metadata reads and one authority for
  the inseparable lease/direct-upload workflow; do not split individual HTTP
  steps that cannot be completed independently.
- Map every public v2 Space operation to exactly one required operation
  permission, with `refDomain` remaining an additional requirement for Root
  Ref listing and updates.
- Enforce that permissions do not imply one another. In particular, lease
  authority must not authorize Root Ref updates, and Root Ref update authority
  must not authorize lease/upload.
- Update the capability parser, constructors, exported protocol types, service
  verifier, authorization tests, generated OpenAPI descriptions, and App-user
  API documentation to the accepted vocabulary and matrix.
- Document recommended issuance profiles: client data preparation, App-backend
  Root Ref coordination, explicitly authorized client-only Apps, and
  operational usage/GC workflows.
- Define and test the compatibility and rollout treatment for existing Space
  v2 `cas:read`, `cas:write`, and `cas:manage` capabilities, including
  outstanding token lifetime and capability-version implications.
- Keep authorization failures stable and verify that missing exact authority
  returns `insufficient_permission` without client-side privilege escalation.

## Out of scope

- Changing Stack/Tenant v1 capability vocabulary or reinterpreting v1 tokens
  as App/Space permissions.
- Changing node identity, lease duration, upload, Root Ref accounting,
  idempotency, retention, usage, or garbage-collection semantics.
- Making the App database and UniCAS Root Ref commit one distributed atomic
  transaction; Apps continue to own durable workflow orchestration, stable
  request IDs, retry, and reconciliation.
- Requiring mTLS, DPoP, a registered OAuth client identifier, a separate
  issuer, or another proof that a bearer capability is physically used by an
  App backend. UniCAS enforces signed authority; the App issuer owns token
  delivery unless a later task introduces caller binding.
- Adding new HTTP operations or changing existing request and response bodies.
- Separating immutable node metadata from mutable retention-state visibility.
- Redesigning Space quotas, rate limits, upload bounds, or maximum lease
  duration.

## Acceptance criteria

- [ ] The published Space capability contract defines distinct canonical
  permissions for node read, node lease/upload, Root Ref read, Root Ref
  update, usage read, and GC execution.
- [ ] Every public v2 Space route has one documented and server-enforced exact
      permission; no operation is authorized by category inheritance or a
      different operation's permission.
- [ ] A capability containing node lease/upload authority can complete the
      lease and direct-upload workflow but receives `403
      insufficient_permission` for Root Ref update.
- [ ] A capability containing Root Ref update authority and a valid
      `refDomain` can atomically update that domain but receives `403
      insufficient_permission` for node lease/upload.
- [ ] Root Ref read is independent of node read, and both Root Ref operations
      continue to reject a missing, invalid, or reserved `refDomain`.
- [ ] Usage inspection is independently grantable without GC authority, and
      GC authority does not implicitly grant usage inspection or data access.
- [ ] App-user guidance identifies node lease/upload as the normal frontend
      write authority, Root Ref update as backend-only by default, and
      client-only Root Ref update as an explicit App authorization choice.
- [ ] The accepted migration plan prevents legacy broad Space permissions from
      remaining a steady-state path to combined authorities and accounts for
      already-issued tokens, rollout ordering, and capability versioning.
- [ ] Protocol parsing and construction tests, service authorization tests,
      generated OpenAPI drift checks, and documentation checks pass with the
      accepted permission matrix.
- [ ] Stack/Tenant v1 permission parsing and authorization behavior remain
      unchanged and its focused regression tests pass.
- [ ] The user explicitly accepts the implemented authorization contract for
      the exact reviewed primary commit.

## Constraints

- Preserve the administrator and Space data-plane credential boundary.
- Treat the verified issuer as the App authority and never trust permissions,
  Space identity, App identity, or `refDomain` from an unsigned request field.
- Keep every capability scoped to one exact signed `spaceId`; do not duplicate
  `spaceId` in v3 permission strings, and continue matching issuer-derived
  App, claim Space, and route resources.
- Do not retain `cas:write` as an indefinite compatibility alias that grants
  both lease and Root Ref update after the migration window.
- Do not infer backend origin from a bearer token. Backend-only-by-default is
  an issuance rule unless a separately reviewed caller-binding mechanism is
  implemented.
- Coordinate implementation with the integrated direct-node-upload contract;
  do not overwrite concurrent lease protocol or documentation changes.
- Never place bearer capabilities, signing keys, presigned URLs, production
  identities, or customer data in tasks, documentation, fixtures, or logs.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's goal, six authority boundaries, exclusions, constraints, acceptance criteria, and sequencing with direct node upload. | Substantive implementation. |
| Interface | Required | Requesting user | Task-local permission and migration design covering exact wire strings, route matrix, capability versioning, denial behavior, issuance profiles, and OpenAPI/documentation impact. | Changing the public capability protocol, verifier, generated OpenAPI, or App-user guidance. |
| Business and data model | Not applicable: App, Space, Principal, Root Ref domain, node, lease, and retention ownership and lifecycle remain unchanged; this task changes authorization vocabulary and policy only. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user | Task-local authorization-boundary design covering issuer responsibility, browser/backend trust assumptions, service enforcement, package ownership, rollout ordering, and coordination with direct node upload. | Changing protocol and service authorization behavior. |
| Delivery acceptance | Required | Requesting user | Published implementation, permission matrix and compatibility diff, focused protocol/service/v1 regression results, OpenAPI and documentation validation, and recorded limitations. | Running `task complete` for the exact approved primary commit. |

## References

- [Capability vocabulary](/packages/space-protocol/src/space-capability.ts)
- [Space capability verifier](/packages/service/src/app-space-auth.ts)
- [Space v2 contract](/packages/space-protocol/src/space-v2-contract.ts)
- [Space v2 OpenAPI](/packages/space-protocol/openapi/space-v2.openapi.json)
- [App-user authorization guide](/docs/app-user-api/authorization.md)
- [App-user HTTP operation reference](/docs/app-user-api/http-api.md)
- [Direct node upload task](/tasks/complete-direct-node-upload/Task.md)
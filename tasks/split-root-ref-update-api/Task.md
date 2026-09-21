# Split Root Ref updates by direction

Created: 2026-09-21

## Goal

Replace the App/Space v2 mixed-sign Root Ref update API with separate atomic
increase and decrease operations so each business branch exposes only its
valid inputs, validation work, and garbage-collection effect.

## Context

The current `POST /v2/apps/{appId}/spaces/{spaceId}/root-refs` operation and
public client method accept one map of signed deltas. A batch may therefore
mix acquiring and releasing Root Refs even though those actions have different
preconditions and operational consequences.

Increasing a Root Ref must prove that every target node is ready, but cannot
make a node newly eligible for garbage collection. Decreasing a Root Ref only
needs to prove that every resulting aggregate count is non-negative and can
make released state collectible. Under the existing invariant that only ready
nodes can have a positive Root Ref count, an absent or unready node has an
effective count of zero and a positive decrement necessarily fails the
non-negative-count check; the decrease path does not need a separate readiness
or object-presence lookup.

The completed direct-node-upload task preserved these Root Ref rules, while
the ongoing Space-operation-permissions task explicitly excludes new HTTP
operations. This task owns the directional API split and must consume the
permission vocabulary that is ultimately integrated by that task.

## Scope

- Define separate App/Space v2 Root Ref increase and decrease HTTP operations,
  protocol types, route identifiers, and public client methods. Each request
  carries a non-empty bounded map of positive integer amounts; signed or
  mixed-direction public batches are not accepted.
- Keep each directional batch atomic within one `(appId, spaceId, refDomain)`
  scope and preserve stable request-ID retries, ordered domain revisions,
  aggregate counts, domain projections, and signed audit deltas.
- Make increase validate every target against the existing ready-node
  invariant without reparsing canonical content or traversing the Merkle DAG,
  then reject the complete batch if any target is absent or unready.
- Make decrease treat an absent aggregate balance as zero and perform only the
  state reads needed to prove that every resulting Root Ref count is
  non-negative; do not perform node-readiness or object-storage checks.
- Hint bounded Space garbage collection after a newly committed decrease in a
  retry-safe, coalesced manner. Do not hint GC for increases, rejected
  requests, or validation-only work.
- Bind idempotency to the mutation direction as well as the canonical amount
  map so opposite operations cannot be mistaken for the same request, while an
  exact retry returns the original result without applying counts twice.
- Define and document migration from a mixed add/remove batch to an
  increase-first, decrease-second workflow with distinct stable request IDs,
  including recovery after either response is lost or execution stops between
  the two calls.
- Remove the mixed-sign update operation from the App/Space v2 contract,
  generated OpenAPI, public v2 client surface, higher-level client workflows,
  service routing, documentation, examples, and tests according to the
  reviewed compatibility plan.
- Map both directional operations to the accepted Root Ref mutation authority
  and signed `refDomain` requirement from the Space-operation-permissions task;
  do not infer direction or authorization from unsigned request data.
- Update the cloud-neutral service core, Cloudflare Durable Object and storage
  adapter, audit behavior, focused tests, stable architecture and operations
  documentation, and App-user API guidance to the accepted contract.

## Out of scope

- Changing Root Ref ownership, aggregate-balance meaning, domain projections,
  audit revision ordering, node identity, or the rule that only ready nodes
  may acquire positive Root Refs.
- Granting separate capability permissions for increase and decrease.
- Making an increase and a decrease one cross-operation atomic transaction;
  callers preserve safety by increasing replacement roots before decreasing
  superseded roots and reconcile any temporary retained-reference surplus.
- Running a full synchronous garbage-collection pass as part of a decrease or
  changing GC eligibility, traversal, fencing, or deletion semantics.
- Revalidating canonical node bytes or traversing descendants during a Root
  Ref increase.
- Changing the frozen Stack/Tenant v1 wire contract or its compatibility
  client behavior.
- Changing node lease, direct-upload, usage, quota, or Root Ref listing
  behavior beyond updates required to expose the two mutation operations.

## Acceptance criteria

- [ ] App/Space v2 exposes distinct Root Ref increase and decrease operations
      in the protocol, generated OpenAPI, public client, and service, and no
      v2 operation accepts a mixed map of signed deltas.
- [ ] Both operations accept only non-empty, bounded maps of positive safe
      integer amounts and reject zero, negative, fractional, overflowing,
      duplicate-key, invalid-hash, and over-limit inputs before mutation.
- [ ] An increase atomically succeeds only when every target node is ready and
      every resulting count is safe; absent or unready targets reject the
      complete batch without canonical-content parsing or DAG traversal.
- [ ] A decrease performs no readiness or object-storage lookup, treats a
      missing aggregate balance as zero, and atomically rejects the complete
      batch when any resulting Root Ref count would be negative.
- [ ] A newly committed decrease schedules or coalesces a bounded GC hint only
      after its durable Root Ref commit. Increases and rejected requests do not
      hint GC, and retries cannot apply a decrement or create audit history
      twice.
- [ ] Exact retries return the original revision and result, while request-ID
      reuse cannot confuse increase with decrease or one canonical amount map
      with another.
- [ ] Directional operations preserve one atomic signed audit event, one
      ordered `(appId, refDomain)` revision, aggregate counts, and domain
      projections per newly committed request without requiring a persistence
      migration unless the reviewed design demonstrates one is necessary.
- [ ] Both operations require the final exact Root Ref mutation permission and
      valid signed `refDomain`; neither gains node lease, Root Ref read, usage,
      or GC-execution authority.
- [ ] Existing mixed-direction callers migrate to increase-first then
      decrease-second requests with distinct deterministic IDs, and documented
      retry/reconciliation behavior prevents premature release if execution
      fails between calls.
- [ ] Frozen Stack/Tenant v1 Root Ref requests and authorization behavior remain
      unchanged and focused v1 regressions pass.
- [ ] Focused protocol, OpenAPI, client, higher-level client, cloud-neutral
      service, Cloudflare adapter, audit, GC-hint, authorization, documentation,
      and migration tests pass.
- [ ] The user explicitly accepts the implemented directional Root Ref
      contract for the exact reviewed primary commit.

## Constraints

- Preserve the administrator and Space data-plane credential boundary and
  derive App, Space, and Root Ref domain only from verified authority and route
  identity.
- Preserve keyed single-writer mutation and the durable GC fence; no GC work
  may race an in-flight Root Ref commit or observe an uncommitted decrease.
- Keep readiness authoritative at the existing service/storage boundary and
  preserve the invariant that a positive Root Ref cannot name an unready node.
- Keep request IDs non-secret and bounded, and never place bearer capabilities,
  signing keys, presigned URLs, production object identities, or customer data
  in tasks, documentation, fixtures, logs, or commits.
- Coordinate with `/tasks/split-app-space-operation-permissions/Task.md` and
  integrate from its accepted capability vocabulary without overwriting its
  concurrent protocol or service changes.
- Coordinate higher-level client migration with
  `/tasks/build-file-upload-smoke-app/Task.md` if that task consumes Root Ref
  mutation APIs before this task is delivered.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's directional split, validation rules, GC effect, compatibility break, migration sequence, exclusions, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | Required | Requesting user | Task-local API design covering exact routes, operation IDs, request and response schemas, errors, client methods, authorization mapping, v2 retirement, v1 compatibility, and caller migration. | Changing the public protocol, generated OpenAPI, clients, routes, or App-user guidance. |
| Business and data model | Not applicable: Root Ref balances, App/Space/refDomain ownership, domain projections, signed audit events, revisions, and retention lifecycle keep their existing meaning. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user | Task-local design covering directional service commands, readiness and count reads, idempotency identity, atomic audit persistence, commit-to-GC-hint ordering, Durable Object fencing, and coordination with the permission task. | Changing the service core, Cloudflare adapter, persistence flow, or GC scheduling. |
| Delivery acceptance | Required | Requesting user | Published implementation, public contract and migration diff, focused v1/v2 and GC-hint validation, and recorded limitations. | Running `task complete` for the exact approved primary commit. |

## References

- [Space v2 protocol contract](/packages/tenant-protocol/src/space-v2-contract.ts)
- [Public tenant client](/packages/tenant-client/src/client.ts)
- [Cloud-neutral Root Ref service](/packages/service/src/root-refs.ts)
- [Cloudflare Root Ref adapter](/packages/service-cloudflare/src/root-refs.ts)
- [CAS architecture](/docs/cas-architecture.md)
- [State protection and garbage collection](/docs/cas-state-protection-and-gc.md)
- [App-user HTTP API](/docs/app-user-api/http-api.md)
- [Completed direct-node-upload task](/tasks/complete-direct-node-upload/Task.md)
- [Space operation permissions task](/tasks/split-app-space-operation-permissions/Task.md)
- [File upload smoke App task](/tasks/build-file-upload-smoke-app/Task.md)
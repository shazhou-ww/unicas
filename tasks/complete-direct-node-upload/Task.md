# Complete direct node upload

Created: 2026-09-20

## Goal

Make direct-to-object-storage node upload the reviewed public v2 upload path,
and make large chunked blob writes bounded, recoverable, and safe across slow
uploads, retries, concurrency, and process failure without introducing a
server-owned file or blob transaction.

## Context

UniCAS currently supports two node upload modes on the same lease route. The
newer flow prepares an upload session, lets the client write canonical bytes
to a short-lived presigned object-storage target, and finalizes the lease after
server-side verification. The older compatibility flow still sends canonical
bytes in the authenticated lease request, remains the public client's default,
and is still exposed by the v2 contract and documentation.

The blob client already splits large content into deterministic content nodes
and bounded-fanout index nodes. However, writes are sequential, canonical node
encoding makes avoidable full-size copies, lease lifetime is not managed for a
long-running uncommitted tree frontier, and no durable caller-owned checkpoint
supports resuming a large write after process failure. Direct upload must be
completed together with a reviewed large-blob strategy rather than treated as
only removal of a transport flag.

## Scope

- Review and define the public v2 node upload state machine, request sequence,
  idempotency, expiry, conflict, cancellation, and retry behavior.
- Decide and implement the compatibility transition from inline lease bodies
  to bodyless prepare and finalize requests around a direct canonical-object
  upload, including generated OpenAPI and public client behavior.
- Preserve node-level CAS ownership: large blob chunking and index construction
  remain client-side, and UniCAS does not acquire a file-upload transaction or
  application-specific blob lifecycle.
- Define and implement bounded large-blob upload concurrency while preserving
  deterministic chunk order and blob-index hashes.
- Reduce avoidable canonical-node memory copies before enabling concurrency,
  with explicit browser and Worker memory bounds.
- Define how long-running writes keep the minimal uncommitted DAG frontier
  leased until a ready parent protects its children and the final root can be
  committed.
- Review and, if accepted, implement an App-owned checkpoint/resume contract
  for deterministic chunk progress and index frontier state.
- Measure per-node control-request overhead and decide from evidence whether a
  batch prepare or finalize operation is warranted; do not add one by default.
- Update protocol, service, Cloudflare adapter, clients, tests, architecture,
  operations, and App-user API guidance to one consistent accepted model.
- Document deployment prerequisites and migration sequencing for presigned R2
  uploads before removing any production fallback.

## Out of scope

- Moving blob chunking, file formats, business root catalogs, or file-upload
  sessions into the UniCAS service.
- Changing canonical node identity, blob-index encoding, Root Ref semantics, or
  the rule that only a positive Root Ref represents committed durable state.
- Adding R2 multipart upload for an individual canonical node unless measured
  platform limits prove it necessary within the accepted design.
- Defining one universal chunk size, concurrency level, or checkpoint storage
  backend for every App environment.
- Reintroducing frozen Stack/Tenant v1 wire vocabulary into public v2 APIs.

## Acceptance criteria

- [ ] A reviewed design specifies the node upload state machine and exact
      prepare, object PUT, finalize, retry, expiry, conflict, and cancellation
      behavior.
- [ ] The accepted v2 contract exposes one coherent upload model, and public
      client defaults cannot silently select the legacy inline-body path.
- [ ] Large blobs still produce deterministic node and index hashes under
      bounded upload concurrency, including partial final chunks and multiple
      index levels.
- [ ] Peak client memory is bounded and covered by tests or measurements that
      account for chunk buffers, canonical encoding, hashing, and concurrent
      uploads.
- [ ] Slow writes cannot lose early ready nodes solely because construction of
      their parent or final root exceeds the original lease window.
- [ ] Interrupted prepare, PUT, finalize, chunk-tree construction, and final
      Root Ref commit paths have documented and tested recovery behavior.
- [ ] Any checkpoint format is versioned, caller-owned, safe to publish, and
      validated against source identity and deterministic blob construction;
      if checkpoints are rejected, the reviewed alternative is documented.
- [ ] Presigned upload authorization is scoped, short-lived, write-once, bound
      to the expected object and length, and never exposes App capability or
      object-storage credentials.
- [ ] Protocol, generated OpenAPI, clients, service authorization, deployment
      configuration, and public documentation agree, with legacy behavior
      either removed or governed by an explicit reviewed migration window.
- [ ] Focused protocol, client, service, Cloudflare adapter, blob, OpenAPI, and
      documentation checks pass, including large-input, retry, race, expiry,
      and cleanup cases.
- [ ] The user explicitly accepts the implemented upload and large-blob model
      for the exact reviewed primary commit.

## Constraints

- Keep administrator and Space data-plane credentials separate. Presigned
  object PUT requests must not carry the App capability.
- Treat the server as the authority for canonical digest, envelope, child
  readiness, lease, and immutable publication checks; client hashing is an
  optimization and identity calculation, not the security boundary.
- Keep temporary uploads non-readable and non-referenceable until finalize
  succeeds. Failed or expired uploads must be safely reclaimable.
- Preserve deterministic blob trees independently of scheduling and retries.
- Bound concurrency and memory explicitly; do not derive defaults solely from
  desktop Node.js behavior.
- Prefer per-node idempotency and recovery over a server-owned distributed
  transaction spanning an entire blob.
- Never place access keys, bearer capabilities, presigned URLs, production
  object identities, or customer data in tasks, docs, fixtures, or logs.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | Problem statement, compatibility boundary, large-blob risks, candidate delivery slices, exclusions, and acceptance criteria. | Substantive implementation work. |
| Interface | Required | Requesting user | Proposed v2 sequence and schemas, client API transition, retry/error table, checkpoint contract decision, and compatibility plan. | Changing the public protocol, generated OpenAPI, or public client defaults. |
| Business and data model | Not applicable: canonical nodes, blob indexes, Root Refs, ownership, and business lifecycle remain unchanged; any optional checkpoint is caller-owned operational state rather than a UniCAS domain entity. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user | Upload trust-boundary diagram, object-storage authorization and cleanup design, bounded-concurrency and memory model, lease-frontier algorithm, and deployment migration. | Changing service/object-storage responsibilities or removing the inline fallback. |
| Delivery acceptance | Required | Requesting user | Published implementation, migration and operational guidance, protocol/OpenAPI diff, focused validation, memory and large-blob evidence, and recorded limitations. | Running `task complete` for the exact approved primary commit. |

## References

- [Space v2 contract](/packages/tenant-protocol/src/space-v2-contract.ts)
- [Node lease service kernel](/packages/service/src/node-lease.ts)
- [Cloudflare node upload adapter](/packages/service-cloudflare/src/tenant-do.ts)
- [R2 upload presigner](/packages/service-cloudflare/src/r2-upload-presigner.ts)
- [Public tenant client](/packages/tenant-client/src/client.ts)
- [Blob client](/packages/tenant-blob-client/src/blob-client.ts)
- [Blob index profile](/packages/tenant-blob-client/src/blob-index.ts)
- [Canonical binary format](/docs/cas-binary-format.md)
- [State protection and garbage collection](/docs/cas-state-protection-and-gc.md)
- [App-user HTTP API](/docs/app-user-api/http-api.md)
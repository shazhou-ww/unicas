# Redesign node upload through lease

Created: 2026-09-20

Revised: 2026-09-20

## Goal

Replace the public v2 node upload contract with one hash-addressed lease operation
that lets clients optimistically reuse an existing node and, only when the node
is absent, obtain a direct object-storage upload target. Repeating the same
lease request after upload must let UniCAS validate and publish the node without
a client-visible upload ID, canonical length, inline body, or compatibility
mode.

## Context

UniCAS already implements a three-phase direct upload:

1. prepare through the authenticated node lease route;
2. upload canonical node bytes to a presigned temporary R2 target; and
3. finalize through the same authenticated lease route.

The current public contract nevertheless multiplexes prepare, finalize, inline
upload, and renewal through optional headers and an optional body. The public
client defaults to inline upload and requires an explicit direct-upload mode.
The client also carries an opaque upload ID from prepare to finalize.

That shape is unnecessarily stateful for callers. A CAS client commonly knows
only a node hash and expects the node to be reusable. It should be able to ask
for a lease without downloading metadata or knowing the canonical object's
length. If the node is absent, UniCAS should return the next required upload
step and retain all upload correlation and fencing state internally.

The current implementation is recorded in
[CurrentThreePhaseImplementation.md](./CurrentThreePhaseImplementation.md).
The proposed replacement is specified in
[LeaseUploadDesign.md](./LeaseUploadDesign.md).

## Scope

- Redesign the public v2 node lease operation as one hash-addressed request
  whose JSON body contains only a required `leaseDurationMs` property; public
  clients apply its documented default before serialization.
- Make the first lease attempt and the post-upload lease attempt identical.
- Return a ready lease, ordinary upload instructions, replacement upload
  instructions with rejection details, or all unready child hashes as a
  response discriminated only by `state`.
- Remove public upload IDs, upload-length declarations, inline canonical
  request bodies, and client-selectable upload modes.
- Keep upload session identity, generation fencing, temporary object identity,
  expiry, and cleanup entirely inside UniCAS.
- Upload one complete canonical CAS node object, not raw business content. Its
  hash is the SHA-256 digest of the complete canonical binary encoding,
  including content type and ordered child references.
- Keep canonical refs authoritative in the R2 object and project them into D1
  edges and child reference counts when the node first becomes ready.
- Perform complete node validation exactly once per
  `(appId, spaceId, hash)`, when a repeated lease request promotes an uploaded
  object to ready.
- Keep ready-node lease renewal as the fast path without metadata download,
  content parsing, or hash recomputation.
- Keep positive Root Ref updates restricted to ready nodes without repeating
  canonical-node validation or traversing the Merkle DAG.
- Enforce the 32 MiB canonical-node limit before publication and document the
  accepted temporary-upload exposure when the presigned PUT is not bound to an
  exact content length.
- Review and implement presigned-upload checksum binding where supported so
  object storage can reject bytes that do not match the path hash.
- Define deterministic behavior for concurrent lease attempts, repeated PUTs,
  expired signing URLs, abandoned uploads, invalid objects, process failure,
  cleanup, and retry.
- Update protocol types, generated OpenAPI, public clients, service kernel,
  Cloudflare adapter, tests, architecture, operations, and App-user API
  guidance to the accepted model.

## Out of scope

- Preserving the current inline-body upload path, upload headers, upload ID, or
  `uploadMode` compatibility switch.
- Changing canonical node identity or the canonical binary format.
- Moving child references out of canonical node bytes or making D1 their source
  of truth.
- Moving blob chunking, blob-index encoding, file formats, business root
  catalogs, or file-upload transactions into UniCAS.
- Redesigning large-blob chunk size, upload concurrency, checkpoint formats, or
  client-side DAG construction beyond changes required by the new node upload
  contract.
- Introducing global cross-App or cross-Space node identity, validation,
  deduplication, lease, quota, or garbage-collection state.
- Adding multipart upload for an individual canonical node.
- Changing Root Ref semantics or the rule that only a positive Root Ref
  represents committed durable state.
- Reintroducing frozen Stack/Tenant v1 vocabulary into the public v2 API.

## Acceptance criteria

- [ ] The v2 contract exposes one node lease request identified by App, Space,
      and node hash, with a required JSON `leaseDurationMs` property and no
      upload length, upload ID, canonical bytes, custom lease header, or
      upload-mode selector.
- [ ] The same lease request returns a ready lease for an existing node,
      upload instructions for an absent node, all unready child hashes for a
      validated blocked node, replacement instructions after rejecting an
      upload, and a ready lease after a valid upload can be published.
- [ ] Normalized request types contain only required properties; values that
      callers may omit have documented defaults applied at the boundary.
- [ ] Each successful lease response is a strict discriminated-union member
      with required properties and uses `state` as its sole lifecycle
      discriminator; no optional property, parallel `reason`, or nested status
      code substitutes for another response variant.
- [ ] Upload state is derived from the node ready flag, durable validation
      evidence, the current upload-authorization record, and R2 object
      presence; no separate persisted state enum is introduced.
- [ ] `lease` is the only active state-machine signal. Direct PUT and time only
      change observable storage or expiry facts; neither can publish a node
      without a subsequent lease.
- [ ] A caller that knows only an existing node hash can acquire or renew its
      lease without reading node metadata or content.
- [ ] The client carries no upload-session identity. UniCAS safely fences stale
      and concurrent uploads using only internal state and unique object keys.
- [ ] The direct PUT carries a complete canonical node block. Node publication
      verifies the full block hash, canonical envelope, size limit, immutable
      metadata, ordered refs, and child readiness exactly once before marking
      the node ready.
- [ ] Ready-node lease renewal and positive Root Ref updates do not repeat
      canonical parsing or Merkle DAG validation.
- [ ] R2 canonical bytes remain the authoritative representation of ordered
      refs; D1 edges and child reference counts are a rebuildable projection.
- [ ] Presigned upload authorization is short-lived, write-once, bound to the
      expected object identity, and does not expose App capability or
      object-storage credentials.
- [ ] The accepted design explicitly records whether R2 can enforce the node
      checksum during presigned PUT and the residual exposure when the 32 MiB
      limit is enforced only at publication.
- [ ] Expired, abandoned, invalid, replayed, and superseded uploads have bounded
      storage lifetime and tested cleanup behavior.
- [ ] A rejected write-once upload cannot strand the node: the detecting lease
      call reports the rejection, durably rotates the internal generation, and
      returns a fresh upload target that can accept corrected bytes.
- [ ] A structurally valid parent with one or more children not ready retains
  its uploaded object and reports every distinct unready child hash in
  canonical first-occurrence order; retrying lease after the children
  become ready publishes the parent without another parent upload.
- [ ] Durable, generation-fenced validation evidence prevents rehashing or
      reparsing a valid parent while it waits for children, without allowing
      staged metadata from a retired upload to be published.
- [ ] An uploaded object remains eligible for validation after its signing URL
      expires, while an expired authorization with no object rotates to a fresh
      internal generation.
- [ ] Publication interruption and ready-record/object inconsistency have
      distinct tested recovery and error behavior; storage inconsistency never
      silently falls back to a new upload.
- [ ] Concurrent callers for the same node converge on one immutable ready node
      and receive valid leases without client-visible coordination.
- [ ] Inline upload and the legacy upload headers and client configuration are
  removed from the App/Space v2 protocol, OpenAPI, client path, service,
  documentation, and tests without changing frozen Stack/Tenant v1.
- [ ] Focused protocol, client, service, Cloudflare, OpenAPI, documentation,
      concurrency, expiry, retry, and cleanup checks pass.
- [ ] The user explicitly accepts the implemented contract for the exact
      reviewed primary commit.

## Constraints

- Keep administrator and Space data-plane credentials separate. A presigned
  object PUT must never carry the App capability.
- Treat every uploaded object as untrusted and non-readable until a lease call
  validates and publishes it.
- Treat the server as the authority for canonical digest, envelope, child
  readiness, immutable publication, lease, and cleanup.
- Preserve the fast CAS-hit path: ready-node lease must not require caller
  metadata, an R2 content read, or canonical parsing.
- Preserve deterministic canonical hashes and ordered child references.
- Keep temporary upload state bounded by expiry, per-Space resource limits, and
  cleanup even when a caller never retries lease.
- Never place access keys, bearer capabilities, presigned URLs, production
  object identities, or customer data in tasks, docs, fixtures, or logs.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task goal, compatibility break, included API and storage work, exclusions, constraints, and acceptance criteria. | Substantive implementation work. |
| Interface | Required | Requesting user | [LeaseUploadDesign.md](./LeaseUploadDesign.md): request and response schemas, state machine, retries, errors, and client behavior. | Changing the public protocol, generated OpenAPI, or public client. |
| Business and data model | Not applicable: canonical node identity, App/Space ownership, Merkle DAG edges, leases, and Root Refs retain their existing meaning. Internal upload sessions remain ephemeral operational state. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user | [LeaseUploadDesign.md](./LeaseUploadDesign.md): trust boundaries, validation point, R2/D1 authority, internal fencing, cleanup, and failure recovery. | Changing the service kernel, object-storage flow, or inline upload path. |
| Delivery acceptance | Required | Requesting user | Published implementation, protocol/OpenAPI diff, migration note, focused validation, and recorded limitations. | Running `task complete` for the exact approved primary commit. |

## References

- [Current three-phase implementation](./CurrentThreePhaseImplementation.md)
- [Proposed lease upload design](./LeaseUploadDesign.md)
- [Space v2 contract](/packages/tenant-protocol/src/space-v2-contract.ts)
- [Node lease service kernel](/packages/service/src/node-lease.ts)
- [Cloudflare node upload adapter](/packages/service-cloudflare/src/tenant-do.ts)
- [R2 upload presigner](/packages/service-cloudflare/src/r2-upload-presigner.ts)
- [Public tenant client](/packages/tenant-client/src/client.ts)
- [Canonical binary format](/docs/cas-binary-format.md)
- [State protection and garbage collection](/docs/cas-state-protection-and-gc.md)
- [App-user HTTP API](/docs/app-user-api/http-api.md)

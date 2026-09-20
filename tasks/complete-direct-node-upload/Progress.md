# Progress

Updated: 2026-09-20

## Current state

The reviewed lease-driven direct upload contract is implemented across the v2
protocol and OpenAPI, public Space client, blob/file clients, cloud-neutral
service kernel, Cloudflare D1/R2 adapter, smoke path, tests, and stable
documentation. The next action is to commit and publish the validated source
branch, integrate it into primary, and request delivery acceptance.

## Decisions

- Use one required JSON `{ leaseDurationMs }` request and a strict `state`
  response union: `ready`, `awaiting_upload`,
  `awaiting_replacement_upload`, or `validated_awaiting_children`.
- Keep upload generation, temporary key, rejection, validation evidence,
  expiry, and cleanup identity internal. No v2 upload ID, length declaration,
  inline canonical body, custom lease header, or upload-mode selector remains.
- Keep immutable validation evidence generation-fenced so waiting parents
  recheck only child readiness and return every distinct unready child hash in
  canonical first-occurrence order.
- Retain superseded temporary keys in a durable cleanup queue until R2 deletion
  succeeds; bound active generations per Space and run bounded cleanup through
  Space GC.
- R2 PutObject does not support a SHA-256 full-object checksum. Presigned PUTs
  bind the method, temporary object key, media type, write-once condition, and
  expiry; UniCAS enforces SHA-256 and the 32 MiB limit on the following lease.
- Preserve the frozen v1 wire and client compatibility path while removing the
  legacy upload modes from App/Space v2.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user approved the revised goal, compatibility break, included surfaces, exclusions, constraints, and acceptance criteria in primary commit `82fe3cb21436f087ae9bf7afe29cfb0eae22eb9d` on 2026-09-20. |
| Interface | Approved | Requesting user reviewed [LeaseUploadDesign.md](./LeaseUploadDesign.md), requested the final JSON request and strict response-state refinements, then stated there were no further questions and implementation could begin for primary commit `82fe3cb21436f087ae9bf7afe29cfb0eae22eb9d` on 2026-09-20. |
| Business and data model | Not applicable | Canonical node identity, App/Space ownership, ordered refs, leases, Root Refs, and business lifecycle retain their existing meaning. |
| Architecture | Approved | Requesting user, 2026-09-20: the same decision approved internal generation fencing, D1/R2 authority, validation evidence, cleanup, failure recovery, and the documented R2 checksum limitation in [LeaseUploadDesign.md](./LeaseUploadDesign.md). |
| Delivery acceptance | Pending | Requires the exact final integrated primary commit and the validation evidence below. |

## Validation

- `pnpm build`: all workspace packages and generated service UI assets built.
- `pnpm typecheck`: all 13 package typecheck targets passed.
- `pnpm test`: repository checks and all package suites passed before the final
  cleanup-tombstone and request-boundary refinements.
- The final affected-package rerun passed 35 protocol tests, 138 service tests,
  256 Cloudflare tests, the tenant-client suite, 8 blob-client tests, and 5
  file-client tests, including concurrency, expiry, replacement, waiting
  children, publication interruption, storage inconsistency, generation
  limits, and cleanup failure recovery.
- Final repository integration checks passed 117 OpenAPI drift,
  documentation-site, workspace-boundary, and deployment-plan tests.
- `pnpm exec repoledger check complete-direct-node-upload --remote`: passed.
- A local all-task check requires integrating the newer primary registration
  for `split-app-space-operation-permissions`; that unrelated backlog task is
  excluded from this implementation commit.

## Blockers

- None for the source commit. Delivery acceptance remains pending for the
  exact integrated primary commit.

## Outcome

App/Space callers can now lease by hash, upload canonical bytes directly only
when requested, and repeat the identical lease request to publish. Ready-node
renewal remains a metadata-free fast path; invalid, stale, concurrent,
expired, blocked, interrupted, and abandoned uploads have deterministic,
tested outcomes without client-visible session identity.

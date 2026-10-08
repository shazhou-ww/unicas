# Progress

Updated: 2026-09-22

## Current state

The reviewed manual tracing implementation is complete and dormant in
production. Both dynamic Workers retain the accepted 5% custom-log policy,
disable invocation logs and native Cloudflare tracing, and explicitly set
`UNICAS_MANUAL_TRACE_SAMPLE_RATE=0`. Static Workers remain excluded.

The new private `@unicas/observability` package validates optional client ULIDs,
derives scope-separated trace IDs with a versioned HMAC key ring, samples
deterministically, and exports only explicit allowlisted spans through the
official OTLP/HTTP exporter. Export is fail-open, limited to 16 spans, one
concurrent request, and a one-second timeout. A maximum-shape serializer test
keeps two-times margin under the 64 KiB batch contract.

Authenticated Space and Spaces requests accept recent client ULIDs; rejected,
Admin, MCP, OAuth, metadata, and other pre-authentication paths use
server-generated correlation. `X-Trace-Id` remains separate from Root Ref
`requestId` and control-plane `Idempotency-Key` replay authority. Signed
60-second internal parent context joins Spaces, UniCAS, Space DO, and Root Ref
domain DO work. Its HMAC is bound out of band to the exact destination route or
actor key, and public boundaries strip the internal header.

The manual waterfall includes normalized request roots, provider/UniCAS/R2
fetch, allowlisted D1/R2 timing operations, Durable Object dispatch, capability
verification, node validation, Root Ref commit/retry, and cleanup spans. Span-
specific attributes reject URLs, query strings, headers, bodies, identifiers,
hashes, keys, SQL, provider errors, and content. Native automatic tracing stays
disabled because its automatic attributes do not satisfy this boundary.

Stable observability, operations, deployment, package, and repository-skill
guidance now documents the manual pipeline, ULID/replay separation, activation
gate, destination requirements, queries, rollback, and native-tracing ban.

## Decisions

- Use built-in Worker metrics for request/error trends, CPU/wall-time
  quantiles, SLOs, and deployment comparison.
- Persist only explicitly emitted custom logs at a 5% head sample. Treat their
  counts as diagnostic samples, not authoritative totals.
- Keep generated invocation logs disabled because they include full request
  URLs, including OAuth callback query values.
- Keep native Cloudflare traces disabled permanently under the current
  automatic-attribute contract.
- Keep manual OTLP export at sample zero until one destination's ownership,
  access, retention, deletion, residency, cost, and incident process are
  approved and a retained synthetic canary proves the field boundary.
- Preserve the existing Space `Server-Timing` names and response-construction
  semantics. Do not describe them as retained or final-byte timing.
- Use only owned manual instrumentation. Do not enable automatic fetch, D1,
  R2, Durable Object, handler, or RPC tracing.
- Keep static Workers excluded and keep the new skill repository-owned rather
  than externally installed or served through the administrator CLI.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | The requesting user explicitly approved the amended [Task.md](./Task.md) manual-tracing outcome on 2026-09-22; the reopened review artifacts were published at source revision `ab35b3fceae702d51405ca808de9e7274178605d`. |
| Interface | Approved | The requesting user explicitly approved [ManualTracingInterfaceReview.md](./ManualTracingInterfaceReview.md) on 2026-09-22, including ULID correlation, replay separation, the manual vocabulary, and zero initial production export. |
| Architecture | Approved | The requesting user explicitly approved [ManualTracingArchitecture.md](./ManualTracingArchitecture.md) on 2026-09-22, including generic OTLP/HTTP, signed context, bounded fail-open export, and destination review before nonzero sampling. |
| Business and data model | Not applicable | The implementation changes no domain entity, ownership, persisted business schema, key, migration, retention, or lifecycle. |
| Delivery acceptance | Pending | Requires an exact integrated primary commit plus a separately approved destination and deployed sampled synthetic canary before nonzero production export can be accepted. |

## Validation

- `pnpm check:workspace`: all 139 workspace-boundary, deployment-policy, and
  Stack/Tenant retirement tests passed.
- `pnpm typecheck`: all 16 workspace package typechecks passed.
- Full affected package suites passed: `@unicas/service` 135 tests,
  `@unicas/observability` 20, `@unicas/spaces` 62, and
  `@unicas/service-cloudflare` 262.
- Portable tests cover ULID bounds, scoped derivation, deterministic sampling,
  key rotation, audience/replay rejection, oversized carriers, local sample
  kill switch, parentage, span/attribute allowlists, 16-span root preservation,
  actual OTLP serialization, secret canaries, asynchronous rejection, and
  timeout failure.
- `pnpm docs:check`: all 7 documentation inventory, link, deterministic build,
  artifact, and provenance tests passed.
- `pnpm --filter @unicas/service-cloudflare build` and direct Wrangler
  `deploy --dry-run` passed; the bundle reported manual sample `0`.
- `pnpm deploy:spaces:plan` built the UI/Worker and passed Wrangler dry-run;
  the generated binding report also showed manual sample `0`.
- `git diff --check` and editor diagnostics reported no errors.

## Blockers

- No OTLP production destination has been selected or reviewed for ownership,
  access, retention, deletion, residency, cost, or incident response.
- Production sampling intentionally remains zero, so no deployed retained
  Space/Admin/MCP/OAuth/Spaces/D1/R2/DO canary exists yet.
- Opening manual export requires that destination review, provisioned secrets,
  an exact nonzero sample decision, both Worker dry-runs, a synthetic deployed
  canary, and direct retained-field secret-absence inspection.
- Native Cloudflare tracing remains unavailable because it still lacks the
  required pre-persistence automatic-attribute suppression.

## Outcome

UniCAS now has a generic, bounded, tested manual OTLP waterfall that preserves
the accepted telemetry boundary and can be activated through a reviewed
destination without enabling unsafe native tracing. Production remains
fail-closed at sample zero until the destination and deployed canary gate are
satisfied, so this task remains `ongoing`.
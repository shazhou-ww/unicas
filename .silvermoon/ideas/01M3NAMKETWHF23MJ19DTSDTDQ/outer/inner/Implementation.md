# Implementation

The retained migration evidence is under
[`legacy-repoledger/`](./legacy-repoledger/), including the implementation
journal and reviewed manual tracing architecture and interface.

## Steps

### I-S01: Establish the telemetry safety contract

Inventory dynamic Workers and telemetry surfaces, define prohibited values and
normalized dimensions, and keep native automatic tracing disabled.

### I-S02: Implement the bounded portable tracing pipeline

Provide validated correlation, scoped trace derivation, deterministic sampling,
allowlisted spans, signed internal parent context, and bounded fail-open
OTLP/HTTP export.

### I-S03: Instrument the service and Spaces boundaries

Cover reviewed request, fetch, D1, R2, Durable Object, capability, validation,
Root Ref, retry, and cleanup phases without weakening package or credential
boundaries.

### I-S04: Document and test the operational contract

Maintain deployment guidance, queries, rollback, sampling gates, serializer
bounds, data-safety tests, and the repository-owned observability skill.

## Acceptance criteria

### I-AC01: Telemetry excludes prohibited data

Only reviewed low-cardinality attributes can be serialized, while URLs, query
strings, headers, bodies, credentials, identifiers, keys, SQL, content, and
provider errors are rejected. Prove it with allowlist and secret-canary tests.

### I-AC02: Manual tracing is bounded and fail-open

Sampling is deterministic, export is asynchronous and limited by span count,
payload size, concurrency, and timeout, and exporter failure cannot fail a
business request. Prove it with portable exporter and maximum-shape tests.

### I-AC03: Cross-boundary traces preserve isolation

Authenticated requests can correlate through signed, audience-bound internal
context while rejected and pre-authentication paths remain server-generated.
Prove scope, replay, destination, parentage, and ingress tests.

### I-AC04: Current builds keep production export dormant

Both dynamic Worker build and deployment plans report manual sample zero while
native tracing remains disabled and static Workers remain excluded. Prove it
with the Worker build and both relevant Wrangler dry runs.

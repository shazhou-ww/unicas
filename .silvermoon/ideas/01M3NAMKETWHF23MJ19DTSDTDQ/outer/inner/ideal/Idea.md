# Complete safe production performance tracing

## Intent

Give UniCAS maintainers a safe, repeatable server-side latency workflow using
Cloudflare aggregate metrics and bounded logs plus explicitly allowlisted
manual spans exported to an operator-controlled OTLP destination.

## Context

The portable tracing pipeline, Worker integrations, data-safety controls,
documentation, and repository observability skill are implemented and remain
dormant in production at a zero manual sampling rate. Native Cloudflare tracing
stays disabled because its automatic retained attributes do not satisfy the
accepted credential and data boundary.

This idea was migrated from the ongoing Repoledger task
`adopt-cloudflare-performance-tracing`. The original task, reviews, inventory,
and implementation journal are retained under the Inner World as migration
evidence. Their prior approvals are historical context only and are not copied
as Silvermoon revision decisions.

## Desired outcome

UniCAS retains a bounded, low-cardinality, fail-open manual trace waterfall for
the service and Spaces Workers, and production export becomes nonzero only
after an OTLP destination is reviewed, secrets are provisioned, the exact
release is dry-run and deployed, and retained synthetic traces prove that no
prohibited values cross the telemetry boundary.

## Scope

### In scope

- Preserve the implemented metrics, log, correlation, manual-span, and
  `Server-Timing` contracts.
- Select and review one operator-controlled OTLP/HTTP destination.
- Provision destination credentials and choose an explicit bounded sample rate.
- Dry-run and deploy both dynamic Workers from one exact validated revision.
- Run representative synthetic Space, Admin, MCP, OAuth, Spaces, D1, R2, and
  Durable Object probes and inspect retained fields directly.
- Document operational queries, activation, rollback, retention, access, cost,
  and incident ownership.

### Out of scope

- Enabling native Cloudflare tracing or automatic fetch, D1, R2, Durable
  Object, handler, or RPC tracing.
- Building a general-purpose observability platform or customer-facing trace
  dashboard.
- Treating sampled traces as billing, usage, availability, or exact SLO data.
- Adding raw identifiers, URLs, credentials, request content, SQL, object keys,
  or provider error bodies to telemetry.
- Broad performance optimization without evidence from the accepted telemetry.

## Constraints

- Preserve administrator, MCP/OAuth, Space, and Spaces credential isolation.
- Keep names and attributes bounded, normalized, explicitly allowlisted, and
  free of raw customer or resource identifiers.
- Keep `@unicas/service` cloud-neutral and platform exporting in the Cloudflare
  adapter or App deployment layer.
- Bound span count, payload size, concurrency, timeout, retention, and cost;
  export remains asynchronous and fail-open for business requests.
- Keep static Workers excluded and manual production sampling at zero until all
  deployment acceptance criteria are proven.

## Open questions

- Which OTLP destination satisfies ownership, access, retention, deletion,
  residency, cost, and incident-response requirements?
- What initial nonzero production sample rate is approved after destination
  review?

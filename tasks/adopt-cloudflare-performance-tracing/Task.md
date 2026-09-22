# Adopt Cloudflare performance tracing

Created: 2026-09-21

## Goal

Give maintainers and agents a safe, standard, and repeatable way to diagnose
server-side latency across the UniCAS service and Spaces Workers by adopting
Cloudflare Workers Observability traces and metrics, adding only the custom
spans needed for UniCAS business phases, and providing a repository-local
skill for future performance investigations and instrumentation changes.

## Context

The Space data plane currently emits per-request `Server-Timing` entries for
edge dispatch, authorization, Durable Object calls, and D1/R2 operations.
Those headers are useful for one caller reproducing one request, but they do
not provide retained traces, request waterfalls, latency distributions, or a
shared workflow for comparing deployments and finding systemic bottlenecks.

Cloudflare Workers Observability now provides built-in Worker metrics and
automatic tracing for handler, fetch, D1, R2, Durable Object, and RPC calls,
plus custom spans for application-specific phases. The `unicas-spaces` Worker
currently enables the top-level observability setting, which enables logs but
does not explicitly enable tracing under the current beta behavior. The main
`unicas` Worker does not currently enable persisted Workers observability.

Automatic telemetry must not weaken UniCAS's credential and data boundaries.
Cloudflare trace attributes can include request URLs, query strings, D1 query
text, R2 object keys, and Durable Object identifiers. UniCAS must continue to
exclude bearer capabilities, session cookies, CSRF tokens, OAuth authorization
codes, private keys, presigned upload URLs, and private content from logs,
traces, examples, and task artifacts. Sampling, retention, event cost, beta
stability, and the inability to treat sampled traces as exact SLO measurements
also require an explicit operational contract.

## Scope

- Inventory the dynamic production Worker entry points and current telemetry
  for the `unicas` service and `unicas-spaces` App, distinguishing built-in
  metrics, invocation logs, automatic traces, custom spans, and the existing
  `Server-Timing` response contract.
- Define and review a telemetry data-safety contract before production tracing
  is enabled. Cover automatic attributes, normalized routes and operation
  names, permitted custom attributes, sensitive values, identifier handling,
  retention, access, and export boundaries.
- Explicitly configure Workers Logs and Workers Tracing for the applicable
  deployment units, with reviewed production and local/staging sampling,
  persistence, and cost controls. Keep static-only site and documentation
  Workers disabled unless the inventory demonstrates a concrete need.
- Use Cloudflare's automatic handler and binding spans for platform operations.
  Add a small set of stable custom spans only for material UniCAS phases that
  automatic instrumentation cannot identify, such as capability verification,
  canonical-node validation, Root Ref commit orchestration, or bounded cleanup.
- Keep Cloudflare tracing imports and runtime details in platform adapters or
  App deployment code. Preserve the cloud-neutral `@unicas/service` boundary
  by passing portable instrumentation hooks only if business-layer spans need
  to cross that boundary.
- Establish repeatable queries and validation for request latency, CPU and wall
  time, errors, slow traces, D1/R2/DO contribution, deployment comparison, and
  the existing operational SLOs. Use normalized operation dimensions rather
  than raw resource paths or customer identifiers.
- Keep `Server-Timing` as the bounded caller-side diagnostic surface and
  document its relationship to retained server-side metrics and traces. Do not
  require a new public request header solely to activate ordinary telemetry.
- Add a repository-local `.agents/skills/unicas-observability/SKILL.md` that
  tells agents when and how to inspect UniCAS performance, choose metrics versus
  traces versus logs, add or review spans, protect sensitive data, validate
  configuration, and use the current Cloudflare and repository sources of
  truth.
- Add focused configuration, instrumentation, data-safety, and documentation
  validation. Update stable observability, operations, deployment, and package
  guidance where the accepted behavior becomes an operational contract.

## Out of scope

- Replacing Cloudflare Workers Observability with a self-hosted tracing or log
  platform, or provisioning a third-party OpenTelemetry destination, unless a
  reviewed native-platform gap makes a separate outcome necessary.
- Building a customer-facing performance dashboard, exposing traces through a
  public API, or granting App administrators access to platform telemetry.
- Adding raw per-request timing `console.log` events for operations already
  represented by automatic or custom spans.
- Treating sampled traces as an exact availability, billing, usage, or SLO data
  source; authoritative aggregate measurements continue to use metrics and
  durable business records appropriate to their purpose.
- Changing App/Space HTTP routes, capability claims, operation permissions,
  storage semantics, persisted business schemas, or the ongoing App-user v1
  contract cutover.
- Broad performance optimization unrelated to bottlenecks demonstrated by the
  accepted telemetry. Follow-up optimizations may use this capability but are
  not implicitly included in this task.
- Instrumenting static-only product or documentation asset delivery without a
  measured need.

## Acceptance criteria

- [ ] A reviewed inventory maps each dynamic production Worker and important
      request class to its metrics, logs, automatic spans, custom spans, and
      caller-visible `Server-Timing` behavior, with static-only exclusions
      documented.
- [ ] A telemetry data-safety review enumerates automatic Cloudflare attributes
      used by UniCAS and proves that persisted or exported telemetry does not
      contain bearer capabilities, cookies, CSRF tokens, OAuth authorization
      codes, private keys, presigned upload URLs, request bodies, node content,
      or other prohibited secrets.
- [ ] The `unicas` and `unicas-spaces` deployment configurations explicitly
      enable the accepted Workers Logs and Workers Tracing settings with
      documented sampling, retention, persistence, environment, and cost
      behavior; no configuration relies on an implicit future default.
- [ ] Representative authenticated Space, Admin, MCP, and Spaces App requests
      produce useful sampled trace waterfalls for their applicable handler,
      fetch, D1, R2, Durable Object, and RPC work without crossing credential
      boundaries; OAuth and error paths satisfy the same data-safety contract.
- [ ] Stable custom spans exist only for reviewed business phases not made
      clear by automatic instrumentation, use bounded low-cardinality names and
      attributes, preserve package boundaries, and are covered by focused tests.
- [ ] Maintainers can execute documented Cloudflare queries to identify slow
      operations, compare latency around a deployment, separate CPU from I/O
      wall time, and locate D1, R2, Durable Object, fetch, or business-phase
      bottlenecks.
- [ ] Existing structured security and incident events remain queryable and
      bounded, while redundant per-request performance logs are not introduced.
- [ ] Existing Space `Server-Timing` behavior remains compatible or any change
      receives explicit interface approval and updated tests and documentation;
      its single-request diagnostic role is distinguished from metrics and
      retained traces.
- [ ] The repository-local `unicas-observability` skill is discoverable, names
      its triggering scenarios, follows the accepted telemetry and security
      contract, points to maintained sources of truth, and gives agents a
      validated investigation and instrumentation workflow.
- [ ] Focused tests, workspace checks, task checks, and production deployment
      dry runs pass, and a synthetic deployed probe confirms useful trace data
      and the absence of prohibited values before production rollout is
      accepted.
- [ ] The user explicitly accepts the implemented observability behavior,
      telemetry data boundary, operational workflow, and agent skill for the
      exact reviewed primary commit.

## Constraints

- Preserve administrator, MCP/OAuth, and Space credential isolation. Never add
  credentials or secret-bearing URLs as span names, attributes, log fields,
  exception messages, fixtures, screenshots, or query examples.
- Treat Cloudflare's documented automatic attributes as data disclosure until
  verified otherwise. If native tracing cannot satisfy the accepted data-safety
  contract, do not enable unsafe production persistence; implement and review a
  bounded mitigation rather than assuming provider-side redaction.
- Keep metric, span, and event names stable, bounded, and based on normalized
  operation identity. Do not use raw paths, App IDs, Space IDs, Principal IDs,
  hashes, object keys, SQL bindings, email addresses, or OAuth values as metric
  dimensions or custom span attributes without explicit data-boundary approval.
- Preserve `@unicas/service` as cloud-neutral. Cloudflare SDK imports and
  Wrangler configuration belong in `@unicas/service-cloudflare`, the Spaces
  App adapter, or deployment configuration.
- Prefer automatic platform spans over duplicate wrappers. Custom spans must
  represent a useful business boundary and must not materially change request
  latency when a request is not sampled.
- Account for streaming responses and Workers clock behavior honestly; a span
  or `Server-Timing` value must not be documented as end-to-end transfer time
  when it ends at response construction or before the stream is consumed.
- Keep production tracing sampled and cost-bounded. Record the Cloudflare beta
  and pricing assumptions current at implementation time, but isolate provider
  details so later attribute-name changes do not leak into public protocols.
- Coordinate normalized route and operation names with
  [the App-user v1 cutover](../cut-over-app-space-api-to-v1/Task.md) without
  absorbing, delaying, or reintroducing its prototype v2 contract.
- Keep the new skill repository-specific and source-controlled. Do not add it
  to `skills-lock.json` as an externally installed shared skill unless its
  ownership intentionally moves to a reviewed external source.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's native Cloudflare tracing outcome, included Workers and skill, exclusions, constraints, acceptance criteria, and coordination with the App-user v1 cutover. | Substantive implementation. |
| Interface | Required | User or delegated operations owner | Task-local observability contract covering the operator/agent telemetry interface, stable metric/span/event names, query workflow, `Server-Timing` compatibility, sampling semantics, and the `unicas-observability` skill behavior; no public App API change is planned. | Changing telemetry names or configuration, adding custom spans, changing `Server-Timing`, or publishing the skill. |
| Business and data model | Not applicable: the task does not change domain entities, ownership, business lifecycle, persisted business schemas, or migrations. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | User or delegated architecture and security owner | Task-local design covering native Cloudflare telemetry flow, automatic and custom instrumentation boundaries, sensitive-data review, package ownership, sampling, retention, cost, validation, and rollback. | Enabling production persistence/export or adding cross-layer instrumentation hooks. |
| Delivery acceptance | Required | Requesting user | Published implementation and skill, focused automated evidence, deployment dry runs, representative deployed trace screenshots or query results using synthetic data, and explicit secret-absence verification. | Running `task complete` for the exact approved primary commit. |

## References

- [Current observability contract](/packages/docs-site/content/observability.md)
- [CAS operations and SLOs](/packages/docs-site/content/cas-operations.md)
- [Cloudflare service deployment configuration](/packages/service-cloudflare/wrangler.toml)
- [Cloudflare timing collector](/packages/service-cloudflare/src/timing.ts)
- [Spaces deployment configuration](/stacks/unicas/spaces/wrangler.jsonc)
- [Cloudflare Worker adapter](/packages/service-cloudflare/src/worker.ts)
- [Repository-local skill pattern](/.agents/skills/unicas-cli/SKILL.md)
- [Server package boundaries](/.github/instructions/packages.instructions.md)
- [Cloudflare Workers Observability](https://developers.cloudflare.com/workers/observability/)
- [Cloudflare Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)
- [Cloudflare custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/)
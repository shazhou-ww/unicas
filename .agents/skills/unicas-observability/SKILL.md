---
name: unicas-observability
description: "Use when investigating UniCAS latency, errors, CPU or wall time, Cloudflare Workers metrics/logs/traces, Server-Timing, custom spans, deployment regressions, or observability data safety; also use before changing Worker telemetry, sampling, persistence, exports, event fields, or instrumentation."
---

# UniCAS observability

Use the least sensitive surface that answers the question. Production tracing
through Cloudflare automatic spans is deliberately disabled because UniCAS
cannot redact their attributes before persistence. The explicit manual OTLP
pipeline is available for synthetic validation but has a zero production
sample and no destination.

## Route the question

| Question | Start with |
| --- | --- |
| Availability, error trend, deployment regression | Built-in Worker metrics and probes |
| CPU versus I/O wait | CPU and wall-time quantiles around the deployment marker |
| One Space request | `Server-Timing`, then bounded logs and durable audit |
| Authorization or incident reason | Sampled structured event by exact `event`/`kind`/`reason` |
| Exact administrator or Root Ref action | Authenticated durable audit |
| D1/R2/DO/fetch waterfall | Reviewed manual spans; production export remains dormant |

Read [the observability contract](../../../packages/docs-site/content/observability.md)
before querying or changing telemetry. Use
[CAS operations](../../../packages/docs-site/content/cas-operations.md) for SLOs,
alerts, deployment, and incident response.

## Investigate performance

1. Identify `unicas` or `unicas-spaces`, the deployment/version, time window,
   route class, expected SLO, and whether the signal is production or synthetic.
2. In Workers metrics, compare request outcomes and p50/p95/p99 CPU and wall
   time before and after the deployment marker. Wall growth without CPU growth
   points to I/O or coordination, not necessarily compute.
3. For Space requests, reproduce once with synthetic credentials and inspect
   `cas_auth`, `cas_do`, `cas_d1_*`, `cas_r2_*`, and `cas_edge` in
   `Server-Timing`. Do not call it final-byte transfer time.
4. In Query Builder, filter by an exact structured `event`; group only by the
   bounded fields documented in the contract. Counts are a 5% sample.
5. Use authenticated audit for exact actors and business actions. Never paste
   IDs or telemetry payloads into task artifacts when a bounded summary works.
6. State what the evidence proves, its sample/retention window, and what remains
   unknown. With production manual sampling at zero, production storage
   waterfalls remain unavailable.

## Use manual traces

Use only synthetic identifiers, capabilities, OAuth values, upload URLs, and
content. Point OTLP only at an approved local mock receiver or reviewed
isolated destination. Never point a synthetic traced run at production
bindings or real customer data.

Expected span names are:

```text
unicas.request
spaces.request
unicas.capability.verify
unicas.node.validate
unicas.root_refs.commit
unicas.cleanup.run
unicas.fetch
unicas.d1
unicas.r2
unicas.do.dispatch
```

Only allowlisted operation, peer, actor-kind, outcome, status-class, and
numeric count attributes are permitted. The correlation ULID is the sole
approved high-cardinality field. Cloudflare automatic tracing must stay off;
its attributes include full URLs, storage keys/metadata, Durable Object
identity, KV keys/metadata, and D1 SQL text.

`X-Trace-Id` accepts a recent ULID on authenticated Space requests. Invalid,
stale, future, or missing values are replaced without rejecting the request.
Admin, MCP, OAuth, metadata, and other pre-auth routes ignore caller values.
Never treat this header as replay protection. Root Ref `requestId` and
control-plane `Idempotency-Key` remain separately payload-bound.

Internal parent context is HMAC-authenticated, expires after 60 seconds, and
is bound to the exact destination method/path or actor key without serializing
that audience. Strip it at every public boundary. It establishes parentage
only; never use it to authorize or deduplicate work.

## Add or review telemetry

1. Decide why built-in metrics, current events, audit, or `Server-Timing` are
   insufficient.
2. Put Cloudflare runtime code only in `@unicas/service-cloudflare` or the
   Spaces App. Use a small portable hook if a cloud-neutral business phase must
   cross into `@unicas/service`.
3. Instrument an owned call site with an approved manual span. Never proxy a
   raw binding and never enable automatic instrumentation. Unknown span or
   attribute names require interface and architecture review first.
4. Never serialize a caught error, URL, header, body, provider payload, path,
   App/Space/Principal ID, hash, object key, SQL value, or content. Use typed
   static events and bounded codes.
5. Treat a sampling change, invocation logs, an OTLP destination, retention,
   HMAC key handling, native trace persistence, or a nonzero production rate
   as interface and architecture changes. Reopen review before editing them.
6. Recheck Cloudflare's current Workers Logs, tracing, spans/attributes,
   pricing, retention, and known-limitations pages. Provider beta names and
   behavior can change.

## Validate changes

Run the narrow checks first:

```powershell
pnpm exec vitest run tests/deploy-plan.test.mjs
pnpm --filter @unicas/observability test
pnpm --filter @unicas/service-cloudflare exec vitest run tests/observability.test.ts tests/oauth-discovery.test.ts tests/timing.test.ts tests/worker.test.ts --testTimeout=15000
pnpm --filter @unicas/spaces exec vitest run --root . tests/worker.test.ts
pnpm --filter @unicas/observability --filter @unicas/service --filter @unicas/service-cloudflare --filter @unicas/spaces typecheck
pnpm docs:check
pnpm deploy:plan
pnpm deploy:spaces:plan
```

Run the full Durable Object suite when changing node-validation or Root Ref
span placement. A deployed negative canary check is valid only after a known
bounded event from the same synthetic invocation is visible; a sampled-out
request proves nothing.

## Production tracing gate

Keep native Cloudflare tracing disabled. Do not set the manual sample above
zero until one OTLP destination has reviewed ownership, access, retention,
deletion, residency, cost, and incident handling. Run unique synthetic
canaries through Space, Admin, MCP, OAuth, Spaces, fetch, D1, R2, and Durable
Object paths; inspect both serialized and retained fields; dry-run both Worker
bundles; and obtain explicit approval for the exact destination and rate.
Rollback by restoring `UNICAS_MANUAL_TRACE_SAMPLE_RATE=0` and redeploying.

Sources of truth:

- [Observability contract](../../../packages/docs-site/content/observability.md)
- [Deployment configuration](../../../packages/service-cloudflare/wrangler.toml)
- [Spaces configuration](../../../stacks/unicas/spaces/wrangler.jsonc)
- [Service instrumentation](../../../packages/service-cloudflare/src/observability.ts)
- [Spaces instrumentation](../../../packages/spaces/src/observability.ts)
- [Portable manual tracing](../../../packages/observability/src/manual-tracing.ts)
- [Package boundaries](../../../.github/instructions/packages.instructions.md)
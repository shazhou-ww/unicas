---
name: unicas-observability
description: "Use when investigating UniCAS latency, errors, CPU or wall time, Cloudflare Workers metrics/logs/traces, Server-Timing, custom spans, deployment regressions, or observability data safety; also use before changing Worker telemetry, sampling, persistence, exports, event fields, or instrumentation."
---

# UniCAS observability

Use the least sensitive surface that answers the question. Production tracing
is deliberately disabled because Cloudflare automatic spans expose values that
UniCAS cannot redact before persistence.

## Route the question

| Question | Start with |
| --- | --- |
| Availability, error trend, deployment regression | Built-in Worker metrics and probes |
| CPU versus I/O wait | CPU and wall-time quantiles around the deployment marker |
| One Space request | `Server-Timing`, then bounded logs and durable audit |
| Authorization or incident reason | Sampled structured event by exact `event`/`kind`/`reason` |
| Exact administrator or Root Ref action | Authenticated durable audit |
| D1/R2/DO/fetch waterfall | Synthetic local tracing only; production is blocked |

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
   unknown. Production storage waterfalls remain unknown while tracing is off.

## Use local traces

Use only synthetic identifiers, capabilities, OAuth values, upload URLs, and
content. Keep local tracing on local bindings and inspect it in Local Explorer.
Never enable remote persistence or point the traced run at production.

Expected business spans are:

```text
unicas.capability.verify
unicas.node.validate
unicas.root_refs.commit
unicas.cleanup.run
```

Cloudflare already creates handler, fetch, D1, R2, Durable Object, and RPC
spans. Do not duplicate them. Remember that automatic span attributes include
full URLs, storage keys/metadata, Durable Object identity/SQL bindings, KV
keys/metadata, and D1 SQL text.

## Add or review telemetry

1. Decide why built-in metrics, current events, audit, or `Server-Timing` are
   insufficient.
2. Put Cloudflare runtime code only in `@unicas/service-cloudflare` or the
   Spaces App. Use a small portable hook if a cloud-neutral business phase must
   cross into `@unicas/service`.
3. Prefer automatic platform spans. A custom span must be one approved bounded
   business phase and use only the documented enum/numeric attributes.
4. Never serialize a caught error, URL, header, body, provider payload, path,
   App/Space/Principal ID, hash, object key, SQL value, or content. Use typed
   static events and bounded codes.
5. Treat a sampling change, invocation logs, a destination, trace persistence,
   or a nonzero production trace rate as interface and architecture changes.
   Reopen review before editing them.
6. Recheck Cloudflare's current Workers Logs, tracing, spans/attributes,
   pricing, retention, and known-limitations pages. Provider beta names and
   behavior can change.

## Validate changes

Run the narrow checks first:

```powershell
pnpm exec vitest run tests/deploy-plan.test.mjs
pnpm --filter @unicas/service-cloudflare exec vitest run tests/observability.test.ts tests/worker.test.ts --testTimeout=15000
pnpm --filter @unicas/spaces exec vitest run --root . tests/worker.test.ts
pnpm --filter @unicas/service --filter @unicas/service-cloudflare --filter @unicas/spaces typecheck
pnpm docs:check
pnpm deploy:plan
pnpm deploy:spaces:plan
```

Run the full Durable Object suite when changing node-validation or Root Ref
span placement. A deployed negative canary check is valid only after a known
bounded event from the same synthetic invocation is visible; a sampled-out
request proves nothing.

## Production tracing gate

Do not enable production tracing until Cloudflare supplies and the deployed
account verifies pre-persistence filtering or suppression for every prohibited
automatic attribute. Then reopen both reviews, test every retained/exported
field with unique synthetic canaries, document access/retention/cost and
rollback, and obtain explicit approval for the nonzero sample.

Sources of truth:

- [Observability contract](../../../packages/docs-site/content/observability.md)
- [Deployment configuration](../../../packages/service-cloudflare/wrangler.toml)
- [Spaces configuration](../../../stacks/unicas/spaces/wrangler.jsonc)
- [Service instrumentation](../../../packages/service-cloudflare/src/observability.ts)
- [Spaces instrumentation](../../../packages/spaces/src/observability.ts)
- [Package boundaries](../../../.github/instructions/packages.instructions.md)
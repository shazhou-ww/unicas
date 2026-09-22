# Cloudflare performance telemetry inventory

Captured: 2026-09-22

This inventory separates Cloudflare's built-in metrics, persisted Workers
Logs, automatic tracing, UniCAS custom telemetry, and caller-visible timing.
It describes the checked-in production topology before this task changes its
observability contract.

## Deployment inventory

| Deployment | Dynamic work | Platform bindings | Current persisted observability | Caller timing |
| --- | --- | --- | --- | --- |
| `unicas` | Space v1, Admin, MCP/OAuth, admin BFF/OIDC, private audit RPC, and scheduled usage reconciliation | Control and Space D1, R2, OAuth KV, Email, `CasDurableObject`, and `RootRefDomainDurableObject` | No `observability` configuration. Built-in Worker metrics remain available; live tail output is not a retained telemetry contract. | Space responses expose bounded `Server-Timing`; Admin, MCP, OAuth, and scheduled work do not. |
| `unicas-spaces` | File API, Google OIDC, App-owned OAuth issuer, direct upload orchestration, static-asset fallback, and scheduled cleanup | Spaces D1 plus outbound fetches to UniCAS, Google, and presigned R2 URLs | Top-level `observability.enabled = true`; this implicitly persists logs at the default 100% sample but does not explicitly enable beta tracing. Invocation logs are not disabled. | No `Server-Timing` contract. UniCAS response timing remains visible only on the internal client response. |
| `unicas-site` | None; product assets only | Static assets | Disabled by omission. | None. |
| `unicas-docs` | None; documentation assets only | Static assets | Disabled by omission. | None. |

The two static Workers remain excluded. Their request path does not execute
application code, perform authenticated operations, or own a demonstrated
performance investigation need.

## Request-class map

| Request class | Built-in metrics | Current logs or audit | Automatic spans if enabled | Reviewed custom-span candidate | `Server-Timing` |
| --- | --- | --- | --- | --- | --- |
| Space metadata/content read | request, error, CPU, and wall time | bounded authorization event; unexpected failures | handler, capability JWKS fetch on cache miss, Durable Object, D1, and R2 | none until automatic attributes can be made safe | `cas_schema`, `cas_auth`, `cas_do`, `cas_edge`, and applicable `cas_d1_*`/`cas_r2_*` |
| Space lease/direct upload | request, error, CPU, and wall time | bounded authorization event; unexpected failures | handler, Durable Object, D1, R2 head/get/put/delete, and signing-related fetch work | canonical-node validation and bounded cleanup are useful business phases | same bounded Space timing family; it ends at response construction, not upload completion |
| Root Ref list/update | request, error, CPU, and wall time | authorization event plus durable Root Ref audit | handler, Durable Object/RPC, D1, and R2 | Root Ref commit orchestration is a useful business phase | `cas_auth`, `cas_do`, `cas_edge`, and applicable storage entries |
| Admin API and browser BFF | request, error, CPU, and wall time | durable control audit; bounded OIDC/email failure events; some generic exception output | handler, D1, KV, Email, and provider fetch | none initially | none |
| MCP and MCP OAuth | request, error, CPU, and wall time | durable control audit and generic failures | handler, D1, KV, provider fetch, and RPC | none initially | none |
| Spaces file API | request, error, CPU, and wall time | bounded request-failure event | handler, Spaces D1, UniCAS fetch, and presigned R2 fetch | none initially | none |
| Spaces and Admin OAuth callbacks | request, error, CPU, and wall time | bounded callback reason plus generic failures | handler and provider fetch | prohibited while automatic root URLs are retained | none |
| Scheduled reconciliation/cleanup | invocation, error, CPU, and wall time | bounded count-only events | scheduled handler, D1, R2, Durable Object, and fetch | bounded cleanup is a useful business phase | none |

Cloudflare automatic instrumentation already represents handler, fetch, D1,
R2, Durable Object, and RPC work. Custom spans must not duplicate those calls.

## Existing UniCAS telemetry

`Server-Timing` is a bounded, per-response Space diagnostic. It aggregates
repeated names and preserves streaming responses. It is not retained, sampled,
or an end-to-end transfer duration. Its current stable names are:

```text
cas_edge
cas_schema
cas_auth
cas_do
cas_d1_*
cas_r2_get
cas_r2_put
cas_r2_head
cas_r2_prefix
```

Current retained business evidence is the authenticated control and Root Ref
audit record, not Workers telemetry. Current structured runtime events include
authorization decisions, bounded OIDC and email failure reasons, usage
reconciliation counts, and Spaces cleanup/reconciliation failures. Several
unexpected-error paths still pass raw `Error` objects to `console.error`; one
R2 failure message also embeds App ID, Space ID, and node hash. Those paths
must be bounded before persisted custom logs can be accepted.

## Cloudflare automatic attribute inventory

The Cloudflare documentation current on the capture date states that automatic
tracing records the following values relevant to UniCAS:

| Automatic operation | Provider attributes relevant to the data boundary | UniCAS values that can appear |
| --- | --- | --- |
| Fetch handler | `url.full`, `url.path`, method, selected content headers, user agent, body sizes, geography | OAuth `code` and `state`, CLI authorization values, App/Space IDs, node hashes, Root Ref domains, file paths, cursors, and account identifiers |
| Outbound fetch | `url.full`, `url.path`, `url.query`, selected headers, and body sizes | presigned R2 signatures and object keys, provider authorization URLs, discovery/JWKS URLs, and customer-controlled issuer paths |
| D1 | `db.query.text`, operation, row counts, bookmarks, and timing | maintained SQL text; prepared bindings are not listed for D1 spans |
| Durable Object SQL | `db.query.text` and `cloudflare.durable_object.query.bindings` | App/Space IDs, hashes, Root Ref domains, request IDs, and other persisted values |
| R2 | object keys, prefixes/cursors, checksums, ETags, HTTP/custom metadata, and error messages | App/Space IDs, node hashes, temporary upload IDs, content metadata, and storage error details |
| KV | keys, prefixes, cursors, metadata, sizes, and cache state | OAuth transaction and authorization-record keys or metadata |
| Durable Object/RPC | Durable Object instance ID, entrypoint, and RPC method/property | stable physical actor identity and bounded method names |

Cloudflare documents no Wrangler field or Workers Tracing API that filters,
redacts, suppresses, or transforms these automatic attributes before native
dashboard persistence or OpenTelemetry export. Sampling only reduces the
probability of capture; it is not a confidentiality control. Setting
`persist = false` prevents native storage only when telemetry is exported to a
configured destination, where the same unredacted attributes remain present.

## Immediate safety findings

1. Persisted invocation logs are unsafe for callback routes because their
   generated message includes the request URL. They must be disabled before
   Workers Logs is an accepted retained surface.
2. Persisted automatic traces are unsafe for both dynamic Workers. OAuth
   callbacks can disclose authorization codes, outbound direct uploads can
   disclose presigned query credentials, and binding spans disclose private
   identifiers or storage keys.
3. A nonzero sample rate cannot prove secret absence. Native production
   tracing must remain explicitly disabled until Cloudflare supplies a
   verified pre-persistence attribute policy or UniCAS introduces a separately
   reviewed isolation boundary that prevents sensitive values from entering
   automatic spans.
4. Built-in aggregate metrics remain appropriate for availability, request
   rates, errors, CPU time, wall time, and SLO measurement because they do not
   require retaining per-request attributes.
5. `Server-Timing` remains the accepted single-request Space diagnostic. It
   must not grow raw identifiers or be described as retained tracing.

## Sources of truth

- Cloudflare Workers tracing, custom spans, spans and attributes, known
  limitations, Workers Logs, and Wrangler configuration documentation,
  captured 2026-09-22.
- `packages/service-cloudflare/wrangler.toml` and
  `stacks/unicas/spaces/wrangler.jsonc`.
- `packages/service-cloudflare/src/worker.ts`, `space-do.ts`, `timing.ts`, and
  `node-lease.ts`.
- `packages/spaces/src/worker.ts` and its Google OIDC/file-service adapters.
- `packages/docs-site/content/observability.md` and `cas-operations.md`.
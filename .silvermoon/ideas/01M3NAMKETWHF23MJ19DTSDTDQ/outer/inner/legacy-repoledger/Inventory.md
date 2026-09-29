# Cloudflare performance telemetry inventory

Captured: 2026-09-22; refreshed after manual tracing implementation

This inventory separates Cloudflare's built-in metrics, persisted Workers
Logs, automatic tracing, UniCAS custom telemetry, and caller-visible timing.
It describes the checked-in topology and the production gates after the
reviewed manual tracing implementation.

## Deployment inventory

| Deployment | Dynamic work | Platform bindings | Current persisted observability | Caller timing |
| --- | --- | --- | --- | --- |
| `unicas` | Space v1, Admin, MCP/OAuth, admin BFF/OIDC, private audit RPC, and scheduled usage reconciliation | Control and Space D1, R2, OAuth KV, Email, `CasDurableObject`, and `RootRefDomainDurableObject` | 5% sampled custom logs; invocation logs off; native traces off; manual OTLP sample `0` with no destination | Space responses expose bounded `Server-Timing`; Admin, MCP, OAuth, and scheduled work do not. |
| `unicas-spaces` | File API, Google OIDC, App-owned OAuth issuer, direct upload orchestration, static-asset fallback, and scheduled cleanup | Spaces D1 plus outbound fetches to UniCAS, Google, and presigned R2 URLs | Same explicit log/native-trace policy; manual OTLP sample `0` with no destination | No `Server-Timing` contract. UniCAS response timing remains visible only on the internal client response. |
| `unicas-site` | None; product assets only | Static assets | Disabled by omission. | None. |
| `unicas-docs` | None; documentation assets only | Static assets | Disabled by omission. | None. |

The two static Workers remain excluded. Their request path does not execute
application code, perform authenticated operations, or own a demonstrated
performance investigation need.

## Request-class map

| Request class | Built-in metrics | Logs or audit | Manual spans when sampled | `Server-Timing` |
| --- | --- | --- | --- | --- |
| Space metadata/content read | request, error, CPU, and wall time | bounded authorization event; unexpected failures | request, capability, optional JWKS fetch, DO dispatch, allowlisted D1/R2 storage operations | `cas_schema`, `cas_auth`, `cas_do`, `cas_edge`, and applicable `cas_d1_*`/`cas_r2_*` |
| Space lease/direct upload | request, error, CPU, and wall time | bounded authorization event; unexpected failures | request, capability, DO dispatch, node validation, allowlisted D1/R2 operations | same bounded Space timing family; it ends at response construction, not upload completion |
| Root Ref list/update | request, error, CPU, and wall time | authorization event plus durable Root Ref audit | request, capability, Space/domain DO dispatch, Root Ref commit and retry count | `cas_auth`, `cas_do`, `cas_edge`, and applicable storage entries |
| Admin API and browser BFF | request, error, CPU, and wall time | durable control audit; bounded OIDC/email failure events | request and reviewed issuer metadata/JWKS/token fetches when present | none |
| MCP and MCP OAuth | request, error, CPU, and wall time | durable control audit and generic failures | request and reviewed issuer metadata/JWKS/token fetches when present | none |
| Spaces file API | request, error, CPU, and wall time | bounded request-failure event | request plus UniCAS API and presigned R2 upload fetches | none |
| Spaces and Admin OAuth callbacks | request, error, CPU, and wall time | bounded callback reason plus generic failures | server-correlated request plus provider metadata/JWKS/token fetches; caller trace input ignored | none |
| Scheduled reconciliation/cleanup | invocation, error, CPU, and wall time | bounded count-only events | request, cleanup, and applicable fetch/storage work | none |

Native Cloudflare automatic instrumentation remains disabled. Manual wrappers
exist only at owned call sites and never proxy a raw binding.

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

Retained business evidence is the authenticated control and Root Ref audit
record, not Workers telemetry. Structured runtime events include
authorization decisions, bounded OIDC and email failure reasons, usage
reconciliation counts, and Spaces cleanup/reconciliation failures. Unexpected
error paths emit static locations and deliberately ignore caught error values.

## Cloudflare automatic attribute inventory

The Cloudflare documentation current on the capture date states that automatic
tracing records the following values relevant to UniCAS:

| Automatic operation | Provider attributes relevant to the data boundary | UniCAS values that can appear |
| --- | --- | --- |
| Fetch handler | `url.full`, `url.path`, method, selected content headers, user agent, body sizes, geography | OAuth `code` and `state`, CLI authorization values, App/Space IDs, node hashes, Root Ref domains, file paths, cursors, and account identifiers |
| Outbound fetch | `url.full`, `url.path`, `url.query`, selected headers, and body sizes | presigned R2 signatures and object keys, provider authorization URLs, discovery/JWKS URLs, and customer-controlled issuer paths |
| D1 | `db.query.text`, operation, row counts, bookmarks, and timing | maintained SQL text; prepared bindings are not listed for D1 spans |
| Durable Object SQL | `db.query.text` and `cloudflare.durable_object.query.bindings` | Not exercised by current DOs, which use D1/R2; unsafe if DO SQLite is introduced |
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
   tracing remains explicitly disabled. The reviewed replacement is explicit
   allowlisted manual OTLP instrumentation with no automatic provider spans.
4. Built-in aggregate metrics remain appropriate for availability, request
   rates, errors, CPU time, wall time, and SLO measurement because they do not
   require retaining per-request attributes.
5. `Server-Timing` remains the accepted single-request Space diagnostic. It
   must not grow raw identifiers or be described as retained tracing.
6. Manual production export remains disabled at sample `0` until one OTLP
   destination, access/retention/cost policy, and retained synthetic canary
   receive explicit approval.

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
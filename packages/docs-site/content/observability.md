# Observability

UniCAS uses six distinct diagnostic surfaces. Choose the narrowest surface
that answers the question:

| Surface | Use it for | Do not use it for |
| --- | --- | --- |
| Cloudflare Workers metrics | Request volume, invocation outcome, CPU time, wall time, memory, and deployment comparison | Exact business counts or one request's storage breakdown |
| Persisted Workers Logs | Sampled, bounded security and incident events | Exact SLOs, generated invocation URLs, raw exceptions, or request content |
| Manual OTLP traces | Reviewed synthetic request, fetch, D1, R2, Durable Object, and business-phase waterfalls | Exact SLOs, billing, or availability |
| Cloudflare automatic traces | None; they remain disabled because automatic attributes are unsafe | Any UniCAS environment containing credentials or private identifiers |
| `Server-Timing` | One authenticated Space request through response construction | Retained analysis or complete streamed transfer time |
| Durable audit | Authoritative administrator and Root Ref business/security history | Runtime latency analysis |

The dynamic `unicas` and `unicas-spaces` Workers explicitly enable sampled
custom logs. The assets-only `unicas-site` and `unicas-docs` Workers remain
excluded. Built-in Workers metrics remain available independently of Workers
Logs.

Never persist or export bearer capabilities, cookies, CSRF tokens, OAuth codes
or state, private keys, client secrets, presigned upload URLs, request bodies,
node/file content, raw exceptions, storage keys, or SQL bindings.

## Production policy

Both dynamic Workers use this effective policy. The service expresses it as
TOML and Spaces as JSON, but values are identical:

```json
{
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "head_sampling_rate": 0.05,
      "invocation_logs": false,
      "persist": true,
      "destinations": []
    },
    "traces": {
      "enabled": false,
      "head_sampling_rate": 0,
      "persist": false,
      "destinations": []
    }
  }
}
```

Both Workers also set `UNICAS_MANUAL_TRACE_SAMPLE_RATE=0`. Native Cloudflare
tracing and the manual exporter are separate controls: native tracing remains
disabled even if manual export is later enabled.

The 5% head sample applies to all custom logs in a selected invocation. It
bounds volume and cost; it does not prove that an event did not occur. There is
no Logpush, Tail Worker, or production OpenTelemetry destination.

As of 2026-09-22, Cloudflare retains Workers Logs for up to three days on Free
and seven days on Paid plans. Paid plans include 20 million events per month,
then charge per additional event. Workers Tracing is in beta and begins sharing
event billing on 2026-10-01. Recheck current Cloudflare retention and pricing
before changing either sample rate.

## Workers metrics

Use **Workers & Pages > Worker > Metrics** for `unicas` or `unicas-spaces`.
Metrics remain the source for request success/error trends and CPU/wall-time
quantiles because retained logs are sampled and invocation logs are disabled.
Metrics can be inspected for up to three months.

For a deployment comparison:

1. Select a time range spanning the deployment marker.
2. Compare request success/error, p50/p95/p99 CPU, and wall time before and
   after the marker.
3. A CPU increase suggests compute work. A wall-time increase without a CPU
   increase suggests binding, network, actor-queue, or other I/O wait.
4. Reproduce one synthetic Space request and inspect `Server-Timing` before
   deciding whether authorization, Durable Object dispatch, D1, or R2 is the
   controlling layer.

Wall time includes `waitUntil()` work and is not final-byte response time.
Sampled traces are never an exact SLO measurement.

## Retained logs

Generated invocation logs are disabled because Cloudflare includes the full
request URL. UniCAS persists only explicitly emitted structured events. Current
event families include:

- `cas_app_authorization`: bounded App/Space v1 authorization decisions and
  operation.
- `cas_usage_reconciliation`: bounded maintenance counts with no App, Space,
  hash, or usage amount.
- `admin_oidc_callback_failed`, `admin_oidc_login_failed`, and
  `admin_email_challenge_delivery_failed`: bounded reasons or booleans without
  provider messages, addresses, codes, or payloads.
- `spaces_request_failed`, `spaces_root_release_reconciliation_failed`, and
  `spaces_smoke_cleanup_failed`: bounded code/status/stage values without
  caller correlation IDs, Principal IDs, run IDs, paths, or errors.
- `unicas_authorization_failed`, `unicas_service_actor_failed`,
  `unicas_admin_request_failed`, `unicas_app_usage_read_failed`,
  `unicas_space_operation_failed`, and
  `unicas_r2_canonical_upload_failed`: static incident locations. Caught error
  values are deliberately ignored.

Live tail remains useful during a bounded deployment investigation:

```powershell
pnpm --filter @unicas/service-cloudflare exec wrangler tail
```

Do not copy raw tail output into tracked files. If a local transcript is
needed, write it only to a gitignored path and inspect it for sensitive values
before sharing.

### Query Builder recipes

Cloudflare Query Builder searches retained Workers Logs, not the separate
three-month metrics dataset. Open **Observability > Overview**, select the
Worker and time range, and use these saved-query definitions:

| Saved query | Visualization | Filters | Group by |
| --- | --- | --- | --- |
| `UniCAS fail-closed authorization` | Count | `event Equals cas_app_authorization`; `kind Equals fail_closed` | `operation`, `reason` |
| `UniCAS rejected authorization sample` | Count | `event Equals cas_app_authorization`; `kind Equals rejected` | `operation`, `reason` |
| `UniCAS unexpected failures` | Count | `event Starts with unicas_` | `event`, `plane` |
| `UniCAS admin login failures` | Count | `event Equals admin_oidc_callback_failed` | `reason` |
| `Spaces request failures` | Count | `event Equals spaces_request_failed` | `code`, `status` |

Multiple filters use AND. Treat every count as a 5% diagnostic sample. Use
built-in metrics, probes, and durable records for authoritative totals.

## Manual tracing and correlation

Cloudflare automatic tracing captures handler and outbound `url.full`, R2
keys and metadata, KV keys/metadata, Durable Object identifiers and SQL
bindings, and D1 SQL text. Cloudflare currently provides no Wrangler or tracing
API control that removes these fields before native persistence or export.
Sampling is not a confidentiality control, so production tracing is explicitly
disabled in Cloudflare's native observability configuration.

UniCAS instead owns an explicit manual OpenTelemetry pipeline. It creates no
automatic fetch, D1, R2, Durable Object, or handler instrumentation. Only these
span names and attributes can pass the repository allowlist:

| Span | Boundary | Attributes when known |
| --- | --- | --- |
| `unicas.request`, `spaces.request` | Normalized request through response construction | correlation ULID, operation, outcome, status class |
| `unicas.capability.verify` | Capability verification and authority/JWKS work | operation, outcome |
| `unicas.node.validate` | Canonical uploaded-byte validation | byte count, reference count, outcome |
| `unicas.root_refs.commit` | Root Ref retry and atomic commit orchestration | mutation count, retry count, outcome |
| `unicas.cleanup.run` | Bounded scheduled cleanup/reconciliation | examined, deleted, failed, outcome |
| `unicas.fetch` | Reviewed provider, UniCAS API, or presigned-upload fetch | peer enum, status class, outcome |
| `unicas.d1` | Allowlisted repository timing operation | operation, rows read/written, outcome |
| `unicas.r2` | Allowlisted object operation | operation, outcome |
| `unicas.do.dispatch` | Space or Root Ref domain actor dispatch | actor kind, outcome |

`unicas.outcome` is one of `ok`, `rejected`, or `failed`. Fetch peers are
`issuer_metadata`, `jwks`, `oauth_token`, `unicas_api`, or `r2_upload`.
Durable Object kinds are `space` or `root_ref_domain`. Unknown span names,
attribute names, unsafe strings, and unbounded values are dropped.

No span contains a URL, query string, OAuth value, header, body, App, Space,
Principal, Account, issuer, capability `jti`, hash, Root Ref domain, object
key, path, filename, SQL, binding, error message, stack trace, or content.
Export buffers at most 16 spans per invocation. The vocabulary and value sizes
are fixed; a maximum-shape regression test sends that structure through the
official serializer and requires at most 32 KiB, preserving two-times margin
under the 64 KiB contract. This is a checked structural bound, not a runtime
inspection of private SDK encoding. Export uses a one-second timeout and
one concurrent OTLP request, and fails open after the business response.

### Correlation ULID

Authenticated Space and Spaces App requests may send `X-Trace-Id` as a
26-character Crockford Base32 ULID. Input is case-insensitive and returned in
uppercase. It must encode a time no more than ten minutes old or one minute in
the future. Missing, malformed, stale, or overflow input is replaced with a
server-generated ULID and never rejects the request. Administrator, MCP,
OAuth, metadata, and other pre-authentication routes always ignore caller
correlation and generate their own value.

The ULID is correlation input, not authorization, freshness proof, or replay
protection. Root Ref `requestId` and control-plane `Idempotency-Key` retain
their authenticated scope, canonical-payload binding, conflict, and retention
semantics. A client may copy one ULID into one of those fields separately; the
service does not infer idempotency from `X-Trace-Id`.

The exported 16-byte trace ID is HMAC-derived from key version, scope kind,
scope ID, and ULID. Workers propagate only a 60-second HMAC-authenticated
internal parent context. Its signature is also bound out of band to the exact
destination method/path or Durable Object actor key; those target values do
not appear in the carrier or span. Oversized, cross-target, caller-supplied,
or otherwise invalid context is rejected, and retained previous HMAC key
versions support bounded rotation. The carrier establishes trace parentage
only and is not a request authorization or replay proof.

### OTLP configuration and queries

At sample rate zero, no HMAC key, endpoint, or authorization secret is
required and no exporter is constructed. A reviewed nonzero environment uses:

```text
UNICAS_MANUAL_TRACE_SAMPLE_RATE=<0..1>
UNICAS_OTLP_TRACES_ENDPOINT=https://collector.example/v1/traces
UNICAS_OTLP_AUTHORIZATION=<Worker secret>
UNICAS_TRACE_HMAC_KEYS={"active":"2026-09","keys":{"2026-09":"<base64url>"}}
```

The endpoint must be credential-free HTTPS, end in `/v1/traces`, and contain
no userinfo, query, or fragment. Authorization and HMAC keys are Worker
secrets. Retain one or two previous HMAC versions only for an intentional
rotation overlap; at most three versions are accepted.

In the reviewed destination, query `service.name` (`unicas` or
`unicas-spaces`) and root span name first. Filter or group only by
`unicas.operation`, `unicas.outcome`, `unicas.http.status_class`,
`unicas.peer`, or `unicas.actor.kind`. Compare span duration around a release
marker, then inspect child `unicas.fetch`, `unicas.d1`, `unicas.r2`, and
`unicas.do.dispatch` duration before business phases. Never use sampled trace
counts as availability or SLO totals.

Production manual export remains dormant until the destination's ownership,
access, retention, deletion, residency, cost, and incident process are
reviewed. Before setting a nonzero rate, run a synthetic canary through Space,
Admin, MCP, OAuth, Spaces, D1, R2, and Durable Object paths; inspect serialized
and retained fields for every prohibited value; dry-run both Worker bundles;
and obtain explicit approval for the exact destination and rate. Rollback is
`UNICAS_MANUAL_TRACE_SAMPLE_RATE=0` plus redeployment. Native Cloudflare
automatic tracing stays disabled regardless of that decision.

## Server-Timing

Space routes return a `Server-Timing` header and `Timing-Allow-Origin: *`.
Repeated operations are aggregated and include a call count. Entries can
include:

| Metric | Work measured |
| --- | --- |
| `cas_edge` | Edge service time through response construction |
| `cas_schema` | Lazy D1 schema initialization |
| `cas_auth` | Space capability verification |
| `cas_do` | Durable Object dispatch |
| `cas_d1_*` | D1 lease, node, Root Ref, and commit operations |
| `cas_r2_get`, `cas_r2_put`, `cas_r2_head`, `cas_r2_prefix` | R2 operations |

```text
Server-Timing: cas_schema;dur=2.1, cas_auth;dur=4.5, cas_do;dur=11.8, cas_edge;dur=20.3
Timing-Allow-Origin: *
```

These values end at response construction or an operation boundary. They do
not measure complete stream consumption. `GET /health` intentionally avoids
storage initialization and timing entries.

## Durable audit

Control mutations append audit records containing the App, stable Account,
exact authenticated External Identity, action, target, request identity, trace
identity, caller channel, and timestamp. Read
those records through authenticated control-plane surfaces:

```powershell
unicas app-audit control <appId> --limit 50
unicas app-ref-domains list <appId>
unicas app-audit root-domain-refs <appId> <refDomain> [--space-id S] --limit 50
unicas app-audit root-domain-events <appId> <refDomain> [--space-id S] --limit 50
```

Use returned cursors unchanged. The private `/_internal/audit/*` adapter RPCs
are not operator APIs.

## Validation

Run the focused policy and instrumentation checks before deployment:

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

After a protected deployment, verify metrics for both dynamic Workers, confirm
a known synthetic bounded event is retained before running negative canary
searches, confirm no native trace events were persisted, and confirm the
zero-rate manual exporter sent no request. A sampled-out event does not prove
secret absence. A future nonzero rollout must use a sampled synthetic trace
whose retained fields can be inspected directly.

Detailed SLOs, alerts, backup procedures, and incident runbooks live in
[CAS middleware operations](cas-operations.md).

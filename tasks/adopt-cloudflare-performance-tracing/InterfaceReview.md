# UniCAS observability interface and data-safety review

Status: Pending review.

## Decision requested

Approve a bounded observability contract that makes Workers Logs explicit and
safe, preserves built-in aggregate metrics and `Server-Timing`, adds only
low-cardinality custom business spans, and keeps automatic tracing disabled in
production until Cloudflare provides a verified pre-persistence redaction or
suppression control.

This decision does **not** claim that the task's production-trace acceptance
criteria are complete. It authorizes the safe implementation described here
and records the provider capability that blocks retained production trace
waterfalls.

## Operator surfaces

Use each surface for one purpose:

| Surface | Accepted use | Not an accepted use |
| --- | --- | --- |
| Workers built-in metrics | Request rate, status/outcome, CPU time, wall time, and SLO/deployment comparison | Per-request storage attribution or exact business accounting |
| Persisted Workers Logs | Sampled, bounded security and incident events emitted explicitly by UniCAS | Generated invocation logs, raw exceptions, request URLs, credentials, or exact SLO counts |
| Automatic Workers Tracing | Synthetic local investigation only while the production safety gate is closed | Production persistence/export, SLOs, billing, availability, or secret-bearing traffic |
| Custom spans | Named business phases during an explicitly synthetic traced run | Raw IDs, paths, URLs, hashes, keys, SQL, credentials, content, or duplicate binding spans |
| `Server-Timing` | One caller's Space request breakdown through response construction | Retained analysis, complete stream-transfer time, or cross-request distributions |
| Durable audit | Authoritative authenticated business and security history | Runtime latency analysis |

The Cloudflare dashboard and query builder are restricted to account operators.
No App administrator or public API receives Workers telemetry. No OpenTelemetry
destination, Logpush job, Tail Worker, or customer-facing dashboard is added by
this task.

## Production configuration contract

Both dynamic Workers use the same explicit production policy:

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

The 5% log sample bounds authorization-event volume and post-2026-10-01 event
cost. It also means sampled logs are diagnostic evidence, never an exact count.
Built-in metrics remain the aggregate source for request/error rates. Cloudflare
currently retains Workers observability events for at most three days on Free
and seven days on Paid plans; UniCAS does not extend that retention or export
events elsewhere.

The product-site and documentation Workers remain explicitly excluded by
having no observability block. Local Miniflare output and Local Explorer data
are ephemeral and must use synthetic credentials and identifiers when tracing
is temporarily enabled in an untracked config override.

## Persisted event contract

Existing stable event names remain:

```text
cas_app_authorization
cas_stack_authorization
cas_usage_reconciliation
admin_oidc_callback_failed
admin_oidc_login_failed
admin_email_challenge_delivery_failed
spaces_request_failed
spaces_root_release_reconciliation_failed
spaces_smoke_cleanup_failed
```

The legacy authorization event remains only while the separate Stack/Tenant
retirement task owns that interface. This task does not rename or remove it.

Authorization events may retain App ID, Space ID, issuer, key ID, token ID,
operation, decision, and bounded reason for short-lived security correlation.
Those values are not metric dimensions or span attributes, and the durable
audit remains authoritative. They must never contain the bearer token, token
claims as a whole, request URL, headers, or body.

Unexpected failures become structured events with a static event name and a
bounded location/kind. They do not serialize an `Error`, stack, provider
payload, storage key, URL, App/Space ID, node hash, file path, or content. The
implementation may add these event names:

```text
unicas_authorization_failed
unicas_service_actor_failed
unicas_admin_request_failed
unicas_app_usage_read_failed
unicas_space_operation_failed
unicas_r2_canonical_upload_failed
```

## Custom span contract

Only these business phases are approved for custom instrumentation:

| Span | Boundary | Permitted attributes |
| --- | --- | --- |
| `unicas.capability.verify` | App/Space capability verification, including authority/JWKS work | `unicas.operation` from the fixed protocol operation enum; `unicas.outcome` from `ok`, `rejected`, `failed` |
| `unicas.node.validate` | Canonical-node validation before publication | `unicas.outcome`; bounded numeric byte/ref counts only |
| `unicas.root_refs.commit` | Root Ref validation and atomic commit orchestration | `unicas.outcome`; bounded numeric mutation/retry counts only |
| `unicas.cleanup.run` | Scheduled bounded cleanup/reconciliation pass | `unicas.outcome`; bounded numeric examined/deleted/failed counts only |

Automatic handler, fetch, D1, R2, Durable Object, and RPC spans are never
wrapped solely to rename them. Attribute values cannot contain App IDs, Space
IDs, Principal/account IDs, issuer URLs, token/key/request IDs, hashes, Root
Ref domains, object keys, paths, filenames, SQL, error messages, or content.
The names are an internal operations contract and do not enter public protocol
packages.

Production tracing remains disabled, so these spans produce data only under a
deliberate synthetic local override until the safety gate opens.

## Query workflow

1. Filter built-in metrics by `$metadata.service` equal to `unicas` or
   `unicas-spaces`; compare request count, error outcome, CPU time, and wall
   time by deployed version before and after a deployment.
2. Treat a wall-time increase without a CPU increase as I/O or coordination
   latency. Use one synthetic reproduction and `Server-Timing` to distinguish
   authorization, Durable Object, D1, and R2 contribution for Space requests.
3. Filter sampled logs by exact `event` and bounded `kind`, `reason`, `code`,
   `status`, or `operation`. Do not aggregate identifiers as service health.
4. Use durable audit for the exact App/Space business action and actor.
5. Do not enable production tracing to fill an evidence gap while automatic
   attributes remain unsafe.

There is no accepted retained query for D1/R2/Durable Object contribution
across production requests while tracing is disabled. That original acceptance
criterion remains blocked rather than being approximated with sampled logs.

## Data-safety invariants

Persisted or exported telemetry must not contain:

- bearer capabilities, session cookies, CSRF tokens, OAuth authorization
  codes, state/verifier values, client secrets, private keys, or smoke
  credentials;
- presigned upload URLs or their query parameters;
- request/response bodies, node/file content, raw headers, or raw exceptions;
- raw customer paths, filenames, D1 bindings, R2 object keys/metadata, Durable
  Object SQL bindings, or KV transaction records; or
- credentials hidden inside URLs, error messages, stack traces, fixtures,
  screenshots, or query examples.

Sampling is not a safety control. Secret-absence validation uses unique
synthetic canaries and searches every retained field after the maximum ingest
delay. A sampled-out request proves nothing; validation must first prove that
its bounded safe event was retained, then prove that none of its prohibited
canaries were retained.

## Gate to production tracing

Production tracing can be reconsidered only when all of the following are
true:

1. Cloudflare documents and the deployed account demonstrates a control that
   removes or suppresses unsafe automatic attributes before every persistence
   and export destination.
2. Tests and a synthetic deployed probe cover handler URLs, outbound fetch
   URLs, D1 text/bindings, R2 keys/metadata, Durable Object IDs and SQL
   bindings, KV keys/metadata, errors, and custom attributes.
3. Interface and architecture review are reopened for the exact provider
   behavior, sampling, retention, cost, access, and rollback plan.
4. A nonzero production rate is explicitly approved and config tests fail if
   tracing becomes enabled through a future default.

## Acceptance impact

The safe implementation can satisfy inventory, explicit configuration,
structured-log safety, `Server-Timing` compatibility, documentation, skill,
test, and dry-run requirements. It cannot satisfy representative retained
production trace waterfalls, retained D1/R2/Durable Object attribution,
production custom-span evidence, or a deployed trace screenshot/query while
the gate is closed. The task therefore remains ongoing and provider-blocked
after the bounded implementation unless its outcome contract is explicitly
changed through a separately reviewed decision.

## Review question

Approve the surface selection, 5% retained custom-log policy, invocation-log
disablement, event and span contracts, identifier handling, retention/access/
export boundary, synthetic-only span use, explicit production tracing gate,
and the stated acceptance gap?
# Manual tracing interface review

Status: Pending review.

## Decision requested

Approve a destination-neutral manual tracing interface with these properties:

- Cloudflare automatic tracing remains disabled.
- UniCAS exports only allowlisted spans and attributes through OTLP/HTTP.
- A caller may supply one canonical ULID as correlation input; the service may
  replace invalid or stale input without rejecting the business request.
- Correlation identity is not generic replay authority. Existing Root Ref
  `requestId` and control-plane `Idempotency-Key` fields remain the only
  payload-bound mutation replay mechanisms in this outcome.

Approval does not select an OTLP vendor or authorize production export. The
destination, retention, access policy, and credentials must be reviewed before
the exporter sample rate can move above zero.

## Trace identity

The optional request header is `X-Trace-Id`. Its accepted external value is a
canonical ULID:

```text
26 Crockford Base32 characters
case-insensitive input, uppercase canonical output
128 bits after decoding; overflow encodings rejected
embedded timestamp between server-now - 10 minutes and server-now + 1 minute
```

The header is optional. When absent, malformed, overflowing, or outside the
accepted clock window, the service generates a new ULID and continues the
business request. Telemetry input must never turn a valid business request into
an error. The accepted value is returned in `X-Trace-Id` so a caller can report
it during an investigation.

The ULID timestamp is an input-freshness hint only. Span start/end timestamps
come from the server clock. The caller cannot set span timestamps, span IDs,
sampling decisions, operation names, outcomes, or attributes.

## Internal trace identity and conflicts

The external ULID is not used directly as a globally trusted OTLP identity.
After authentication establishes an App or Account scope, UniCAS derives the
internal 128-bit OTLP trace ID from a versioned HMAC of:

```text
trace-key-version || authenticated-scope-kind || authenticated-scope-id || ULID
```

The HMAC key is a rotated Worker secret shared only by participating UniCAS
deployment units. This prevents one App from deliberately colliding with
another App's internal trace by choosing the same ULID. Pre-authentication
OAuth routes use server-generated trace identity and do not accept client
correlation input.

Within one authenticated scope, repeated use of one ULID denotes one logical
trace and may produce multiple root attempts. That is a telemetry relationship,
not a business conflict. No per-request D1 or Durable Object trace registry is
introduced because it would add latency to the path being measured and make
observability availability part of request correctness.

The exporter may retain the canonical ULID as the sole approved correlation
identifier attribute. It must not export the authenticated scope value used in
the HMAC derivation.

## Correlation versus replay

An observable ULID is not a secret, signature, or proof that the caller owns a
request. An attacker able to construct a new request can also construct a new
ULID. Therefore time-window and collision handling protect telemetry integrity;
they do not provide cryptographic replay protection.

Existing mutation semantics remain authoritative:

| Operation | Replay field | Server binding and outcome |
| --- | --- | --- |
| Root Ref update | body `requestId` | Atomically unique within authenticated `(App, Space, refDomain)` and bound to the canonical changes hash; same payload replays the revision, different payload returns conflict; no expiry. |
| App or member-invitation creation | `Idempotency-Key` | Scoped to authenticated administrator, method, and canonical route; bound to canonical payload; response retained for the existing bounded period. |
| Platform invitation creation | `Idempotency-Key` | Scoped to authenticated platform administrator and canonical payload; retained through the invitation lifecycle. |

A client helper may generate one ULID and place the same text in `X-Trace-Id`
and the operation's existing replay field. The fields remain semantically
independent: the trace path correlates, while the mutation repository performs
the atomic payload-bound check. A retry must reuse both values; a new logical
mutation must generate a new ULID.

Reads and mutations without an existing idempotency field gain no replay
protection from `X-Trace-Id`. Generic anti-replay would require an integrity-
protected request proof covering method, canonical target, body digest,
credential scope, issue time, and nonce plus an atomic consumed-nonce store.
That is a separate protocol and data-model decision.

## Manual span contract

The trace contains one normalized request root and allowlisted child phases.
No span name contains a route, identifier, or error message.

| Span | Permitted attributes |
| --- | --- |
| `unicas.request` / `spaces.request` | normalized operation, bounded outcome, HTTP status class, server duration |
| `unicas.capability.verify` | operation enum, `ok` / `rejected` / `failed` |
| `unicas.node.validate` | outcome, byte count, reference count |
| `unicas.root_refs.commit` | outcome, mutation count, retry count |
| `unicas.cleanup.run` | outcome, examined/deleted/failed counts |
| `unicas.fetch` | peer enum (`issuer_metadata`, `jwks`, `oauth_token`, `unicas_api`, `r2_upload`), outcome, status class |
| `unicas.d1` | repository-operation enum, outcome, rows read/written when already returned safely |
| `unicas.r2` | operation enum, outcome, byte count when known |
| `unicas.do.dispatch` | actor-kind enum (`space`, `root_ref_domain`), outcome |

The only approved high-cardinality field is the canonical correlation ULID.
Prohibited values include full or partial URLs, query strings, OAuth values,
headers, bodies, App/Space/Account/Principal IDs, capability `jti`, hashes,
Root Ref domains, filenames, paths, storage keys, SQL, bindings, ETags, provider
messages, stack traces, and content metadata.

## Sampling and failure behavior

Sampling is deterministic from the derived trace ID so every participating
Worker makes the same decision. The initial production rate remains zero until
a destination review and synthetic canary validation succeed. A later nonzero
rate is a reviewed configuration change.

Export is asynchronous, bounded, and fail-open. Export timeout, rejection,
rate limiting, or destination outage never changes the HTTP response, retries
a mutation, or blocks Durable Object progress. Export failures emit at most one
bounded sampled operational event with no destination response body.

## Review questions

Approve:

1. optional client ULID correlation with server fallback and scoped HMAC
   derivation;
2. explicit separation from existing replay/idempotency fields;
3. the allowlisted manual span and attribute vocabulary; and
4. zero production export until a destination and synthetic canary evidence
   receive separate approval?
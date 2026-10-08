# Deployment

## Steps

### D-S01: Approve and provision an OTLP destination

Review destination ownership, access, retention, deletion, residency, cost,
incident response, and failure behavior; then provision credentials through
approved secret stores.

### D-S02: Approve a bounded nonzero sample

Choose an exact initial rate, update both dynamic Worker configurations, and
run their builds and deployment dry runs from the exact candidate.

### D-S03: Deploy and run synthetic canaries

Promote the exact validated revision and exercise representative service,
Spaces, storage, Durable Object, MCP, OAuth, success, and error paths using only
synthetic non-sensitive data.

### D-S04: Inspect retention and prove rollback

Inspect retained span names and attributes directly for useful parentage and
secret absence, confirm operational queries and cost behavior, and verify the
documented zero-sample rollback.

## Acceptance criteria

### D-AC01: Destination governance is explicit

The selected destination has approved owners, access, retention, deletion,
residency, cost, incident response, and secret management. Prove each item with
the reviewed operational record and provisioned configuration.

### D-AC02: Representative waterfalls are useful

Sampled synthetic requests produce the applicable normalized request, fetch,
storage, Durable Object, and business-phase hierarchy. Prove it with retained
query results tied to the exact deployment.

### D-AC03: Retained telemetry contains no prohibited values

Direct inspection finds no bearer capability, cookie, CSRF token, OAuth code,
private key, presigned URL, body, content, raw identifier, object key, SQL, or
other prohibited value. Prove it across representative success and error
canaries.

### D-AC04: Production operation remains bounded and reversible

Observed sampling, volume, timeout, failure behavior, and cost match the
reviewed limits, and setting the sample rate back to zero disables export
without affecting requests. Prove it with deployment evidence and a rollback
exercise or approved dry-run equivalent.

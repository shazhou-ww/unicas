# Architecture review

Status: Pending requesting-user approval.

## Decision requested

Approve an Admin-authenticated App usage read backed by node-level physical
storage observations, one mutable summary row per usage-bearing Space, and an
App-scoped aggregate over those summary rows, with bounded repair for legacy
or interrupted R2/D1 transitions.

Approval permits changes to protocol, service ports and kernels, Cloudflare
persistence and BFF integration, and the Console only after the interface and
business/data-model reviews are also approved.

## Component boundary

```text
Console UsageView
  -> @unicas/admin-client getAppUsage
  -> @unicas/admin-protocol GET /admin/apps/{appId}/usage
  -> Cloudflare Admin BFF session + membership authorization
  -> @unicas/service readAppUsage kernel
  -> AppUsageRepository port
  -> Cloudflare D1 aggregate over cas_space_usage
```

The BFF authenticates the administrator and calls
`AccountService.requireAppMembership()` before usage storage is touched. The
cloud-neutral kernel owns aggregate semantics and incomplete-projection
failure. The Cloudflare adapter owns SQL, R2 observation, migration, bounded
repair, and platform timing. The browser never calls a Space route and no
layer creates a Space capability.

The new source uses canonical `{ appId, spaceId }` names. If the ongoing
App/Space concept refactor lands first, implementation adopts its renamed
ports and modules. Frozen v1 translation remains only in its explicit
compatibility boundary; no App usage v1 alias is added.

## Accounting strategy

Add two nullable projection columns to each `cas_nodes` row:

```text
canonical_stored_bytes  integer >= 0, nullable
canonical_observed_at   epoch milliseconds, nullable
```

States are explicit:

| Observation | Meaning |
| --- | --- |
| `observed_at = null` | Legacy or interrupted row has not completed reconciliation; App report is unavailable. |
| `observed_at != null`, `stored_bytes = null` | R2 canonical object was checked and is missing; count as not-ready. |
| Both non-null | Canonical object was checked; include its physical size. |

Add `cas_space_usage`, keyed by `(app_id, space_id)`, with the six public
counters plus internal `unobserved_node_count`. Every normal Space mutation
updates at most one summary row in the same D1 batch as its node or reservation
source change. The existing Space actor is the sole workflow writer for that
row, so no cross-Space coordination is introduced.

App usage is one indexed D1 statement scoped by exact `app_id` over
`cas_space_usage`. It sums Space summary rows and rejects a nonzero sum of
`unobserved_node_count`. The primary key begins with `app_id`, so no cross-App
scan or Space enumeration is needed.

```text
Direct node aggregate: read cost O(N_app nodes), write overhead O(1)
Per-Space rollup:      read cost O(S_app spaces), write overhead O(1)
Per-App hot row:       read cost O(1),           cross-Space write contention
```

The accepted proposal is the middle option. It makes read latency independent
of node count and performs one database round trip with zero node-table,
reservation-table, R2, or internal HTTP reads. For normal Apps,
`S_app << N_app`; query-plan tests must prove the App read uses the
`cas_space_usage` primary-key range.

A separate per-App counter row is rejected: independent Space Durable Objects
would contend on one hot record, and failures between counter updates and
node/reservation commits would require App-wide repair coordination. The
per-Space row retains the same asymptotic benefit for node-heavy Apps while
remaining reconstructible from one Space partition.

## Mutation consistency

- **New canonical node:** R2 write or existing-object verification completes
  first. The node row, verified stored size, observation time, edges, lease,
  reservation removal, and Space summary delta commit in the existing D1
  batch.
- **Existing node lease:** lease fields change; the physical observation is
  unchanged. The same batch adjusts `leasedNodeCount` only when the nonzero
  lease-marker state changes. If an existing legacy row is discovered
  unobserved after R2 verification, that operation also repairs its observation
  and summary.
- **Upload reservation:** existing create, replacement, and deletion batches
  remain authoritative and apply the stored-byte delta to the same Space
  summary row.
- **Garbage collection:** after canonical R2 deletion succeeds, record the node
  as observed missing with its summary delta, then let the existing final D1
  batch remove the node and subtract all node counters. A crash between R2
  deletion and the missing observation can temporarily retain the prior size;
  bounded repair re-observes and converges it. A crash after the missing
  observation is conservatively not-ready until final row deletion or repair
  completes.
- **Out-of-band drift:** R2 is service-owned, but a bounded reconciler can
  re-run `HEAD` and atomically replace the observation and Space summary delta.
  It never changes node identity, references, lease state, or reservation
  state.

D1 and R2 cannot form one transaction. The contract therefore guarantees a
complete aggregate of durable D1 accounting facts plus the latest completed
service observation of canonical objects, not a globally atomic R2 snapshot.
That consistency statement is documented rather than hidden behind “exact”
language.

## Backfill and repair

Schema migration adds the observation columns and `cas_space_usage`. A D1
grouped backfill creates each Space summary from existing node and reservation
rows and records legacy nodes in `unobserved_node_count`. A bounded internal
reconciler scans unobserved nodes by `(app_id, space_id, hash)` keyset, performs
at most the configured number of R2 `HEAD` operations, and atomically records
each observation and summary delta. It runs through the existing scheduled-
maintenance entry point and can be invoked directly in adapter tests. The
endpoint detects incomplete Space summaries and returns `503`, allowing retry
after maintenance advances.

Repair is idempotent. A failed R2 read leaves the row unobserved and is retried;
a definite missing result is recorded as observed with null bytes. A bounded
Space repair recomputes all seven counters from that Space's source rows and
replaces its one summary row, correcting missed deltas without touching
another Space. Empty Apps need no backfill. Metrics record rows scanned,
observations completed, summaries repaired, missing objects, failures, and
duration without logging hashes or customer usage.

## Request and failure flow

1. Route parsing validates `appId` through the Admin protocol.
2. The BFF requires an authenticated, usable Account.
3. `requireAppMembership(accountId, appId)` runs before CAS_DB access. Unknown
   Apps and nonmembership remain indistinguishable.
4. The App usage kernel sums only `cas_space_usage` rows and rejects any
  unobserved node count as service unavailable.
5. A complete report returns `200` with `Cache-Control: no-store`; suspended
   Apps remain inspectable through this control-plane read.
6. Storage, migration, or projection failures return the stable Admin
   `SERVICE_UNAVAILABLE` response. No partial aggregate is serialized.

The BFF logs only operation, status, duration, and correlation identifiers.
It does not log response metrics, App data, node hashes, capabilities, or
storage keys.

## Package ownership

| Package | Responsibility |
| --- | --- |
| `@unicas/admin-protocol` | `AppUsage` schema/type, route, contract, OpenAPI. |
| `@unicas/admin-client` | Thin `getAppUsage` HTTP operation. |
| `@unicas/service` | `AppUsageRepository` port, aggregate result validation, incomplete-state error. |
| `@unicas/service-cloudflare` | D1/R2 observation adapter, schema migration, reconciler, BFF wiring, generated UI bundle. |
| `@unicas/admin-webui` | Fetch lifecycle, formatting, accessible states, manual refresh. |

No protocol/client package depends on a service implementation, and the Admin
protocol does not expose R2, D1, projection, or Space credential details.

## Validation and rollout

1. Protocol route/schema/OpenAPI and client transport tests.
2. Kernel tests for zero, multi-Space summary sums, incomplete observations,
  missing content, reservations, and current lease semantics.
3. Adapter tests for migration, transactional counter deltas, duplicate hashes
  across Spaces, new-node writes, GC interruption, bounded reconciliation,
  full Space repair, retry, cross-App SQL isolation, and an App query plan
  that never scans node or reservation tables.
4. BFF tests for session, membership, blocked Account, suspended App, unknown
   App, unavailable projection, and no Space credential path.
5. Console tests for load, data, zero, refresh, stale-on-refresh-error, retry,
   formatting, and App-switch race safety.
6. Existing Space usage, upload, lease, GC, authorization, and App-admin
   regression suites, followed by generated artifact and workspace checks.

Deploy the additive schema, summary writers, and grouped backfill before
relying on the endpoint. During physical-observation reconciliation, affected
Apps receive a retryable `503`; they never receive a mixed old/new physical
total. Rollback leaves the ignored additive table and columns and restores the
placeholder UI and absent route without data loss.

## Rejected alternatives

- **Browser or BFF fan-out over Spaces:** requires Space discovery and
  credentials, crosses the access-plane boundary, and scales by Space and
  node count.
- **App-wide R2 listing on every read:** cannot provide a bounded latency
  contract and needs reconciliation with D1 to exclude orphan objects.
- **Direct App aggregate over node and reservation rows:** one indexed database
  round trip is better than R2 fan-out, but latency and rows read still grow
  with every node in the App.
- **D1-only use of `content_size` for physical bytes:** silently invents
  compression/encoding equality and cannot identify missing canonical data.
- **One mutable App counter:** creates cross-Space contention and opaque drift
  that is harder to repair than node observations.
- **Return partial totals during backfill:** presents unknown physical usage as
  trustworthy and violates the task's failure contract.

## Review question

Approve this Admin-to-service boundary, node observations, per-Space summary
table, App aggregate over summary rows, bounded reconciliation, and fail-closed
rollout?
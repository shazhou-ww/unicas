# Interface review

Status: Approved by the requesting user on 2026-09-21.

## Decision requested

Approve one read-only Admin operation and the corresponding App Overview
presentation:

- `GET /admin/apps/{appId}/usage` returns the six existing Space usage metrics
  summed across every usage-bearing Space owned by the App.
- App membership authorizes the read; no Space capability is accepted, minted,
  or exposed.
- The Console presents a compact aggregate with explicit loading, zero,
  refreshing, and recoverable error states.

The visual proposal is illustrated in [UiReview.html](./UiReview.html). This
document and [Task.md](./Task.md) are the normative interface contract.

## HTTP contract

```http
GET /admin/apps/{appId}/usage
Accept: application/json
Cookie: <administrator session>
```

Successful response:

```json
{
  "nodeCount": 18420,
  "readyContentBytes": 1932735283,
  "readyStoredBytes": 1395864371,
  "reservedBytes": 67108864,
  "notReadyNodeCount": 3,
  "leasedNodeCount": 1206
}
```

The response is `Cache-Control: no-store`. It has no pagination, Space IDs,
per-Space breakdown, capability material, quota, billing, or historical
series. `@unicas/admin-protocol` owns `AppUsage` and its schema;
`@unicas/admin-client` exposes one thin `getAppUsage({ appId })` transport
operation.

## Metric semantics

Each value is the arithmetic sum of the corresponding current Space usage
value. Identical hashes in different Spaces count once per Space-owned row.
The existing wire names and meanings remain unchanged.

| Field | App-level meaning |
| --- | --- |
| `nodeCount` | Count of App-owned `cas_nodes` rows across all Spaces. |
| `readyContentBytes` | Sum of node `content_size` metadata across those rows. This preserves current Space behavior even when canonical content is later found missing. |
| `readyStoredBytes` | Sum of the last service-verified canonical R2 object sizes. Unobserved migration rows make the whole report unavailable; verified missing objects contribute zero. |
| `reservedBytes` | Sum of `cas_upload_reservations.stored_bytes`, including rows awaiting the existing cleanup lifecycle. |
| `notReadyNodeCount` | Count of node rows whose latest completed canonical-object observation found no object. |
| `leasedNodeCount` | Count of rows with a nonzero `lease_expires_at`, preserving the current Space usage contract, including expired lease markers until GC removes the node. |

The field names are compatibility terms, not a quota contract. This task does
not reinterpret expiry, readiness, or reservation semantics independently of
the Space endpoint.

## Authorization and failures

| Condition | Result |
| --- | --- |
| Authenticated, usable Account with App membership; active App | `200` aggregate usage. |
| Authenticated, usable Account with App membership; suspended App | `200` aggregate usage. Administrative inspection remains available while Space operations stay blocked. |
| App has no usage-bearing state | `200` with all six values equal to zero. |
| No administrator session | `401 ADMIN_AUTH_REQUIRED`. |
| Blocked Account | `401 ADMIN_AUTH_REQUIRED`; existing credential revalidation clears the blocked Account's session before route dispatch. |
| Unknown App or no membership | `403 APP_MEMBERSHIP_REQUIRED`, preserving current App-read concealment behavior. |
| Any node has never completed projection backfill, or accounting storage is unavailable | `503 SERVICE_UNAVAILABLE`; never substitute a partial or D1-only physical total. |

Membership is checked before the accounting repository is called. The route
does not accept CSRF headers because it is an idempotent read, and an App
administrator gains no node content, Root Ref, GC, or Space enumeration
authority from it.

## Console behavior

The existing Usage card remains in App Overview. Its body becomes a responsive
metric grid with two columns at narrow widths and three columns at wider
widths. Metrics are ordered by operational importance:

1. Logical content
2. Stored content
3. Upload reservations
4. Nodes
5. Missing content
6. Leased nodes

Bytes use IEC units (`B`, `KiB`, `MiB`, `GiB`, `TiB`) with at most one decimal
place and expose the exact byte count in accessible text. Counts use locale
grouping. Values occupy stable-width rows so refresh does not shift the card.

| State | Presentation |
| --- | --- |
| Initial load | Card title remains visible; six fixed metric positions use quiet skeletons and a `Loading usage` status. |
| Current data | Metrics render with a completion-time label and an icon-only `Refresh usage` control. |
| Refresh | Existing values remain visible; the refresh control is disabled and a polite `Refreshing usage` status appears. |
| Zero | The same six metrics render as zero, followed by `No storage activity yet.` |
| Initial error | A compact destructive alert names the failure and provides `Retry`. |
| Refresh error | Last successful values remain visible with a non-blocking alert and retry action; stale data is never presented as newly refreshed. |

The view does not add charts, cards within the Usage card, per-Space rows, or
quota language. If the Admin query-cache task lands first, Usage uses its
session-scoped query conventions; otherwise it follows the current abort/race-
safe local request pattern without introducing a second cache abstraction.

## Compatibility

- The public Space route and `CasUsage` response remain unchanged.
- The new Admin response intentionally mirrors the six Space field names but
  is a distinct `AppUsage` type owned by the Admin protocol.
- Existing clients are unaffected because the route and method are additive.
- Generated Admin OpenAPI and package outputs are regenerated from source.
- Existing Stack/Tenant v1 routes receive no App aggregate alias.

## Review question

Approve this Admin route, six-field aggregate contract, authorization and
failure behavior, and compact Console state model?
# Scenarios and sequences

Status: published integration scenarios

These sequences use placeholders such as `APP_ID`, `SPACE_ID`, `ROOT_HASH`, and
`CAPABILITY`. They contain no production identity or bearer material.

## Acquire a least-privileged capability

The App authenticates its own user and authorizes the business action before
choosing any capability claims. UniCAS does not authenticate the App user and
does not provide Space enumeration for that user.

```mermaid
sequenceDiagram
    actor User as App user
    participant UI as App frontend
    participant App as App backend / issuer
    participant CAS as UniCAS Space data plane

    User->>UI: Sign in to the App
    UI->>App: Request access for a business action
    App->>App: Authenticate user and resolve Principal
    App->>App: Authorize Principal -> App / Space / refDomain
    App->>App: Select minimum permission and short expiry
    App-->>UI: Signed Space capability
    UI->>CAS: Space request with Bearer capability
    CAS->>CAS: Resolve issuer and active App
    CAS->>CAS: Verify signature, audience, time, App, Space, permission
    CAS-->>UI: Operation response
```

If the capability is expired or otherwise invalid, the App frontend returns to
its backend for a newly authorized capability. It must not retry with broader
permissions or an administrator credential.

## Read metadata and streamed content

Read metadata first when the App needs size, media type, child refs, or
retention state. Content is streamed and may be read in a byte range.

```mermaid
sequenceDiagram
    participant UI as App frontend
    participant CAS as UniCAS Space data plane

    UI->>CAS: GET .../nodes/ROOT_HASH/metadata<br/>cas:nodes:read capability
    alt Node is ready in the same Space
        CAS-->>UI: 200 metadata + retention state
        UI->>CAS: GET .../nodes/ROOT_HASH/content<br/>optional Range
        alt Full read
            CAS-->>UI: 200 streamed canonical bytes
        else Satisfiable range
            CAS-->>UI: 206 selected bytes
        else Invalid or unsatisfiable range
            CAS-->>UI: 416 + Content-Range: bytes */size
        end
    else Node absent or not readable
        CAS-->>UI: 404
    end
```

GET operations are safe to repeat, but callers should still use cancellation
and bounded retry policy. Retry transient transport or server failures; do not
retry `401`, `403`, or an unsatisfiable range unchanged. The public client does
not implement a general automatic retry loop.

## Upload an immutable node and acquire a lease

The hash is the lowercase SHA-256 digest of canonical node bytes. A lease
protects the preparation window; it is not a durable business reference and
does not imply that content is ready.

```mermaid
sequenceDiagram
    participant App as App workflow
    participant CAS as UniCAS Space data plane
    participant Upload as Authorized upload target

    App->>CAS: POST .../nodes/HASH/lease<br/>leaseDurationMs + cas:nodes:lease
    alt state=ready
        CAS-->>App: 200 ready lease
    else state=awaiting_upload
        CAS-->>App: 200 awaiting_upload + PUT instructions
        App->>Upload: PUT canonical bytes with returned headers
        Upload-->>App: Success or tolerated 412
        App->>CAS: Repeat the same POST lease(HASH)
    else state=awaiting_replacement_upload
        CAS-->>App: 200 rejection + replacement PUT instructions
        App->>Upload: PUT corrected canonical bytes with returned headers
        Upload-->>App: Success or tolerated 412
        App->>CAS: Repeat the same POST lease(HASH)
    else state=validated_awaiting_children
        CAS-->>App: 200 all distinct unready child hashes
        loop Each returned child
            App->>CAS: Lease/upload child hash until ready
        end
        App->>CAS: Repeat the same parent lease(HASH)
    end
```

The lease request never carries canonical bytes, upload length, or upload ID.
Hash mismatch, malformed content, and oversized content return
`awaiting_replacement_upload` with a fresh write-once target. Until corrected
bytes are uploaded, repeating the lease preserves that state and rejection;
only an expired target without an object causes its upload instructions to be
rotated.

A valid parent waiting for dependencies returns
`validated_awaiting_children` with every distinct unready child hash in
canonical first-occurrence order. UniCAS retains its validated bytes, so the
App makes those children ready and repeats the parent lease without uploading,
hashing, or parsing the parent again.

For an already-ready node, repeating lease preserves the start of an active
lease and only extends its expiry. An expired lease starts a new interval.

The low-level client performs one lease request. The blob client performs the
direct PUT, tolerates `412` as an already-satisfied upload step, and repeats the
same lease request.

## Atomically commit or release Root Refs

A business state transition is one atomic `changes` map. Moving authority from
one root to another must be `{ oldHash: -1, newHash: +1 }` in one request, not
two requests.

```mermaid
sequenceDiagram
    participant App as App backend
    participant CAS as UniCAS Space data plane

    App->>CAS: POST .../root-refs<br/>requestId + changes + cas:root-refs:update + refDomain
    CAS->>CAS: Validate all hashes, readiness, balances, and domain revision
    alt First successful commit
        CAS-->>App: 200 success, idempotent=false, revision
    else Same requestId and same canonical payload
        CAS-->>App: 200 success, idempotent=true, original revision
    else Same requestId with different payload
        CAS-->>App: 409 IDEMPOTENCY_CONFLICT
    else Missing/unready node or negative aggregate
        CAS-->>App: 404 or 409, no partial commit
    else Internal revision race
        CAS->>CAS: Bounded retry with backoff
        CAS-->>App: One atomic outcome
    end
```

If the client loses the response, retry the exact same canonical request with
the same `requestId`. Never reuse a `requestId` for different changes.

To inspect committed state, page through `GET .../root-refs` with a
`cas:root-refs:read` capability carrying the same `refDomain`. Pages are
revision-stable; the response returns the domain and revision alongside the
next cursor.

## Inspect usage and run bounded garbage collection

Usage and collection have independent authorities. Grant either or both only
when the operational workflow requires them.

```mermaid
sequenceDiagram
    participant Operator as App-owned maintenance workflow
    participant CAS as UniCAS Space data plane

    Operator->>CAS: GET .../cas/usage<br/>cas:usage:read
    CAS-->>Operator: Counts and byte accounting
    Operator->>CAS: POST .../cas/gc<br/>{ maxNodes } + cas:gc:execute
    loop Up to maxNodes candidates
        CAS->>CAS: Recheck refs and lease immediately before delete
        alt Still unreferenced and lease expired
            CAS->>CAS: Delete content, then metadata
        else Became protected
            CAS->>CAS: Skip candidate
        end
    end
    CAS-->>Operator: examined, deleted, reclaimedContentBytes
```

The default bound is 100 nodes when `maxNodes` is omitted. A pass is advisory:
it may leave more eligible work, so schedule additional bounded passes rather
than assuming one call empties the Space.

## Retention model

A ready node survives while at least one protection applies:

- a positive Root Ref balance;
- a child reference from a protected graph; or
- an unexpired lease.

GC eligibility requires no child refs, no Root Refs, and an expired lease. The
collector rechecks eligibility immediately before deletion to avoid racing a
new reference. Root Ref commit is the durable state boundary; leases exist to
protect uploads while that commit is prepared.

Lease duration defaults to 15 minutes and is clamped to 60 seconds through 24
hours. Renewing an active lease preserves its original start and never shortens
its expiry.

See [State protection and garbage collection](../cas-state-protection-and-gc.md)
for the full accepted model.

## Failure and retry rules

| Outcome | Caller action |
| --- | --- |
| `401 missing_token`, `invalid_token`, `unknown_issuer` | Stop the Space call. Re-authenticate or obtain a newly authorized capability through the App. |
| `401 registry_unavailable` | Treat as a temporary authorization dependency failure; retry with backoff without changing authority. |
| `403 APP_SUSPENDED` | Stop. App administration must resolve suspension outside the user flow. |
| `403 resource_scope_mismatch` | Treat as a caller bug or attempted cross-resource use. Do not rewrite route identifiers from token data. |
| `403 insufficient_permission` | Stop. Request a new capability only after the App independently authorizes the broader action. |
| `404` | Do not assume a different Space. Resolve the App-owned catalog or upload state. |
| `409` upload or Root Ref conflict | Resolve the named conflict; replay only when the operation's idempotency rules allow it. |
| `413` | Reduce payload or follow the configured upload limit; retries with the same oversized body will fail. |
| `416` | Correct the range using the returned total size. |
| `429 CAS_UPLOAD_LIMIT` | No upload generation was created. Back off until active upload work drains, then repeat the same lease request. |
| `500` or transport failure | Use bounded exponential backoff and preserve operation identity. For Root Refs, retain the same `requestId`. |

Authorization caches issuer authority for a short interval. A registry outage
may use known authority within a 60-second hard-stale window and emits stale
telemetry; after that bound the service fails closed with
`registry_unavailable`.

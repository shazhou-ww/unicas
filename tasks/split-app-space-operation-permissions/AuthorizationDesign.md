# Space operation authorization design

Status: proposed for scope, interface, and architecture review

Updated: 2026-09-21

## Decision summary

Keep the public HTTP API at `/v2`, but advance the signed Space capability
claim from `ver: 2` to `ver: 3`. Version 3 replaces the three broad Space
permissions with six exact operation authorities:

```text
cas:nodes:read
cas:nodes:lease
cas:root-refs:read
cas:root-refs:update
cas:usage:read
cas:gc:execute
```

The required signed `spaceId` claim is the capability's sole Space scope and
must match the route before permission evaluation. Permissions contain no
resource ID, are matched by exact string equality, and never imply one
another. A capability can carry several authorities, but every route checks
only its own required authority. Root Ref routes additionally require the
existing signed, validated `refDomain` claim.

Version 2 broad permissions remain valid only behind an explicit, absolute
issuance cutoff during rollout. Version 3 never accepts the old strings, the
new constructors do not produce them, and the default verifier configuration
rejects version 2. This makes compatibility finite rather than an indefinite
alias for combined authority.

## Scope confirmation

The reviewed outcome is the one defined in [Task.md](./Task.md): split node
read, node lease/upload, Root Ref read, Root Ref update, usage read, and GC
execution without changing routes, bodies, node and Root Ref semantics, or the
frozen Stack/Tenant v1 contract.

The completed direct-upload design remains authoritative. The node lease
permission covers both calls to `POST .../lease`; a returned presigned PUT URL
is the temporary upload credential. No App capability is sent to object
storage, and upload does not receive a separate permission that would be
useless without lease.

The later App/Space terminology refactor remains sequenced after this task and
does not overlap its permission or version changes.

## Version 3 claim contract

The Space claim shape remains unchanged except for `ver` and the permission
vocabulary:

```json
{
  "ver": 3,
  "iss": "https://issuer.example",
  "sub": "principal-123",
  "aud": "https://api.unicas.work/v2/apps/APP_ID",
  "iat": 1789952400,
  "nbf": 1789952400,
  "exp": 1789952700,
  "jti": "capability-id",
  "spaceId": "SPACE_ID",
  "permissions": [
    "cas:nodes:read",
    "cas:nodes:lease"
  ]
}
```

These are decoded claims, not a bearer token or signing fixture. The App's
configured issuer remains the authority. The verifier continues to derive the
App from that verified issuer and to match issuer App and claim Space to route
resources before checking the exact operation permission.

`SpaceCapabilityVersion` becomes `3`. `SpaceCapabilityClaims` describes only
the current version. Stack/Tenant `CapabilityVersion` remains `1` and its
claims, parser, constructors, routes, and authorization behavior do not
change.

## Permission grammar

Version 3 uses fixed `cas:{resource}:{action}` strings. A Space capability
contains exactly one required signed `spaceId`, so repeating that ID inside
each permission would create two representations of the same scope without
adding authority. The App is likewise derived from the verified issuer rather
than repeated in permissions. Permission strings are meaningful only as part
of the signed single-Space claim and are not independently transferable
capabilities.

Keeping the `cas` namespace makes these authorities visibly distinct from any
future non-CAS Space capability, while the resource and action segments state
the operation boundary directly.

| Authority | Constructor | Parsed kind |
| --- | --- | --- |
| `cas:nodes:read` | `spaceNodeReadPermission()` | `cas:nodes:read` |
| `cas:nodes:lease` | `spaceNodeLeasePermission()` | `cas:nodes:lease` |
| `cas:root-refs:read` | `spaceRootRefsReadPermission()` | `cas:root-refs:read` |
| `cas:root-refs:update` | `spaceRootRefsUpdatePermission()` | `cas:root-refs:update` |
| `cas:usage:read` | `spaceUsageReadPermission()` | `cas:usage:read` |
| `cas:gc:execute` | `spaceGcExecutePermission()` | `cas:gc:execute` |

`parseSpaceCapabilityPermission` parses only these current three-segment
strings. It rejects unknown resource/action pairs, all `spaces:`-scoped
strings including the three broad v2 permissions, and all v1 `tenants:`
strings. The old `spaceCasReadPermission`, `spaceCasWritePermission`, and
`spaceCasManagePermission` exports are removed rather than retained as
issuance aliases.

## Route matrix

| Public operation | Method and route suffix | Exact v3 permission | Additional scope |
| --- | --- | --- | --- |
| Read node content | `GET /cas/nodes/{hash}/content` | `cas:nodes:read` | None |
| Read node metadata and retention state | `GET /cas/nodes/{hash}/metadata` | `cas:nodes:read` | None |
| Lease, upload, finalize, or renew a node | `POST /cas/nodes/{hash}/lease` | `cas:nodes:lease` | None |
| List Root Ref balances | `GET /root-refs` | `cas:root-refs:read` | Valid signed `refDomain` |
| Atomically update Root Refs | `POST /root-refs` | `cas:root-refs:update` | Valid signed `refDomain` |
| Inspect Space usage | `GET /cas/usage` | `cas:usage:read` | None |
| Execute one bounded GC pass | `POST /cas/gc` | `cas:gc:execute` | None |

Content and metadata remain one read authority because metadata includes the
retention state intentionally exposed with node reads. Lease and direct upload
remain one authority because neither half is independently useful. Every
other row is independently grantable.

## Enforcement and denials

The cloud-neutral service maps every matched `AppSpaceRoute` to one exact v3
constructor. It does not parse permissions into implied categories and does
not accept one operation's authority for another operation.

Authorization keeps the existing order:

1. resolve the unverified issuer only to locate candidate App authority;
2. reject suspended Apps and verify signature, issuer, audience, time,
   lifetime, and claim shape;
3. match issuer-derived App and signed Space to the route;
4. require the route's exact version-specific permission; and
5. for either Root Ref route, validate the signed `refDomain`.

For v3, the complete Space authorization predicate is the conjunction of the
independent scope and operation checks:

```text
claims.spaceId === route.spaceId
permissions includes requiredPermission(route.operation)
```

Neither check substitutes for the other, and a capability cannot name more
than one Space.

A valid v3 token missing the exact operation permission receives HTTP 403 with
`error: "insufficient_permission"`. The response may include the existing safe
diagnostic message naming the required permission. A correctly permissioned
Root Ref token with a missing, invalid, or reserved domain continues to receive
HTTP 403 `resource_scope_mismatch`. Permission denial remains earlier than
domain validation.

The current v2 actor path serializes a `CapabilityError` message into the
`error` field even though the public contract documents stable error codes.
Implementation will give v2 Space authorization its own response mapper:

```json
{
  "error": "insufficient_permission",
  "message": "CAS updateRootRefs requires cas:root-refs:update"
}
```

The frozen v1 response path is not changed. HTTP-level tests will pin the v2
status and code, in addition to verifier-level tests. The public client remains
an opaque bearer-token transport: it neither exchanges a denial for a broader
token nor retries with another permission.

## Issuance profiles

These are recommended profiles, not implication rules enforced by UniCAS:

| Profile | Normal authorities | Notes |
| --- | --- | --- |
| Client data preparation | `cas:nodes:read`, `cas:nodes:lease` | Normal frontend read/write profile. It cannot commit or release durable business roots. |
| App-backend Root Ref coordination | `cas:root-refs:read`, `cas:root-refs:update` plus one `refDomain` | Backend-only by default because the App coordinates its database and Root Ref transition. Add node authorities only for a separate demonstrated need. |
| Explicit client-only App | Client data preparation plus one or both Root Ref authorities and one `refDomain` | Root Ref update is a deliberate App authorization choice, not a consequence of upload authority. |
| Usage inspection | `cas:usage:read` | Does not grant GC or data access. |
| Garbage collection | `cas:gc:execute` | Does not grant usage inspection or data access. Grant both operational permissions only when the workflow performs both. |

UniCAS does not infer browser or backend origin from a bearer token. The App
issuer owns principal authorization, token delivery, permission combinations,
and practical lifetime beneath the configured maximum.

## Version 2 migration

Version 2 means the existing broad grammar only:

```text
spaces:{spaceId}:cas:read
spaces:{spaceId}:cas:write
spaces:{spaceId}:cas:manage
```

During a bounded transition, those strings retain their historical route map
only for a token whose signed `ver` is `2`:

| Legacy v2 authority | Transitional routes |
| --- | --- |
| `cas:read` | Node content, node metadata, Root Ref list |
| `cas:write` | Node lease/upload, Root Ref update |
| `cas:manage` | Usage, GC |

The Cloudflare adapter adds one optional non-secret setting:

```text
CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE=2026-09-28T00:00:00Z
```

It is an exclusive absolute RFC 3339 issuance cutoff, not a renewable grace
duration. When omitted, v2 is rejected. Invalid values fail closed. A future
cutoff may be at most seven days from verifier initialization, matching the
global maximum capability lifetime and preventing an accidental long-lived
compatibility mode.

With the setting present, the verifier accepts a v2 token only when
`iat < cutoff`; ordinary signature, audience, scope, `nbf`, `exp`, and the
App's configured maximum-lifetime checks still apply. Its legacy scoped
permission must also encode the same Space as the signed `spaceId` claim. A v2
token issued before the cutoff can therefore live only until its signed
expiry. Backdating cannot extend acceptance beyond the issuer-specific
lifetime bound.

Rollout order:

1. Inventory active App issuer maximum lifetimes and choose an absolute cutoff
   far enough ahead to update every participating issuer, but no more than
   seven days ahead.
2. Deploy a verifier that accepts v3 and accepts v2 only before that issuance
   cutoff. Publish the v3 protocol package and issuer guidance in the same
   release.
3. Change every App issuer and the repository smoke issuer to emit v3 exact
   permissions. Stop v2 issuance before the configured cutoff.
4. After the cutoff, wait for the greatest configured active-App capability
   lifetime plus the existing clock tolerance. Existing v2 tokens then expire
   naturally; authority-cache lifetime does not extend JWT expiry.
5. Remove `CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE`. The default and steady-state
   verifier accepts v3 only. A later cleanup may remove the private legacy map;
   no public legacy constructor or alias survives this task.

If coordinated issuer rollout cannot meet the selected cutoff, move the
cutoff only through a separately reviewed deployment before it passes. Never
reinterpret a v2 broad string as a v3 operation permission and never issue
both versions as a fallback after the cutoff.

## Ownership and implementation surfaces

| Owner | Change |
| --- | --- |
| `@unicas/tenant-protocol` | Own v3 constant, permission type/kinds, six constructors, strict parser, exports, tests, and per-operation OpenAPI descriptions. Keep v1 declarations unchanged. |
| `@unicas/service` | Map each route to one exact authority, verify v3 by default, apply private bounded v2 compatibility, preserve `refDomain`, and return stable v2 Space authorization codes. |
| `@unicas/service-cloudflare` | Parse and wire the absolute migration cutoff without logging tokens or claims. |
| Public client packages | Continue transporting the supplied token without permission inference, fallback, or automatic escalation. Update only tests or public wording that names broad permissions. |
| Smoke and deployment | Mint v3 in the App/Space smoke, document cutoff ordering and drain calculation, and leave the Stack/Tenant smoke unchanged. |
| App-user documentation | Publish v3 claims, exact route matrix, issuance profiles, migration behavior, and denial handling. |
| Generated artifacts | Regenerate Space v2 OpenAPI and tracked package/UI outputs from source; do not edit generated files by hand. |

The administrator credential boundary is unchanged. Admin sessions do not
become Space capabilities, and operational permissions remain Space
data-plane authorities issued by the App authority.

## Validation plan

Protocol tests will prove all six fixed strings and parser results, reject
malformed pairings and scoped or broad strings in the v3 parser, and keep the
v1 parser behavior unchanged.

Service tests will use a table covering every route with its one expected v3
permission. Pairwise negative cases will prove at minimum:

- node lease succeeds while Root Ref update returns 403
  `insufficient_permission`;
- Root Ref update with a valid domain succeeds while node lease returns 403
  `insufficient_permission`;
- Root Ref read and node read do not authorize one another;
- usage read and GC execute do not authorize one another or any data route;
- both Root Ref permissions reject missing, invalid, and reserved domains;
- v3 rejects all broad v2 strings and v1 permission strings;
- v2 is rejected by default, accepted only before the configured issuance
  cutoff, and rejected at the exact cutoff;
- a pre-cutoff v2 token remains bounded by its ordinary expiry and issuer
  lifetime; and
- v1 verifiers continue to reject Space versions and retain their existing
  route matrix.

HTTP actor tests will assert the v2 Space error envelope and trusted forwarding
headers. OpenAPI drift, documentation checks, affected package builds and
tests, workspace typechecking, and the unchanged v1 authorization suite will
run before delivery review.

## Review decision

Approval of this artifact approves the task scope and the following protected
interface and architecture decisions:

- capability `ver: 3` on the unchanged Space HTTP v2 API;
- the six exact wire strings and constructor names above;
- the signed `spaceId` claim as the sole Space scope, without duplicating it in
  v3 permission strings;
- no permission inheritance or public legacy aliases;
- `refDomain` as an additional signed requirement for both Root Ref routes;
- v3-only default verification with a bounded absolute v2 issuance cutoff;
- the rollout and issuance profiles above; and
- v2 Space error-code conformance without changing frozen v1 behavior.

Substantive protocol, verifier, generated OpenAPI, and App-user documentation
changes begin only after explicit approval.
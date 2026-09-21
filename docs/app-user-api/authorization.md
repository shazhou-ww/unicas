# Capability authorization

Status: Interface review draft

## Verification model

Every v2 Space request carries a short-lived bearer JWT issued by the App's
configured external issuer. The UniCAS service:

1. reads the unverified issuer only to locate the App authority;
2. rejects an unknown issuer or unavailable authority registry;
3. rejects a suspended App before accepting capability claims;
4. verifies the ES256 signature, issuer, configured audience, time claims, and
   capability shape;
5. requires the issuer-derived App to equal route `appId`;
6. requires claim `spaceId` to equal route `spaceId`;
7. requires the exact operation permission for that Space; and
8. requires a valid `refDomain` for Root Ref list or update.

Client-side route construction or operation visibility is not an authorization
boundary.

## Claims

| Claim | Requirement and meaning |
| --- | --- |
| `ver` | Space capability version `3` for the HTTP v2 API. |
| `iss` | Exact configured external issuer. It determines the App authority. |
| `sub` | App-defined subject for audit correlation; it does not replace App or Space scope checks. |
| `aud` | Exact resource audience configured for the App. |
| `iat` | Issued-at NumericDate. |
| `nbf` | Not-before NumericDate. |
| `exp` | Expiry NumericDate. The lifetime must not exceed the App's configured maximum. |
| `jti` | Unique token identifier for audit and operational correlation. |
| `spaceId` | Exact Space allowed by the token. |
| `permissions` | Array containing exact `cas:{resource}:{action}` operation strings. |
| `refDomain` | Optional for non-Root-Ref operations; required and validated for Root Ref list/update. |

The protected header uses algorithm `ES256` and token type
`unidocs-cap+jwt`.

## Permission vocabulary

Permissions do not imply one another:

```text
cas:nodes:read
cas:nodes:lease
cas:root-refs:read
cas:root-refs:update
cas:usage:read
cas:gc:execute
```

The required signed `spaceId` claim is the token's sole Space scope and must
match the route before permission evaluation. Permission strings contain no
resource ID and are not independently transferable capabilities.

## Operation-to-permission matrix

| Operation | Required permission | `refDomain` |
| --- | --- | --- |
| Read node content | `cas:nodes:read` | Not used |
| Read node metadata | `cas:nodes:read` | Not used |
| Lease/upload node | `cas:nodes:lease` | Not used |
| List Root Refs | `cas:root-refs:read` | Required |
| Update Root Refs | `cas:root-refs:update` | Required |
| Get usage | `cas:usage:read` | Not used |
| Run GC | `cas:gc:execute` | Not used |

A token may contain multiple permissions when one user action genuinely needs
them, but issue the smallest set and shortest practical lifetime. Do not issue
GC authority merely because a client library also exposes usage inspection.

## Recommended issuance profiles

| Workflow | Normal permissions | Guidance |
| --- | --- | --- |
| Client data preparation | `cas:nodes:read`, `cas:nodes:lease` | Normal frontend profile. It can prepare immutable state but cannot commit or release durable roots. |
| App-backend Root Ref coordination | `cas:root-refs:read`, `cas:root-refs:update` and one `refDomain` | Backend-only by default. Add node permissions only when the backend separately requires them. |
| Explicit client-only App | Client data preparation plus the required Root Ref permission and one `refDomain` | Grant Root Ref update only as a deliberate App authorization decision. |
| Usage inspection | `cas:usage:read` | Does not grant GC or data access. |
| Garbage collection | `cas:gc:execute` | Does not grant usage inspection or data access. |

UniCAS does not infer browser or backend origin from a bearer token. The App
issuer owns that delivery decision.

## `refDomain`

A `refDomain`:

- is at most 64 characters;
- starts with a lowercase ASCII letter;
- then contains lowercase letters or digits;
- may contain colon-separated non-empty lowercase alphanumeric segments;
- cannot start with `_` and cannot use reserved values.

Examples:

```text
files
files:primary
documents:shared
```

The service takes the domain only from the verified capability and overwrites
attacker-supplied forwarding headers. This prevents one caller from selecting a
different domain through query, body, or header manipulation.

The App owns the meaning and lifecycle of domains. Use separate domains when
independent business root catalogs need independent revisions and authority.

## Least-privilege examples

Read one Space:

```json
{
  "ver": 3,
  "iss": "https://issuer.example",
  "sub": "principal-123",
  "aud": "https://api.unicas.work",
  "iat": 1760000000,
  "nbf": 1760000000,
  "exp": 1760000300,
  "jti": "cap-001",
  "spaceId": "SPACE_ID",
  "permissions": [
    "cas:nodes:read"
  ]
}
```

Commit roots in one domain:

```json
{
  "ver": 3,
  "iss": "https://issuer.example",
  "sub": "principal-123",
  "aud": "https://api.unicas.work",
  "iat": 1760000000,
  "nbf": 1760000000,
  "exp": 1760000300,
  "jti": "cap-002",
  "spaceId": "SPACE_ID",
  "permissions": [
    "cas:root-refs:update"
  ],
  "refDomain": "files:primary"
}
```

These are decoded claim examples, not bearer tokens or signing instructions.
Signing keys remain only with the App's issuer.

## Explicit denials

### Cross-App

A token from issuer authority for `APP_A` calls a route under `APP_B`.

```text
403 resource_scope_mismatch
```

The arbitrary claim or route value does not override issuer-derived App
identity.

### Cross-Space

A token with `spaceId: SPACE_A` and `cas:nodes:read` calls a route for
`SPACE_B`.

```text
403 resource_scope_mismatch
```

Adding other operation permissions does not make claim `spaceId` match that
route.

### Insufficient authority

A token without the route's exact operation permission calls that route.

```text
403 insufficient_permission
```

The client must not automatically exchange this for a broader token. The App
must authorize a new action independently.

### Missing Root Ref domain

A token with the correct Root Ref read or update permission calls that
operation without a valid `refDomain`.

```text
403 resource_scope_mismatch
```

Both listing and updating Root Refs require the domain.

### Suspended App

Requests associated with a suspended App return:

```text
403 APP_SUSPENDED
```

Suspension is checked before JWT claims are accepted. The user flow must not
fall back to administrator credentials or another App.

## Authentication and dependency failures

| Code | Status | Meaning |
| --- | --- | --- |
| `missing_token` | `401` | No bearer capability was supplied. |
| `invalid_token` | `401` | JWT, signature, issuer/audience binding, time, lifetime, or claim shape failed verification. |
| `unknown_issuer` | `401` | The issuer does not resolve to an App authority. |
| `registry_unavailable` | `401` | Authority data cannot be obtained within the hard-stale bound. |
| `unsupported_algorithm` | `403` | The protected header does not use the supported algorithm. |

Authority metadata is cached for 30 seconds by default. If refresh fails, known
authority may be served within a 60-second hard-stale bound while emitting
stale telemetry. Beyond that bound, the service fails closed.

## Capability delivery

Recommended pattern:

1. the frontend authenticates to the App;
2. the backend resolves and authorizes the App Principal;
3. the issuer signs a short-lived, action-specific Space capability;
4. the backend delivers it over the App's authenticated channel;
5. the frontend supplies it to the public client token callback;
6. the App refreshes it only after another authorization decision.

Avoid persistent browser storage when an in-memory token is sufficient. Never
log bearer tokens, include them in URLs, commit them as examples, or exchange an
administrator session for data-plane authority in the browser.

## Version 2 migration

Legacy capability `ver: 2` used Space-scoped broad permissions:

```text
spaces:{spaceId}:cas:read
spaces:{spaceId}:cas:write
spaces:{spaceId}:cas:manage
```

They are not aliases for v3 permissions. UniCAS accepts them only when an
operator configures the absolute
`CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE` migration cutoff and the token's signed
`iat` is earlier than that instant. The normal signature, route scope, expiry,
and App-specific maximum-lifetime checks still apply. Without that setting,
v2 is rejected.

App issuers must switch to `ver: 3` and the exact operation vocabulary before
the cutoff. After the cutoff plus the greatest active App issuer lifetime and
clock tolerance, operators remove the setting. Version 3 never accepts the
legacy strings, and version 2 never accepts the v3 strings.

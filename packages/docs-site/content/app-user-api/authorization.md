# Capability authorization

Status: published authorization contract

## Verification model

Every v1 Space request carries a short-lived bearer JWT issued by the App's
configured external issuer. The UniCAS service:

1. reads the unverified issuer only to locate the App authority;
2. rejects an unknown issuer or unavailable authority registry;
3. rejects a suspended App before accepting capability claims;
4. verifies the ES256 signature, issuer, configured audience, time claims, and
   capability shape;
5. requires the issuer-derived App to equal query `appId`;
6. finds grants whose selector matches the route `spaceId`;
7. requires at least one matching grant to contain the exact operation
   permission; and
8. requires a valid `refDomain` for Root Ref list or update.

Client-side route construction or operation visibility is not an authorization
boundary.

## Claims

| Claim | Requirement and meaning |
| --- | --- |
| `ver` | Space capability family-local version `2` for the HTTP v1 API. |
| `iss` | Exact configured external issuer. It determines the App authority. |
| `sub` | App-defined subject for audit correlation; it does not replace App or Space scope checks. |
| `aud` | Exact CAS v1 resource audience: `https://api.unicas.work/v1/cas/` on the production origin. |
| `iat` | Issued-at NumericDate. |
| `nbf` | Not-before NumericDate. |
| `exp` | Expiry NumericDate. The lifetime must not exceed the App's configured maximum. |
| `jti` | Unique token identifier for audit and operational correlation. |
| `grants` | Non-empty array of at most 32 Space selector and permission bindings. |
| `grants[].selector` | Canonical exact, terminal single-segment prefix, or terminal recursive Space selector. |
| `grants[].permissions` | Non-empty array of exact `cas:{resource}:{action}` operation strings for that selector. |
| `refDomain` | Optional for non-Root-Ref operations; required and validated for Root Ref list/update. |

The generated OpenAPI publishes this shape as
`components.schemas.SpaceCapabilityClaims`. The bearer security scheme's
`x-unicas-capability` extension references that schema, and each operation's
`x-unicas-authorization` extension names its exact permission and required
claims. Root Ref operations additionally link `refDomain` to
`components.schemas.SpaceRefDomainClaim`. The global security requirement
deliberately retains an empty array:
these permission strings are signed capability claims, not OAuth scopes.

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

Permission strings contain no resource ID and are not independently
transferable capabilities. Their resource scope comes only from the selector
in the same grant.

## Space IDs and selectors

A canonical Space ID:

- is at most 256 characters;
- begins with `/`;
- contains one or more non-empty path segments;
- uses only ASCII letters, digits, `_`, and `-` in each segment; and
- is case-sensitive.

Examples are `/users/u_123`, `/shared/report-2026`, and
`/archive/2026/q1`. Trailing `/`, empty segments, `.`, `..`, percent escapes,
and other characters are invalid.

Selectors support exactly three forms:

| Form | Example | Matches |
| --- | --- | --- |
| Exact | `/users/u_123` | Only that Space |
| Terminal single-segment prefix | `/shared/report-*` | `/shared/report-2026`, but not a child below it |
| Terminal recursive prefix | `/archive/**` | Descendants such as `/archive/2026` and `/archive/2026/q1`, but not `/archive` itself |

`*`, `/foo/*`, `/foo/*/bar`, and `/foo/**/bar` are invalid. Selector and
permission checks are inseparable: one grant must satisfy both. For example, a
token with write permission on `/users/u_123` and read permission on
`/shared/**` cannot write a shared Space.

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

A grant may contain multiple permissions when one user action genuinely needs
them, and a token may contain multiple grants for owned and shared resources.
Issue the smallest selector and permission set and shortest practical
lifetime. Do not issue GC authority merely because a client library also
exposes usage inspection.

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
`refDomain` applies to the whole token, not to an individual grant; use
separate tokens when selected Spaces require different Root Ref domains.

## Least-privilege examples

Read an owned Space and matching shared Spaces:

```json
{
  "ver": 2,
  "iss": "https://issuer.example",
  "sub": "principal-123",
  "aud": "https://api.unicas.work/v1/cas/",
  "iat": 1760000000,
  "nbf": 1760000000,
  "exp": 1760000300,
  "jti": "cap-001",
  "grants": [
    {
      "selector": "/users/principal-123",
      "permissions": [
        "cas:nodes:read"
      ]
    },
    {
      "selector": "/shared/report-*",
      "permissions": [
        "cas:nodes:read"
      ]
    }
  ]
}
```

Commit roots in one domain:

```json
{
  "ver": 2,
  "iss": "https://issuer.example",
  "sub": "principal-123",
  "aud": "https://api.unicas.work/v1/cas/",
  "iat": 1760000000,
  "nbf": 1760000000,
  "exp": 1760000300,
  "jti": "cap-002",
  "grants": [
    {
      "selector": "/users/principal-123",
      "permissions": [
        "cas:root-refs:update"
      ]
    }
  ],
  "refDomain": "files:primary"
}
```

These are decoded claim examples, not bearer tokens or signing instructions.
Signing keys remain only with the App's issuer.

## Explicit denials

### Cross-App

A token from issuer authority for `APP_A` sends query `appId=APP_B`.

```text
403 resource_scope_mismatch
```

The shared CAS audience identifies the protected API, while the globally
unique verified issuer determines App authority. An arbitrary query value does
not override that identity.

### Cross-Space

A token whose grants do not select `/users/u_456` calls that Space.

```text
403 resource_scope_mismatch
```

Adding permissions to a non-matching grant does not make its selector match
that route.

### Insufficient authority

A token has a matching selector, but no matching grant contains the route's
exact operation permission.

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
| `APP_SUSPENDED` | `403` | The issuer-derived App is suspended. |
| `resource_scope_mismatch` | `403` | The App, Space, or required Root Ref domain does not match. |
| `insufficient_permission` | `403` | The exact operation permission is absent. |

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

## Previous capability rejection

Space capability versions 1 and 3 are rejected with `401 invalid_token`.
Top-level `spaceId` and `permissions` do not replace required `grants`.
Malformed selectors, empty permissions, and more than 32 grants are also
rejected. There is no issuance cutoff or compatibility mode. See
[Space grants migration](migration-space-grants.md) for the complete consumer
cutover.

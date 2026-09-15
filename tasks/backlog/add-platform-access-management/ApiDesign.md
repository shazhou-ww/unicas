# Platform access API design

Status: discussion draft

Updated: 2026-09-15

## Design target

Support the platform workflows in [ConsoleMock.html](/tasks/backlog/add-platform-access-management/ConsoleMock.html) and
[UiDesign.md](/tasks/backlog/add-platform-access-management/UiDesign.md) without treating Google authentication, OAuth
scopes, App navigation visibility, or App membership as platform authority.

The proposed model has three independent inputs to authorization:

1. immutable Principal identity `(issuer, subject)`;
2. zero or more platform authorities assigned to that Principal;
3. App memberships assigned through the existing App invitation flow.

A separate platform access status can block all administrator-plane access for
a Principal without deleting its authorities, memberships, or audit history.

## Recommended decisions

### Keep one administrator API plane

Keep all routes under the existing `/admin` BFF and protocol. Platform routes
use `/admin/platform/*`; App routes remain under `/admin/apps/*`. This matches
the single Console deployment while preserving a distinct server-side
authorization guard.

Do not introduce a second hostname, cookie, Google OAuth client, protocol
package, or service deployment.

### Use independent authorities, not a hierarchy

```ts
export type PlatformAuthority =
  | "platform.admin"
  | "apps.create";
```

`platform.admin` does not imply `apps.create`, and `apps.create` does not imply
`platform.admin`. A Principal may hold either or both. This is visible as two
independent controls in the mock and avoids silently granting product access to
an operator who only manages authorization.

OAuth scopes such as `control:write` and `control:security` remain delegated
client scopes. An operation requires both its OAuth scope, where applicable,
and current server-side authority.

### Keep current App membership semantics in this task

Retain the existing equal-authority App administrator membership. App
membership permits App-local administrator operations but never App creation or
platform administration.

Do not add App-local `admin` and `member` roles in this task. UniCAS has no
end-user application surface, and adding a weaker App role would require a
separate operation-by-operation App authorization design. The platform UI may
show the existing membership as `Administrator` to avoid suggesting otherwise.

### Model access state separately from effective admission

Persist one platform access-state record after a Principal first accepts either
a platform invitation or an App invitation. The record itself is not an
admission grant.

```ts
export type PlatformAccessStatus = "active" | "blocked";

export interface PlatformAccessState {
  readonly principalRef: string;
  readonly principal: Principal;
  readonly status: PlatformAccessStatus;
  readonly authorities: readonly PlatformAuthority[];
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
```

`principalRef` is an opaque API resource identifier used in URLs. Authorization
continues to use `(issuer, subject)`; clients must not infer identity from the
reference.

Effective full admission is:

```text
status == active
AND (authorities is non-empty OR current App membership exists)
```

A valid pending invitation permits only the invitation acceptance workflow. It
does not grant general Console, CLI, or MCP access. Removing the last App
membership from a Principal with no platform authority therefore removes full
admission while retaining its access-state and audit history.

`blocked` is a deny override. It denies Console, CLI, remote MCP, platform
invitation acceptance, App invitation acceptance, and App administrator routes
regardless of current authorities or memberships.

## Read models

### Shared wire conventions

[PlatformAccess.openapi.json](/tasks/backlog/add-platform-access-management/PlatformAccess.openapi.json) is the executable
proposal contract; [ApiReference.html](/tasks/backlog/add-platform-access-management/ApiReference.html) renders that file
directly. These remain design artifacts, not a replacement for the generated
administrator protocol. Existing clients and server contracts must migrate
together when the affected prerequisite tasks are implemented.

- JSON fields and query parameters use lower camel case. Resource identifiers
  keep their domain names (`appId`, `invitationId`, `inspectionId`, `eventId`,
  `principalRef`); all are non-empty opaque strings, never display labels.
- `Principal` always means `{ issuer, subject }`. `Profile` contains only
  non-authoritative `displayName` and `emailForDisplay`. A Principal reference
  is a locator, not a replacement identity or authorization grant.
- All `*At` timestamps and the `createdAfter` filter are non-negative Unix
  epoch milliseconds. Durations use an explicit unit suffix. Unknown read
  values are `null`; omitted request fields mean unchanged or not supplied.
  Empty strings are not substitutes for missing identifiers or cursors.
- `revision` is a non-negative safe integer owned by one mutable resource.
  A strong ETag is that integer quoted as canonical decimal (`"4"`, not
  `W/"4"` or `"04"`). `If-Match` uses that exact tag, not an App revision
  for an issuer, an inspection revision for activation, or a list cursor.
- Every list uses `{ items, nextCursor }`, with `nextCursor: null` at the end.
  `limit` is 1..1000, default 50. Cursors bind the snapshot, filters, and order;
  they are not event IDs, timestamps, or authorization snapshots. Authorization
  is rechecked on every page; incompatible traversal parameters return
  `400 INVALID_CURSOR`.
- `status` is a persisted resource lifecycle: platform access is
  `active | blocked`, an App is `active | suspended`, and invitations share
  `pending | accepted | expired | revoked`. `effectiveAccess` is the derived
  admission result `active | blocked | no_access`, including in list filters.
  `no_access` is never a persisted status or PATCH input.
- `authorities` is a set encoded as a duplicate-free array of the shared
  `PlatformAuthority` enum. Responses use enum declaration order; request
  order has no authorization meaning. An empty set revokes all authorities;
  invitation creation requires at least one. The `authority=none` list filter
  selects an empty set and is never itself an authority value.
- Requests reject unknown fields. PATCH requires at least one recognized
  field, rejects `null`, and atomically replaces supplied fields. Lists and
  read projections have explicit schemas, not arbitrary object extensions.

App invitations retain the existing optional `emailConstraint`: omission
creates an unconstrained bearer invitation, represented as `null` on reads.
Platform invitations require the same normalized email format. Only an
email-constrained invitation can admit an otherwise unadmitted Principal via
the new login continuation; an unconstrained App invitation remains usable by
an already admitted Principal through a token-bound continuation. This avoids
silently changing existing App invitation semantics or opening registration.

### Minimal write responses

The HTTP success status acknowledges the mutation. Never echo the submitted
fields, the known resource ID from the path, complete resources, membership
objects, or `{ ok: true }` merely to confirm success. Mutable-resource versions
are returned once, in `ETag`, not duplicated in the body. Clients invalidate
affected read queries and reload GET projections when needed; they must not
attach a new ETag to an old cached object and present it as refreshed data.

| Operation | Success | Body | Version owner |
| --- | --- | --- | --- |
| Create App | `201` | `{ appId }` | App ETag |
| Update/suspend/restore App | `204` | None | App ETag |
| Create App or platform invitation | `201` | `{ invitationId, acceptUrl, expiresAt }` | Invitation ETag |
| Revoke App or platform invitation | `204` | None | Invitation ETag |
| Accept App invitation | `200` | `{ appId }` for navigation | No ETag; membership is not the invitation resource |
| Accept platform invitation | `204` | None; reload `/admin/me` | No ETag; multiple records/session state change |
| Inspect OAuth issuer | `201` | `{ inspectionId, metadataUrl, jwksUri, challenge, expiresAt, keys }` | Immutable candidate, no mutable-resource ETag |
| Activate/replace external issuer | `204` | None | External issuer ETag |
| Enable/disable managed issuer | `204` | None | Managed issuer ETag |
| Change platform access | `204` | None | Platform access ETag |

Invitation creation returns the ID for later revocation, the one-time delivery
URL, and its server-selected expiry. It does not echo constrained email,
authorities, App ID, status, creator, or creation time. Both invitation types
use `CreateInvitationResponse` with exactly the same shape.

App and invitation creation retries use `Idempotency-Key`, scoped to the authenticated Principal,
operation, and parent resource, with current authorization rechecked first.
An exact retry returns the original receipt and ETag without creating another
record. A key reused with different normalized input returns `409
IDEMPOTENCY_CONFLICT`. Any replay storage containing an accept URL must be
encrypted, expire no later than the invitation, and never be exposed through
reads, audit, or logs; a consumed/expired/revoked invitation is not recoverable
via replay and returns `409 INVITATION_NOT_PENDING`.

Conditional writes check their precondition before reporting success, even on
no-ops. A same-value PATCH or already-revoked invitation with its current ETag
returns `204` with that unchanged ETag; an old ETag returns `412`. An actual
transition increments only its owning resource revision. Missing required
preconditions return `428`; malformed or conflicting preconditions return
`400`; accepted or expired invitations cannot be revoked and return `409`.

### Current session

Extend the existing endpoint:

```http
GET /admin/me
```

```ts
export interface AppAdminMeResponse {
  readonly principal: Principal;
  readonly profile: Profile;
  readonly platformAccess: {
    readonly principalRef: string;
    readonly status: "active";
    readonly authorities: readonly PlatformAuthority[];
    readonly revision: number;
  };
  readonly memberships: readonly AppMembership[];
}
```

A full session receives `200`. A blocked or no-longer-admitted Principal
receives `403 PLATFORM_ACCESS_REQUIRED`; blocked and unknown users receive the
same browser-facing message to avoid account-state disclosure.

An invitation-limited session can call only the matching invitation read and
accept endpoints plus logout. It does not call `/admin/me` or any general
administrator endpoint.

The Console shell uses `platformAccess.authorities` to conditionally render the
App creation action and Platform Administration navigation. It continues to
load complete App display metadata from `GET /admin/apps`; `/admin/me` should
not duplicate App objects solely for Sidebar rendering.

### Access summary

The four summary values in the mock should not be inferred from the current
page of Principals.

```http
GET /admin/platform/access-summary
```

```ts
export interface PlatformAccessSummary {
  readonly activePrincipalCount: number;
  readonly platformAdminCount: number;
  readonly appCreatorCount: number;
  readonly blockedPrincipalCount: number;
  readonly generatedAt: number;
}
```

Requires `platform.admin`. Counts are current, not snapshot-bound to a Principal
list traversal. `activePrincipalCount` counts effective full admission;
authority counts include only active access state with the named authority.
`generatedAt` is the aggregate computation time, not a mutation revision.

### List Principals

```http
GET /admin/platform/principals
  ?query=<name-email-subject>
  &effectiveAccess=active|blocked|no_access
  &authority=platform.admin|apps.create|none
  &limit=<1..1000>
  &cursor=<opaque>
```

```ts
export interface PlatformPrincipalListItem extends PlatformAccessState {
  readonly profile: Profile;
  readonly effectiveAccess: "active" | "blocked" | "no_access";
  readonly appMembershipCount: number;
  readonly lastActiveAt: number | null;
}

export interface PlatformPrincipalPage {
  readonly items: readonly PlatformPrincipalListItem[];
  readonly nextCursor: string | null;
}
```

The list is a platform projection over access state, current Profile, and
membership counts. Pagination uses the existing snapshot-bound opaque cursor
convention. Profile fields are searchable display metadata, not identity keys
or part of the access revision. OpenAPI shares open field schemas internally
and closes each final projection with `unevaluatedProperties: false`; it must
not extend a closed object with `allOf` and reject the added projection fields.

### Read one Principal

```http
GET /admin/platform/principals/{principalRef}
```

```ts
export interface PlatformPrincipalDetail extends PlatformPrincipalListItem {
  readonly memberships: readonly AppMembership[];
}
```

Requires `platform.admin`. This response supplies the detail drawer and the
access-state `revision` needed for mutation. It has no composite-resource ETag:
membership/Profile changes are not versioned by access state. The dedicated
`GET /admin/platform/principals/{principalRef}/access` returns
`PlatformAccessState` and its strong ETag for read-modify-write callers.
Memberships remain read-only here; their mutations use App routes.

## Mutations

### Change authority or access status

```http
PATCH /admin/platform/principals/{principalRef}/access
If-Match: "<revision>"
Content-Type: application/json
```

```ts
export interface PatchPlatformAccessRequest {
  readonly status?: "active" | "blocked";
  readonly authorities?: readonly PlatformAuthority[];
}
```

The supplied fields replace their current values atomically. Success returns
`204 No Content` and the resulting access-state ETag, not `PlatformAccessState`.
The drawer reloads its read model when updated display data is needed.

Rules:

- at least one field must be present;
- duplicate or unknown authorities are invalid;
- `If-Match` is required;
- blocking retains authorities and memberships;
- restoring access does not manufacture an authority or membership;
- an administrator cannot block its own Principal;
- removing or blocking the final active `platform.admin` is rejected;
- every attempted mutation writes one success or denial audit event.

The authority save action and block confirmation in the mock both use this
endpoint. A stale drawer receives `412 REVISION_MISMATCH`, reloads the detail,
and asks the administrator to reconcile rather than retrying blindly.

### Create a platform invitation

```http
POST /admin/platform/invitations
Idempotency-Key: <key>
Content-Type: application/json
```

```ts
export interface CreatePlatformInvitationRequest {
  readonly emailConstraint: string;
  readonly authorities: readonly PlatformAuthority[];
}

export interface CreateInvitationResponse {
  readonly invitationId: string;
  readonly acceptUrl: string;
  readonly expiresAt: number;
}
```

```ts
export interface PlatformInvitation {
  readonly invitationId: string;
  readonly emailConstraint: string;
  readonly authorities: readonly PlatformAuthority[];
  readonly status: "pending" | "accepted" | "expired" | "revoked";
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly createdBy: Principal;
  readonly revision: number;
}
```

Requires `platform.admin` and at least one authority. Email is required and
must be normalized exactly as the existing verified-email invitation
constraint. Expiry is server policy rather than caller-selected. The bearer
token appears only in `acceptUrl`; it is never included in list responses,
audit details, or logs.

This endpoint is only for internal developers receiving platform authority.
App-only access continues to use:

```http
POST /admin/apps/{appId}/member-invitations
```

### List and revoke platform invitations

```http
GET /admin/platform/invitations
  ?query=<email>
  &status=pending|accepted|expired|revoked
  &limit=<1..1000>
  &cursor=<opaque>

DELETE /admin/platform/invitations/{invitationId}
If-Match: "<revision>"
```

Both require `platform.admin`. DELETE revokes without physically deleting
audit-relevant state and returns `204 No Content` plus the invitation ETag.
Only a pending, unexpired invitation can transition to revoked; a repeat with
the resulting ETag returns `204` without another transition. A stale ETag still
returns `412`. App and platform invitations share these rules, including
projecting elapsed pending invitations as expired before testing revocability.

### Accept a platform invitation

```http
POST /admin/platform-invitations/{token}/accept
```

The route deliberately sits outside `/admin/platform/*`: the authenticated
invitee is not yet a Platform Admin. It requires an invitation-limited Google
OIDC session bound to the same token and a verified email matching
`emailConstraint`.

Acceptance atomically:

1. consumes the single-use invitation;
2. creates or updates access state for the immutable Google Principal;
3. unions the invited authorities with the current set (empty for a new record);
4. refuses to override a blocked existing Principal;
5. records a platform audit event;
6. upgrades the invitation-limited session to a full session.

Acceptance never removes existing authority. Success returns `204 No Content`
after session rotation, then the client reloads `/admin/me`. App invitation
acceptance uses the same session rules but returns only `{ appId }` for routing;
neither response duplicates Principal, Profile, memberships, or access state.

## Invitation login boundary

A general Google login with no full admission is denied. Invitation URLs use a
special authorization continuation:

1. The browser presents the bearer token to the BFF invitation entry route.
2. The BFF validates only that a hashed token identifies an unexpired pending
   invitation, then starts Google OIDC with an encrypted, single-use
   continuation. Raw invitation tokens are not placed in logs or OAuth state.
3. The callback verifies Google issuer, subject, and `email_verified`, then
   compares normalized email to the invitation constraint.
4. The BFF creates an invitation-limited session bound to the invitation ID and
   token hash.
5. Route guards permit only read/accept for that exact invitation and logout.
6. Successful acceptance rotates the session identifier before granting full
   access.

Use the same mechanism for platform and email-constrained App invitations.
Unconstrained App invitations require prior full admission and cannot cross
this initial login gate. This replaces the
current static email allowlist as the only way an invited external member can
cross the initial login gate without opening general registration.

## App creation authorization

The existing route remains:

```http
POST /admin/apps
```

It now requires:

- a full admitted session;
- `apps.create` in current platform authorities;
- existing `control:write` OAuth scope for MCP clients;
- the existing idempotency behavior.

Successful creation still grants the creator first equal-authority App
membership, but returns only `201 { appId }` and the App ETag. The Console reads
App metadata separately. A Principal with App memberships but no `apps.create`
receives:

```text
403 APP_CREATION_AUTHORITY_REQUIRED
```

The Console hides the Create App form when `/admin/me` lacks the authority, but
the route guard is authoritative. Denied authenticated attempts produce a
rate-limited platform audit event without storing the requested App display
name.

## App-level prerequisites discovered by the UI

These contracts are required by the refined Console but are separate from
platform access authorization. They should be implemented as independent
backlog tasks and consumed by the Console rewrite.

- [App suspension boundary](/tasks/archived/enforce-app-suspension-boundary/Task.md)
- [App member invitation management](/tasks/archived/manage-app-member-invitations/Task.md)
- [Active App OAuth issuer replacement](/tasks/backlog/replace-active-app-oauth-issuer/Task.md)

### Suspend and restore an App

Extend the existing conditional App mutation rather than introducing
`inactive` vocabulary:

```http
PATCH /admin/apps/{appId}
If-Match: "<revision>"
Content-Type: application/json

{ "status": "suspended" }
{ "status": "active" }
```

`status` is optional alongside existing display metadata fields, and one field
must be present. Each transition increments the App revision and emits App
control audit action `app.suspended` or `app.restored`. Success is `204` plus
the App ETag, with no echoed App object.

Suspension semantics are fail-closed and App-wide:

- every Space data-plane read, write, and management operation is denied with
  `APP_SUSPENDED`;
- managed capability issuance is denied;
- issuer authority resolution joins the App record and resolves only active
  Apps, so already issued managed and external capabilities stop authorizing
  within the authority cache's hard stale bound;
- protected-resource metadata and managed issuer documents do not advertise a
  suspended App as active;
- App control-plane reads remain available to members;
- metadata, membership, invitation, issuer repair, audit, and restore mutations
  remain available;
- Playground is disabled because it requires a Space capability.

Suspension is reversible and does not delete data, revoke membership, remove
issuer configuration, release Root Refs, or trigger garbage collection. The
current implementation only rejects managed capability issuance and therefore
does not yet satisfy this contract.

### List and revoke App member invitations

Keep invitation creation and acceptance routes, and add:

```http
GET /admin/apps/{appId}/member-invitations
  ?status=pending|accepted|expired|revoked
  &limit=<1..1000>
  &cursor=<opaque>

DELETE /admin/apps/{appId}/member-invitations/{invitationId}
If-Match: "<revision>"
```

The list returns `AppMemberInvitation` records without bearer tokens or accept
URLs. Pagination is snapshot-bound. Expiry is projected consistently: an
unconsumed pending invitation whose `expiresAt <= now` is returned as
`expired`, with durable status reconciliation performed under the owning
service operation.

Delete means revoke, not physical deletion. Only pending unexpired invitations
can transition to revoked. Success returns `204` plus the invitation ETag,
including an already-revoked no-op with a current precondition. The UI reloads
the list to reconcile races. Accepted, expired, and revoked records remain
visible for recent-history and audit workflows according to retention policy.

These endpoints require current App membership and the existing
`control:security` delegated scope for MCP. Creating, accepting, expiring, and
revoking invitations emit App control audit events. The current protocol has
create/accept and invitation statuses, but no list/revoke routes.

### Replace an active custom OAuth issuer

Retain the existing discovery and ownership-proof model but allow replacement
without disabling the current issuer first:

```http
POST /admin/apps/{appId}/oauth-issuer/inspections
{ "issuer": "https://replacement.example" }

PUT /admin/apps/{appId}/oauth-issuer
If-Match: "<current-active-issuer-revision>"
{
  "inspectionId": "...",
  "activationProof": "<compact-jws>"
}
```

An inspection is an immutable candidate and never changes current authority.
Its creation receipt includes only the candidate ID, computed discovery URLs
for review, exact challenge payload, server-selected expiry, and eligible
signing-key choices `{ kid, algorithm }`. The caller signs the exact UTF-8
challenge bytes as compact JWS; it must not parse and reserialize the payload.
Captured public JWKs remain server-side. Request `issuer`, path `appId`, and
the mutable issuer's revision are not echoed. A fresh inspection request may
create a new candidate and challenge; it is not an idempotent authority write.

After validating unexpired discovery data, captured JWKS, signed challenge,
external issuer revision precondition, and global issuer uniqueness, PUT
atomically replaces the active external issuer and advances its revision. The
old issuer remains authoritative until that commit; after commit it stops
resolving within the bounded authority-cache window.

If no external issuer exists, the same PUT performs initial activation using
`If-None-Match: *`, not a fictional issuer or inspection revision. Exactly one
of `If-Match` and `If-None-Match` is required; an existence/precondition race
returns `412`. Successful activation or replacement returns `204` and the new
external issuer ETag. A failed or abandoned inspection leaves the current
issuer untouched. The UI
labels the operation `Change issuer`, displays candidate progress separately,
and never presents an unverified candidate as active.

The existing Console disables inspection while an issuer is active, and the
repository only activates a pending issuer row. Those constraints must be
changed before the refined workflow is implemented. Managed issuer
enable/disable remains the existing independent resource:

```http
PATCH /admin/apps/{appId}/managed-issuer
If-Match: "<revision>"

{ "enabled": true | false }
```

Managed issuer updates return `204` and the managed issuer ETag. Their revision
is independent of the App, external issuer, and candidate inspection.

## Platform audit

```http
GET /admin/platform/audit-events
  ?action=<exact-action>
  &actorPrincipalRef=<ref>
  &targetPrincipalRef=<ref>
  &createdAfter=<unix-epoch-milliseconds>
  &limit=<1..1000>
  &cursor=<opaque>
```

Requires `platform.admin` and returns snapshot-bound pages, ordered by
`createdAt` descending then `eventId` descending. `createdAfter` is an exclusive
time filter, never an event ID; subsequent pages use only the opaque cursor
with unchanged filters. `action` uses the same `PlatformAuditAction` enum as
event responses. Recommended actions:

```text
platform_invitation.created
platform_invitation.revoked
platform_invitation.accepted
platform_access.authority_changed
platform_access.blocked
platform_access.restored
platform_access.change_denied
app.create_denied
```

```ts
export interface PlatformAuditEvent {
  readonly eventId: string;
  readonly action: PlatformAuditAction;
  readonly actorPrincipalRef: string | null;
  readonly actorPrincipal: Principal;
  readonly targetPrincipalRef: string | null;
  readonly targetPrincipal: Principal | null;
  readonly targetInvitationId: string | null;
  readonly result: "succeeded" | "denied";
  readonly requestId: string | null;
  readonly createdAt: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}
```

Actor and target references use the same `principalRef` domain as Principal
routes and filters. References are `null` when no access-state record exists;
the immutable Principal is still retained. Denial audit must not create access
state just to allocate a reference. `requestId` is a non-empty opaque string or
`null`, never a session identifier.

`details` uses an action-specific allowlist. It must never contain invitation
tokens, session identifiers, OAuth credentials, raw headers, or arbitrary
request bodies. Invitation events may retain the normalized constrained email
only if the accepted privacy policy permits it; otherwise the UI resolves
current display metadata separately.

App-local membership and issuer actions remain in each App's existing control
audit. Platform authority, platform invitation, global block, and App creation
denial belong in platform audit.

## Error additions

Add these v2 administrator error codes:

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `PLATFORM_ACCESS_REQUIRED` | 403 | No current full admission, or access is blocked |
| `PLATFORM_ADMIN_REQUIRED` | 403 | Current Principal lacks `platform.admin` |
| `APP_CREATION_AUTHORITY_REQUIRED` | 403 | Current Principal lacks `apps.create` |
| `LAST_PLATFORM_ADMIN` | 409 | Mutation would remove or block the final active Platform Admin |
| `SELF_BLOCK_FORBIDDEN` | 409 | Platform Admin attempted to block its own Principal |
| `INVITATION_SESSION_REQUIRED` | 403 | Acceptance lacks the matching invitation-limited session |
| `INVITATION_NOT_PENDING` | 409 | Invitation is accepted, expired, or revoked |

Keep existing `ADMIN_AUTH_REQUIRED`, `NOT_FOUND`, `INVALID_REQUEST`,
`PRECONDITION_REQUIRED`, `REVISION_MISMATCH`, `IDEMPOTENCY_CONFLICT`,
`INVALID_CURSOR`, `RATE_LIMITED`, and `SERVICE_UNAVAILABLE` semantics.
Externally visible login failures should not distinguish unknown, blocked, and
formerly admitted Google accounts.

## Client, CLI, and MCP shape

Add thin `@unicas/admin-client` methods corresponding one-to-one with the HTTP
operations. The WebUI owns workflows such as opening a drawer, confirming a
block, and reconciling a stale revision.

Recommended CLI groups:

```text
unicas platform-access list|get|update
unicas platform-invitations list|create|revoke
unicas platform-audit list
```

Remote and stdio MCP may expose equivalent platform tools. MCP authorization is
conjunctive:

```text
valid OAuth grant
AND required control:* scope
AND current platform.admin authority
```

Do not encode platform authority into long-lived OAuth grants. Re-evaluate it
on every call so revocation uses the same bounded-staleness policy as the
Console.

No v1 Stack endpoint receives this surface. Existing v1 creation must also be
denied unless the Principal holds `apps.create`, or be removed from production
routing before migration completes; it must not remain a privilege bypass.

The existing v2 `{ error, message? }` envelope remains shared across all
operations; errors do not embed current resource objects. A `412` causes the
client to fetch the relevant read projection rather than obtain state from an
error payload. Ordinary authorization and rate-limit errors keep their
existing HTTP semantics.

## UI-to-API check

| Mock interaction | API support | Assessment |
| --- | --- | --- |
| Render primary App navigation | `GET /admin/apps` | Existing App list remains the canonical Sidebar source |
| Gate Create App and Platform entry | Extended `GET /admin/me` | Current authorities are sufficient; no navigation-only endpoint is needed |
| Switch App detail section | Client route state | No API change; selected App and section are URL-owned |
| Open profile actions | Existing client behavior | Documentation, MCP configuration, and logout need no new platform API |
| Summary counts | `GET /admin/platform/access-summary` | Separate aggregate avoids incorrect page-local counts |
| Search and filter Principals | `GET /admin/platform/principals` | Query, effectiveAccess, authority, snapshot cursor are sufficient |
| Open Principal drawer | `GET /admin/platform/principals/{principalRef}` | Includes authority revision and read-only App memberships |
| Save authority checkboxes | `PATCH .../{principalRef}/access` | Atomic replacement plus `If-Match` prevents lost updates |
| Block or restore access | Same PATCH endpoint | Status is independent from authority and memberships |
| Invite internal developer | `POST /admin/platform/invitations` | Requires email plus one or more authorities |
| Review or revoke invitations | GET collection and conditional DELETE | Invitation tokens never appear in list responses |
| Review platform audit | `GET /admin/platform/audit-events` | Supports the visible actor, target, result, and request ID columns |
| Hide App creation for members | Extended `/admin/me` | UI can render effective authority; server still enforces it |
| Copy App ID | Existing `App.appId` | No API change; copy feedback is client-only |
| Suspend or restore App | Extended conditional `PATCH /admin/apps/{appId}` | Separate task must enforce status across all data-plane authority paths |
| Manage managed issuer | Existing managed issuer GET/PATCH | Existing capability was missing only from the first mock |
| Change active custom issuer | Existing inspection/PUT shape with replacement semantics | Separate task keeps the current issuer active until atomic replacement |
| Review/revoke App invitations | New App invitation GET/DELETE | Separate task completes the existing create/accept lifecycle |

The mock does not require bulk authority changes, direct pre-login grants by
email, arbitrary roles, invitation resend, physical deletion of Principals, or
App membership mutation from the Platform workspace. Those should remain out
of the first API unless a concrete operator workflow requires them.

## Review record

Design review on 2026-09-15 addressed:

- Full-resource write echoes across all 12 proposed write operations; the
  minimal-response matrix now defines every success body and version owner.
- Inconsistent persisted/effective status names, untyped audit action/time
  filters, opaque identifiers, timestamp units, cursor nullability, and
  authority-set validation; these now share explicit schemas.
- Closed-schema inheritance rejecting valid Principal projections, and a
  composite detail ETag incorrectly implying that access revision covered
  Profile and membership changes.
- Ambiguous initial issuer activation preconditions, missing eligible signing
  key choices, and accidental removal of optional App email constraints.

Validation: all 49 proposal schemas compiled with the workspace's existing
AJV 2020 validator; 31 positive/negative fixtures covered Principal projections,
unknown fields, authority sets, email optionality, timestamps, cursors, ETags,
and invitation receipts. All 12 write response contracts and local schema
references passed focused assertions. `pnpm check:tasks` passed the ledger
check and all 6 policy tests. These validate the design artifacts, not runtime
authorization, HTTP handlers, or client behavior.

Next action: settle the remaining product/security decisions below, then
implement the prerequisite task contracts and migrate source protocols,
clients, and Console workflows together. This review does not claim or begin
the production implementation task.

## Decisions still open

1. Whether `platform.admin` should remain independent from `apps.create` as
   recommended, or imply it for operational simplicity.
2. Whether a global block should also prevent data-plane capabilities issued by
   an App's independent issuer. Recommendation: no; platform access controls
   the administrator plane, while data-plane revocation remains App-owned.
3. Exact bounded-staleness target for browser sessions and remote MCP authority
   checks. Recommendation: fail closed after at most 60 seconds, matching the
   existing authority-registry hard stale bound where practical.
4. Whether platform audit may retain normalized invitation email after expiry
   or revocation.
5. Whether platform endpoints should ship in remote MCP at first release or
   initially remain Console and CLI only.

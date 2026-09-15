# Platform access API design

Status: discussion draft

Updated: 2026-09-15

## Design target

Support the platform workflows in [ConsoleMock.html](./ConsoleMock.html) and
[UiDesign.md](./UiDesign.md) without treating Google authentication, OAuth
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
  readonly profile: Profile;
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
  readonly revision: number;
}
```

Requires `platform.admin`. Counts are current, not snapshot-bound to a Principal
list traversal.

### List Principals

```http
GET /admin/platform/principals
  ?query=<name-email-subject>
  &status=active|blocked|no_access
  &authority=platform.admin|apps.create|none
  &limit=<1..1000>
  &cursor=<opaque>
```

```ts
export interface PlatformPrincipalListItem extends PlatformAccessState {
  readonly effectiveAccess: "active" | "blocked" | "no_access";
  readonly appMembershipCount: number;
  readonly lastActiveAt: number | null;
}

export interface PlatformPrincipalPage {
  readonly items: readonly PlatformPrincipalListItem[];
  readonly nextCursor: string | null;
}
```

The list is a platform projection over access state and current membership
counts. Pagination uses the existing snapshot-bound opaque cursor convention.
Profile fields are searchable display metadata, not identity keys.

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
exact `revision` needed for mutation. Memberships are read-only in this
resource; App membership changes continue to use App routes.

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

The supplied fields replace their current values atomically. The response is
the updated `PlatformAccessState` with a new revision and strong ETag.

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

export interface CreatePlatformInvitationResponse {
  readonly invitation: PlatformInvitation;
  readonly acceptUrl: string;
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

Both require `platform.admin`. Delete means revoke and returns the updated
invitation with a new revision rather than physically deleting audit-relevant
state. Only a pending invitation can be revoked; repeating with the resulting
revision returns its current revoked representation.

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
3. replaces the Principal's platform authorities with the invitation's
   authorities only when no prior access state exists;
4. refuses to override a blocked existing Principal;
5. records a platform audit event;
6. upgrades the invitation-limited session to a full session.

If an existing active Principal accepts an invitation, merge the invited
authorities with current authorities rather than removing current authority.
This exception to step 3 must be explicit in the service operation and tested.

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

Use the same mechanism for platform and App invitations. This replaces the
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
membership. A Principal with App memberships but no `apps.create` receives:

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

- [App suspension boundary](/tasks/backlog/enforce-app-suspension-boundary/Task.md)
- [App member invitation management](/tasks/backlog/manage-app-member-invitations/Task.md)
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
control audit action `app.suspended` or `app.restored`.

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
can transition to revoked. The response returns the updated invitation and ETag
so the UI can reconcile races. Accepted, expired, and revoked records remain
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

An inspection is a candidate resource and never changes current authority.
After validating unexpired discovery data, captured JWKS, signed challenge, App
revision precondition, and global issuer uniqueness, PUT atomically replaces
the active external issuer and advances its revision. The old issuer remains
authoritative until that commit; after commit it stops resolving within the
bounded authority-cache window.

If no external issuer exists, the same PUT performs initial activation. A
failed or abandoned inspection leaves the current issuer untouched. The UI
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

## Platform audit

```http
GET /admin/platform/audit-events
  ?action=<exact-action>
  &actorPrincipalRef=<ref>
  &targetPrincipalRef=<ref>
  &after=<timestamp-or-event-id>
  &limit=<1..1000>
  &cursor=<opaque>
```

Requires `platform.admin` and returns snapshot-bound pages. Recommended actions:

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
  readonly action: string;
  readonly actor: Principal;
  readonly targetPrincipal: Principal | null;
  readonly targetInvitationId: string | null;
  readonly result: "succeeded" | "denied";
  readonly requestId: string | null;
  readonly createdAt: number;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}
```

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

## UI-to-API check

| Mock interaction | API support | Assessment |
| --- | --- | --- |
| Render primary App navigation | `GET /admin/apps` | Existing App list remains the canonical Sidebar source |
| Gate Create App and Platform entry | Extended `GET /admin/me` | Current authorities are sufficient; no navigation-only endpoint is needed |
| Switch App detail section | Client route state | No API change; selected App and section are URL-owned |
| Open profile actions | Existing client behavior | Documentation, MCP configuration, and logout need no new platform API |
| Summary counts | `GET /admin/platform/access-summary` | Separate aggregate avoids incorrect page-local counts |
| Search and filter Principals | `GET /admin/platform/principals` | Query, effective status, authority, snapshot cursor are sufficient |
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

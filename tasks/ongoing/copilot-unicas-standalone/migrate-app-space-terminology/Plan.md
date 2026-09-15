# UniCAS App and Space terminology plan

Status: in progress; Phase 0 complete and contract-first implementation started

Date: 2026-09-14

## Decision

Rename the two public isolation resources:

| Current term | Target term | Definition |
| --- | --- | --- |
| Stack | **App** | The top-level application, trust, administration, issuer, audit, and storage namespace |
| Tenant | **Space** | An App-scoped logical boundary for data ownership, isolation, authorization, and usage accounting |

Keep authentication and presentation as separate concepts:

| Term | Definition |
| --- | --- |
| **Principal** | The authenticated human or service identity, keyed by `(issuer, subject)` |
| **Profile** | Non-authoritative display metadata such as display name and email |
| **Member** | A Principal granted equal administrator authority over an App |

A Space does not imply a user, organization, billing account, physical shard,
deployment region, or storage device. Mapping a Space to one user, many users,
a service, or a shared business object belongs to the integrating App.

## Why Space

`Space` names a bounded logical area without prescribing who owns it. It supports
all of these application mappings without changing the UniCAS model:

```text
one Principal -> one personal Space
one Principal -> multiple Spaces
multiple Principals -> one shared Space
service Principal -> one automation Space
```

Use **Space** as a capitalized UniCAS resource name. Avoid using bare “space” for
storage capacity in product text. Say `capacity`, `stored bytes`, `reserved
bytes`, or `remaining quota` instead. This prevents confusion between a Space
resource and available disk space.

Rejected alternatives:

- `identity` conflates authentication with data ownership;
- `user` excludes services, groups, and shared ownership;
- `profile` is mutable presentation data, never an authorization boundary;
- `partition` suggests physical database sharding;
- `namespace` emphasizes naming but underplays authorization and accounting;
- `scope` conflicts with OAuth scopes and capability permissions;
- `realm`, `domain`, `zone`, `bucket`, and `container` collide with existing
  authentication, Root Ref, DNS, R2, or deployment concepts.

## Resource model

```text
App
├── App administrators (Principal memberships)
├── OAuth issuer configuration
├── control audit
└── Spaces
    ├── immutable CAS nodes
    ├── leases and upload reservations
    ├── Root Ref balances and events
    ├── usage accounting
    └── garbage collection

Principal = (issuer, subject)
Profile   = displayName/emailForDisplay
Capability grants one Principal operations on one Space in one App
```

Core invariants:

1. App is the highest trust and storage namespace.
2. Space is the ownership, isolation, authorization, usage, lease, Root Ref,
   and GC unit inside an App.
3. Every data-plane request carries both `appId` and `spaceId`.
4. An issuer resolves to exactly one App authority.
5. The issuer-derived App must match the route App.
6. The capability Space must match the route Space.
7. Permissions authorize an exact Space and operation.
8. `(issuer, subject)` is the immutable Principal key.
9. Profile changes never alter membership, ownership, or authorization.
10. One Principal may access many Spaces and one Space may be shared by many
    Principals when the App issues suitable capabilities.

## Target public contract

This is a new contract, not a textual alias over the old one. Prefer an
explicitly versioned route family on the new API origin:

```text
/v2/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/content
/v2/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/metadata
/v2/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/lease
/v2/apps/{appId}/spaces/{spaceId}/cas/usage
/v2/apps/{appId}/spaces/{spaceId}/cas/gc
/v2/apps/{appId}/spaces/{spaceId}/root-refs
```

Control-plane routes become:

```text
/admin/apps
/admin/apps/{appId}
/admin/apps/{appId}/members
/admin/apps/{appId}/member-invitations
/admin/apps/{appId}/oauth-issuer
/admin/apps/{appId}/managed-issuer
/admin/apps/{appId}/managed-capabilities
/admin/apps/{appId}/spaces/...          # only if Space catalog operations are added
```

The current Playground file-root catalog remains Principal-owned control data;
do not relabel a file root as a Space. A Playground capability grants the
Principal access to a generated personal Space.

### Types

Target exported vocabulary:

```ts
type AppId = string;
type SpaceId = string;

interface Principal {
  issuer: string;
  subject: string;
}

interface Profile {
  displayName: string | null;
  emailForDisplay: string | null;
}

interface App {
  appId: AppId;
  displayName: string;
  description: string;
  status: "active" | "suspended";
  revision: number;
}
```

Use names such as `AppMembership`, `AppOAuthIssuer`, `AppAuditEvent`, and
`SpaceUsage`. Do not expose `stackId` or `tenantId` in v2 JSON schemas.

### Capability vocabulary

Use an explicit capability version for Space claims:

```json
{
  "ver": 2,
  "spaceId": "space_...",
  "permissions": [
    "spaces:space_...:cas:read",
    "spaces:space_...:cas:write",
    "spaces:space_...:cas:manage"
  ]
}
```

The App remains bound through the registered issuer and audience. Do not trust
a caller-controlled `appId` claim in place of issuer resolution. The verifier
must independently establish:

```text
issuer -> App authority
authority.appId == route.appId
token.spaceId == route.spaceId
permission Space == route.spaceId
```

Never interpret a v1 `tenantId` as a v2 `spaceId` without an explicit,
version-checked adapter. V1 tokens must not authorize v2 routes and v2 tokens
must not authorize legacy routes.

### CLI, MCP, and WebUI

Target CLI vocabulary:

```text
unicas apps list|get|create|update
unicas members ... <appId>
unicas oauth-issuer ... <appId>
unicas audit ... <appId> [--space-id <spaceId>]
```

Target MCP tools include `list_apps`, `get_app`, `create_app`, and `update_app`.
Audit inputs use `appId` and `spaceId`. Do not silently change the response
schema of an existing v1 tool name.

The WebUI uses “My Apps”, “App ID”, “App administrators”, “App issuer”,
“Personal Space”, and “Space usage”. Browser routes become `#/apps/{appId}`.

## Compatibility stance

The previous environment at `unicas.shazhou.work` remains frozen on the
Stack/Tenant v1 contract. Its routes, claims, permission strings, issuer URLs,
audiences, data, and Cloudflare resources are not migrated or reinterpreted.

The new `unicas.work` environment currently contains only the dedicated
`Production Smoke` App under the old vocabulary. Before a clean App/Space
cutover, verify this remains true. If any real consumer or data appears, stop
and introduce side-by-side adapters instead of resetting the environment.

Because the new environment is smoke-only, the preferred end state is a clean
App/Space source model rather than retaining Stack/Tenant names indefinitely.
Perform the work in reviewed phases, not as one global search-and-replace.

Do not rename these unrelated compatibility contracts in this effort:

- canonical CAS bytes and hashes;
- `application/vnd.unidocs.cas-node.v1`;
- `unidocs-cap+jwt` unless capability token branding receives its own version;
- Root Ref semantics and `refDomain`;
- ETags, revisions, idempotency keys, cursors, and upload headers;
- legacy Cloudflare resources and `unicas.shazhou.work`.

## Implementation phases

### 0. Freeze and classify

- Confirm the new control database contains only `Production Smoke`.
- Inventory every route, JSON field, TypeScript export, claim, permission,
  database key, object key, CLI command, MCP tool, UI label, and document.
- Classify each occurrence as `v2 public`, `internal`, `physical storage`, or
  `legacy preserved`.
- Add a compatibility matrix before editing implementation code.

### 1. Define contract-first App/Space vocabulary

- Add App, Space, Principal, and Profile types and schemas.
- Add route and capability tests for `/v2/apps/.../spaces/...` and `ver: 2`.
- Add negative tests proving v1/v2 tokens and routes cannot cross-authorize.
- Generate separate v2 OpenAPI artifacts; do not overwrite the frozen v1
  documents until the cutover strategy is explicit.

### 2. Rename the cloud-neutral core

- Rename control-plane domain types and service operations from Stack to App.
- Rename data-plane scopes from Tenant to Space.
- Keep Principal and Profile separate in membership and audit models.
- Preserve single-writer, idempotency, Root Ref, lease, usage, and GC behavior.
- Use language-server symbol renames where possible; do not perform blind text
  replacement over compatibility strings.

### 3. Rebuild the new physical schema and keys

Since the new environment is smoke-only, prefer a clean schema after exporting
both D1 databases:

```text
cas_apps
cas_app_members
app_id
space_id
apps/{appId}/spaces/{spaceId}/nodes-v2/{hash}
```

Update Durable Object names and R2 keys together so the App/Space isolation and
single-writer boundaries remain identical to the old Stack/Tenant model.

If real data exists at this checkpoint, do not rebuild. Keep physical
`stack_id`/`tenant_id` names behind a v2 repository adapter and write a separate
online migration plan.

### 4. Update platform adapters and authorization

- Implement v2 route matching and trusted internal headers.
- Bind issuer records and managed issuer URLs to App.
- Mint and verify `spaceId` claims and `spaces:` permissions.
- Keep App authority issuer-derived rather than trusting token input.
- Update audit records to expose `appId`, `spaceId`, and Principal while
  retaining immutable actor evidence.
- Version browser cache keys so old Tenant entries cannot collide with Space
  entries.

### 5. Update clients and presentation surfaces

- Rename admin API/client methods and exported schemas.
- Decide package renames separately; likely candidates are
  `tenant-protocol -> space-protocol` and `tenant-client -> space-client`, but
  package names should follow the final access-plane boundary rather than lead
  the semantic migration.
- Update CLI commands, MCP catalogs, WebUI routes, labels, docs, examples, and
  generated assets together.
- Keep remote and stdio MCP catalogs structurally identical.

### 6. Combine with the planned domain cutover

Coordinate with the `split-public-domain-topology` task and follow the finalized
[UniCAS domain topology](../../../../docs/domain-topology.md):

```text
api.unicas.work      App/Space machine API and MCP/OAuth
console.unicas.work  App administrator console and CLI login
unicas.work          product website
docs.unicas.work     documentation
```

Split origins before DNS changes. Register new Google callbacks, export the new
databases, reset only the smoke environment, deploy v2, recreate `Production
Smoke`, and run the App/Space smoke suite. Never touch the legacy environment.

### 7. Remove transitional vocabulary

- Remove v1 aliases from the new environment after all new clients use v2.
- Delete stale Stack/Tenant UI text and exported v2 aliases.
- Keep explicitly labeled legacy documentation for `unicas.shazhou.work`.
- Run a final case-sensitive repository scan; active v2 source should contain
  Stack/Tenant only in compatibility adapters, frozen artifacts, and migration
  documents.

## Validation matrix

At minimum, test:

- App CRUD, membership, issuer configuration, ETags, and idempotency;
- Space-scoped lease, read, metadata, usage, GC, and Root Refs;
- cross-App and cross-Space denial for identical hashes and IDs;
- issuer-to-App uniqueness and fail-closed registry behavior;
- v1 token on v2 route and v2 token on v1 route both fail;
- Principal profile changes do not change membership or Space access;
- DO and R2 keys differ for every `(appId, spaceId)` pair;
- App/Space fields in OpenAPI, CLI JSON, MCP schemas, WebUI, and audit output;
- production smoke cleanup and rejection of legacy/docs origins;
- host isolation across apex, API, console, and docs origins;
- full build, typecheck, package tests, OpenAPI drift, Wrangler dry-run, and
  gitleaks.

## Acceptance criteria

- New public source and APIs consistently use App and Space.
- “Space” is never used to mean available capacity in product text.
- Principal and Profile are modeled separately from Space.
- No public v2 JSON field, route, CLI command, MCP input, or UI label exposes
  Stack/Tenant terminology.
- Every data-plane operation remains scoped by both App and Space.
- Legacy v1 remains operational and unchanged at `unicas.shazhou.work`.
- The new environment is reset only after backups and a verified smoke-only
  state.
- Domain topology and terminology cutovers pass their independent rollback
  gates before the apex becomes the product website.

## Rollback

Keep the legacy deployment and the last known-good new Worker version. If the
App/Space cutover fails, restore the prior new-environment Worker and resource
bindings, then diagnose offline. Do not reinterpret existing v1 records, issue
mixed-version capabilities, or roll the legacy environment forward as a
shortcut.
# Architecture review

Status: Approved by the requesting user on 2026-09-20 for primary commit
`6c831d7`.

## Decision requested

Approve removal of the managed issuer from every steady-state component and the
two-revision deployment sequence that preserves verification for already-issued
tokens without retaining managed issuance as a supported capability.

Approval permits structural and deployment-boundary changes after the business
model and interface proposals are also approved.

## Current responsibility flow

```text
App creation
  -> @unicas/service AccountService
  -> CloudflareManagedIssuer.provision()
  -> D1 cas_app_managed_issuers

Admin WebUI / admin-client / stdio MCP
  -> managed-issuer and managed-capability Admin routes
  -> AccountService
  -> CloudflareManagedIssuer.issueAccountSpace()
  -> deterministic member_<hash(App, Account)> Space capability

Data request
  -> AuthorityRepository unions external + managed issuer rows
  -> verifier special-cases in-process managed JWKS

Public discovery
  -> /managed-issuers/{appId}/metadata or jwks.json
  -> shared Worker signing key
```

This flow makes the management plane an authorization server and gives
administrator identity an implicit data-plane meaning.

## Target steady-state responsibilities

```text
admin-webui / admin-cli / stdio MCP
        -> admin-client -> admin-protocol
        -> App, membership, external issuer, audit administration only

external application
        -> owns end-user identity and Principal-to-Space mapping
        -> external OAuth issuer issues App/Space capabilities

service-cloudflare
        -> discovers and persists one external issuer per App
        -> resolves only active external issuer authority
        -> fetches external JWKS through the existing hardened adapter

service
        -> verifies App/Space capabilities and preserves all CAS semantics
```

No new package, deployment, service binding, storage service, or file-domain
model is introduced.

## Component changes

### `@unicas/admin-protocol`

- Remove managed issuer Admin routes, contracts, schemas, response type, and MCP
  tools.
- Remove the `"managed"` discriminator from `AppOAuthIssuer`; the remaining
  resource is the standard external issuer and no longer needs a mode field.
- Regenerate OpenAPI from the reduced contract and remove stale Playground
  description/tag text.

### `@unicas/admin-client`, CLI, and MCP

- Remove managed issuer reads/mutations and managed capability minting methods.
- Remove stdio MCP handlers and catalog entries.
- Retain external issuer inspect/prove/activate and all App/Space administration.

### `@unicas/admin-webui`

- Remove the managed issuer card, fetch, toggle state, focus plumbing, and
  wording that presents a managed fallback.
- Keep one external OAuth authorization-server card and its existing inspection,
  proof, activation, loading, and error behavior.
- Remove retired Playground CSS and skipped Playground tests.

### `@unicas/service`

- Remove managed issuer provisioner/signer ports, managed mint/get/patch service
  methods, managed owner-key derivation, and creation-time provision input.
- Keep external issuer discovery, activation, uniqueness, revision, App status,
  verifier, and capability semantics unchanged.

### `@unicas/service-cloudflare`

- Remove `CloudflareManagedIssuer`, managed Admin BFF dispatch, MCP wiring,
  repository persistence, public managed routes, managed authority union,
  in-process JWKS special case, environment variables, and caches.
- External JWKS continues through `CloudflareOAuthDiscoveryPort`; `data:` URLs
  remain test-only behavior already supported by the verifier composition.
- Remove managed table/index bootstrap declarations. Do not execute a production
  `DROP` from Worker startup.

### Deployment and local runtime

- Remove managed key variables from Wrangler, local compose/runtime forwarding,
  reset smoke expectations, and current deployment documentation in the final
  revision.
- Preserve the frozen `unicas.shazhou.work` environment and never deploy to it.
- Do not deploy production, remove a secret, mutate production D1, or run GC as
  part of repository validation.

## Staged cutover

The task will preserve two immutable code revisions in Git:

### Revision A: issuance freeze

- Stop App creation from provisioning managed issuer rows.
- Remove or reject all Admin API/BFF/MCP paths that can mint, enable, or mutate a
  managed issuer.
- Retain only the legacy D1 read, authority resolution, public metadata/JWKS, and
  signing public-key material needed to verify already-issued tokens.
- Keep the private key binding temporarily because the current implementation
  derives the public JWK from it; the revision performs no signing.

This revision is the required first production deployment. Operators record its
successful deployment time as the issuance cutoff.

### Revision B: final removal

After at least 3,660 seconds and explicit approval:

- Remove the remaining managed routes, authority lookup, JWKS special case,
  implementation, schema bootstrap entries, and runtime key configuration.
- Deploying this revision makes legacy managed URLs return `404` and prevents
  managed rows from participating in authorization even if rows still exist.
- Production D1 table/index deletion and key revocation/deletion remain separate
  manual operations after the final deployment is healthy.

The final source tree is Revision B. The operations guide identifies Revision A
by immutable commit rather than asking an operator to reconstruct a partial
configuration.

## Compatibility and rollback

- Removed Admin and public routes return the normal unmatched-route `404`; no
  success-shaped compatibility responses or redirects are added.
- Removed MCP tools disappear from tool discovery.
- External issuer API and discovery continue at their existing paths.
- A Revision B rollback targets Revision A, restoring verification-only support
  without restoring issuance. Destructive row/key cleanup must not occur until
  the rollback window is explicitly closed.
- Existing capabilities from external issuers, Apps, Spaces, CAS nodes, Root
  Refs, content, and GC behavior are unchanged.

## Rejected alternatives

- **Delete everything in one deployment:** invalidates live managed tokens before
  their TTL/cache boundary.
- **Keep a permanent legacy verifier branch:** contradicts complete retirement
  and leaves signing-key/runtime complexity indefinitely.
- **Feature-flag the final code indefinitely:** retains an unsupported hidden
  product mode and expands configuration surface.
- **Implement a replacement file service now:** explicitly belongs to phase two.

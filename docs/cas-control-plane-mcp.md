# CAS Control-Plane MCP

The `@unicas/service-cloudflare` Worker exposes the UniCAS control plane to
GitHub Copilot and other remote MCP clients at:

```text
https://api.unicas.work/mcp
```

The unified Worker accepts an exact allowlist of `/mcp`, OAuth discovery,
authorization, token, and registration paths. It does not expose an arbitrary
`/oauth/*` prefix. A present browser
`Origin` on `/mcp` must exactly match the configured `MCP_PUBLIC_ORIGIN`; requests
without `Origin` remain valid for non-browser MCP clients.

## GitHub Copilot configuration

No API key or OAuth client secret belongs in MCP configuration:

```json
{
  "servers": {
    "unicas-control-plane": {
      "type": "http",
      "url": "https://api.unicas.work/mcp"
    }
  }
}
```

On first use, the client discovers UniCAS OAuth, offers the configured Google,
personal Microsoft, and GitHub methods, and shows the UniCAS consent page.
The resulting access and refresh tokens are UniCAS tokens. Provider tokens are
discarded after identity verification and are never accepted by `/mcp`.

## Authorization scopes

| Scope | Operations |
| --- | --- |
| `control:read` | Account/Profile, Apps, membership, App issuers, observed refDomains, and App/Space audit reads |
| `control:write` | App creation and metadata updates |
| `control:security` | App member invitation/removal, issuer lifecycle, and managed Space capability issuance |

Scopes do not imply each other. Current App membership is checked during each
tool call, so removing a member takes effect without waiting for token expiry.
Current Platform Access is checked before OAuth grant issuance and on every MCP
request. Platform tools additionally require `platform.admin`; `create_app`
requires `apps.create`. Existing access and refresh grants cannot preserve
revoked authority. Email allowlisting is not an MCP authorization source.

Access tokens expire after 15 minutes. Refresh grants expire after 8 hours and
refresh tokens rotate. Tokens are audience-bound to the canonical `/mcp`
resource. The token endpoint also implements RFC 7009 revocation.
Production validation allows up to 30 seconds for OAuth KV grant-deletion
propagation, after which a revoked grant must reject its existing access token.
Account block and credential-version checks remain request-time controls and
deny independently of that KV cleanup.

New grants bind `accountId`, `externalIdentityId`, the exact authenticated
issuer/subject, provider, and `credentialVersion`. The Account and current
admission are checked at callback, consent, token exchange/refresh, and every
MCP request. A credential-version change is never silently adopted by an old
grant. Grants without a complete Account binding are rejected and require fresh
login; no legacy identity mapping or credential upgrade is performed.

The shared administrator endpoint `GET /admin/me` returns only `account`,
`authenticatedIdentity` (masked login summary), and Account-keyed `memberships`.
The typed client exposes it as `getCurrentAdministrator`. Legacy
Principal/Profile and `platformAccess` response fields are not accepted.

Production authorization and consent transactions use encrypted records in
control D1 and atomic deletion on use, with a ten-minute expiry. Outstanding
pre-cutover KV login transactions must restart; durable OAuth client and grant
records remain in KV.

## Tools

The remote and stdio servers import one shared App tool catalog from
`@unicas/admin-protocol`; names, descriptions, schemas, annotations, and scope
requirements are therefore identical.

App read tools:

- `get_current_account`
- `list_apps`, `get_app`, `list_app_members`
- `get_app_oauth_issuer`, `get_app_managed_issuer`
- `list_app_ref_domains`, `list_app_control_audit_events`
- `list_space_root_domain_refs`, `list_space_root_domain_events`

App write tools:

- `create_app`, `update_app`

`update_app` accepts optional `status: "active" | "suspended"` alongside
metadata, requires the current App ETag and `control:write`, and returns only
`{ etag }`. Both MCP transports use this same shape. The tool is marked
potentially destructive because suspension interrupts all Space traffic;
server-side App membership and exact revision checks remain mandatory.

App security tools:

- `list_app_member_invitations`, `revoke_app_member_invitation`
- `invite_app_member`, `accept_app_member_invitation`, `remove_app_member`
- `inspect_app_oauth_issuer`, `activate_app_oauth_issuer`
- `update_app_managed_issuer`, `mint_managed_space_capability`

Platform tools (`control:security` plus current `platform.admin`):

- `list_platform_accounts`, `get_platform_account`
- `grant_platform_authority`, `revoke_platform_authority`
- `block_platform_account`, `restore_platform_account`
- `list_platform_invitations`, `create_platform_invitation`, `revoke_platform_invitation`
- `list_platform_audit_events`

App-scoped tools use `appId` and, where applicable, `spaceId`. Membership and
audit filters use Account IDs. Exact issuer/subject is privileged audit detail,
not an ordinary membership field or selector. Physical Stack/Tenant
dimensions are translated only inside the platform adapter and never appear in
v2 MCP input or output.

Invitation listing requires `control:security` and returns non-secret history
with status filtering and snapshot cursors. Revocation requires the invitation
ETag and exact `confirmInvitationId`; success returns only `{ etag }`. Creation
returns `{ invitationId, acceptUrl, expiresAt, etag }`, and acceptance returns
only `{ appId }`. App membership is checked by the server independently of scopes.

The shared catalog is the authoritative tool inventory. Clients must use the
current Account/App tools; no compatibility aliases are provided.

An App's signing authority is exclusively a discovered OAuth issuer:
the App inspection tool creates an independent candidate and does not disable
current authority. `activate_app_oauth_issuer` uses `ifNoneMatch: "*"` for first
activation or the current issuer `etag` for replacement, never both. A
replacement swaps authority atomically and returns only `{ etag }`. Inspection
returns only candidate proof inputs and discovery review URLs; no mutable
issuer revision or captured public JWKs are echoed.

`inspect_app_oauth_issuer` validates and persists the issuer's metadata and JWKS
snapshot and returns a control challenge, which the operator signs with a key
the issuer currently advertises and submits as a compact-JWS activation proof
to `activate_app_oauth_issuer`. There is no manual issuer or JWK upload path, and
private key material is never a valid MCP input.

Creation tools require an idempotency key. App and invitation revision-sensitive
mutations require a current ETag. Account authority, block/restore, and member
removal commands use Account IDs and exact target confirmation without ETags.
Member invitations are email-bound and require the email twice.
Destructive annotations are advisory metadata; the server always
enforces scopes, membership, ETags, confirmations, and service invariants.

`list_app_ref_domains` is an audit discovery tool. It lists domains observed in
successful Root Ref writes; domains are not pre-registered or lifecycle-managed
through MCP. A ref domain is an event field used to filter and aggregate Root
Ref audit data, not a separately managed App resource.

## Worker configuration

Required bindings:

```text
CAS_CONTROL_DB             shared UniCAS control D1
OAUTH_KV                   dedicated OAuth clients/grants/token hashes
```

Required secrets:

```text
OAUTH_GOOGLE_CLIENT_SECRET
OAUTH_STATE_ENCRYPTION_KEY   base64url-encoded 32-byte AES key
SESSION_ENCRYPTION_KEYS      versioned JSON keyring for sessions and sealed invitation replay
CAS_AUDIT_READER_KEY        shared key for the private audit-reader RPC
```

Variables (non-secret; `OAUTH_GOOGLE_CLIENT_ID` is a var, not a secret):

```text
MCP_PUBLIC_ORIGIN=https://api.unicas.work
MCP_MUTATIONS_ENABLED=true
MCP_ALLOWED_ORIGIN_HOSTNAMES=
OIDC_ISSUER=...                 optional, defaults to Google
OIDC_DISCOVERY_URL=...          optional test/local override
OAUTH_MICROSOFT_CLIENT_ID=...   optional personal-account provider
OAUTH_GITHUB_CLIENT_ID=...      optional GitHub provider
```

Enable optional providers with their matching `OAUTH_MICROSOFT_CLIENT_SECRET`
and `OAUTH_GITHUB_CLIENT_SECRET` Worker secrets. Register the fixed MCP callback
URLs `/oauth/google/callback`, `/oauth/microsoft/callback`, and
`/oauth/github/callback` on `MCP_PUBLIC_ORIGIN`, alongside the corresponding
Console callbacks. Keep the same Microsoft application ID across both surfaces
because Microsoft `sub` is pairwise. Configure exact GitHub callback URLs and
disable unnecessary wildcard matching. Microsoft invitation email verification
remains the Console/BFF flow; MCP login does not bypass that gate.

`MCP_MUTATIONS_ENABLED` is the emergency and rollout kill switch. An absent or
non-`true` value fails closed; read tools remain available while all
write/security handlers reject mutations. Production enables it explicitly
after read-only telemetry and cross-App
isolation checks pass.

Configure the `OAUTH_KV` ID in
`packages/service-cloudflare/wrangler.toml` before deployment. OAuth KV is
not a control-data backup: business state remains in `CAS_CONTROL_DB`. KV stores
client registrations, grants, and token hashes; deleting a client or revoking a
grant invalidates its tokens.

## Build and validation

```text
pnpm --filter @unicas/control-auth test
pnpm --filter @unicas/service test
pnpm --filter @unicas/service-cloudflare typecheck
pnpm --filter @unicas/service-cloudflare test
pnpm --filter @unicas/service-cloudflare build
pnpm --filter @unicas/service-cloudflare exec wrangler deploy --dry-run
pnpm --filter @unicas/admin-webui test
node stacks/unicas/deploy/mcp-oauth-smoke.mjs --provider google
node stacks/unicas/deploy/mcp-oauth-smoke.mjs --provider microsoft
node stacks/unicas/deploy/mcp-oauth-smoke.mjs --provider github
```

The release gate additionally requires a real GitHub Copilot flow through the
custom domain: discovery, provider login, consent, `get_current_account`, a paginated App read,
refresh, revoke, and reauthorization. A manually injected bearer token does not
replace that test.

The interactive production smoke prints a loopback OAuth authorization URL and
never logs access or refresh tokens. Complete Google account selection and the
UniCAS consent page in a browser while its callback listener is running.
Use `--expect-account-block` with one provider when validating revocation: the
smoke pauses after authenticated Account/App reads, then verifies the existing
MCP access token is denied within 30 seconds after an operator blocks the
Account and presses Enter.

## Rollout and incident response

1. Create the dedicated production OAuth KV namespace and replace its binding ID.
2. Register `https://console.unicas.work/admin/auth/callback/{provider}` and
  `https://api.unicas.work/oauth/callback/{provider}` for each configured
  provider before enabling split-origin administrator or MCP login.
3. Set Worker secrets and deploy `@unicas/service-cloudflare` with mutations disabled.
4. Validate OAuth discovery and read tools from GitHub Copilot.
5. Observe authorization failures, scope/member denials, D1/KV errors, and audit
   attribution before enabling mutations.
6. Enable ordinary and security operations in a controlled maintenance window.

For suspected token theft, keep mutations disabled, revoke the affected grant or
delete the OAuth client, and review `cas_control_audit_events` by client handle
and tool name. Rotate Google credentials or the state-encryption key only through
Worker secret management. Rotating the state key invalidates in-flight login and
consent transactions but does not decrypt or expose existing OAuth tokens.

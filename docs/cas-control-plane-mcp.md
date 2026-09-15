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

On first use, the client discovers UniCAS OAuth, opens Google sign-in, and shows
the UniCAS consent page. The resulting access and refresh tokens are UniCAS
tokens. Google tokens are discarded after identity verification and are never
accepted by `/mcp`.

## Authorization scopes

| Scope | Operations |
| --- | --- |
| `control:read` | Principal/Profile, Apps, membership, App issuers, Playground roots, observed refDomains, and App/Space audit reads |
| `control:write` | App creation/metadata and Principal-owned Playground root mutations |
| `control:security` | App member invitation/removal, issuer lifecycle, and managed Space capability issuance |

Scopes do not imply each other. Current App membership is checked during each
tool call, so removing a member takes effect without waiting for token expiry.
`ADMIN_EMAIL_ALLOWLIST`, when configured, is also checked during every MCP call.

Access tokens expire after 15 minutes. Refresh grants expire after 8 hours and
refresh tokens rotate. Tokens are audience-bound to the canonical `/mcp`
resource. The token endpoint also implements RFC 7009 revocation.

## Tools

The remote and stdio servers import one shared App tool catalog from
`@unicas/admin-protocol`; names, descriptions, schemas, annotations, and scope
requirements are therefore identical.

App read tools:

- `get_current_principal`
- `list_apps`, `get_app`, `list_app_members`
- `get_app_oauth_issuer`, `get_app_managed_issuer`
- `list_app_playground_file_roots`
- `list_app_ref_domains`, `list_app_control_audit_events`
- `list_space_root_domain_refs`, `list_space_root_domain_events`

App write tools:

- `create_app`, `update_app`
- `create_app_playground_file_root`
- `update_app_playground_file_root`
- `delete_app_playground_file_root`

`update_app` accepts optional `status: "active" | "suspended"` alongside
metadata, requires the current App ETag and `control:write`, and returns only
`{ etag }`. Both MCP transports use this same shape. The tool is marked
potentially destructive because suspension interrupts all Space traffic;
server-side App membership and exact revision checks remain mandatory.

App security tools:

- `invite_app_member`, `accept_app_member_invitation`, `remove_app_member`
- `inspect_app_oauth_issuer`, `activate_app_oauth_issuer`
- `update_app_managed_issuer`, `mint_managed_space_capability`

App-scoped tools use `appId` and, where applicable, `spaceId`. Membership and
audit operations use Principal `issuer`/`subject` fields. Physical Stack/Tenant
dimensions are translated only inside the platform adapter and never appear in
v2 MCP input or output.

The catalog contains 23 App tools and 15 v1 tools. The v1 tools, including `whoami`, `list_stacks`, and
`list_root_domain_refs`, remain structurally unchanged for explicit compatibility.
They are not aliases for the App tools.

An App's signing authority is exclusively a discovered OAuth issuer:
`inspect_app_oauth_issuer` validates and persists the issuer's metadata and JWKS
snapshot and returns a control challenge, which the operator signs with a key
the issuer currently advertises and submits as a compact-JWS activation proof
to `activate_app_oauth_issuer`. There is no manual issuer or JWK upload path, and
private key material is never a valid MCP input.

Creation tools require an idempotency key. Existing-resource mutations require a
current ETag. Member invitations are email-bound and require the email twice.
Member removal requires explicit target confirmation.
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
GOOGLE_OIDC_CLIENT_SECRET
OAUTH_STATE_ENCRYPTION_KEY   base64url-encoded 32-byte AES key
ADMIN_EMAIL_ALLOWLIST        comma-separated emails allowed to log in
CAS_AUDIT_READER_KEY        shared key for the private audit-reader RPC
```

Variables (non-secret; `GOOGLE_OIDC_CLIENT_ID` is a var, not a secret):

```text
MCP_PUBLIC_ORIGIN=https://api.unicas.work
MCP_MUTATIONS_ENABLED=true
MCP_ALLOWED_ORIGIN_HOSTNAMES=
OIDC_ISSUER=...                 optional, defaults to Google
OIDC_DISCOVERY_URL=...          optional test/local override
```

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
node stacks/unicas/deploy/mcp-oauth-smoke.mjs
```

The release gate additionally requires a real GitHub Copilot flow through the
custom domain: discovery, Google login, consent, `get_current_principal`, a paginated App read,
refresh, revoke, and reauthorization. A manually injected bearer token does not
replace that test.

The interactive production smoke prints a loopback OAuth authorization URL and
never logs access or refresh tokens. Complete Google account selection and the
UniCAS consent page in a browser while its callback listener is running.

## Rollout and incident response

1. Create the dedicated production OAuth KV namespace and replace its binding ID.
2. Register `https://console.unicas.work/admin/auth/callback` and
  `https://api.unicas.work/oauth/google/callback` with Google before enabling
  split-origin administrator or MCP login. Keep the existing apex callbacks
  during the migration window.
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

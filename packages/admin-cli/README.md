# @unicas/admin-cli

UniCAS control-plane management CLI. Logs in through the control-plane BFF:
the browser opens the BFF's `/admin/auth/cli/authorize`, the BFF runs the
Google OIDC flow (client secret held server-side) and verifies current
Platform Access, then redirects the browser back to the CLI's loopback with a one-time code
that the CLI exchanges (PKCE) for a session cookie + CSRF token, persisted
locally. The CLI never talks to Google and needs no client id or secret.
Commands call the typed `@unicas/admin-client` over the `/admin` HTTP API;
`unicas mcp` exposes the same 47-tool contract (32 App/platform tools plus 15 frozen v1
tools) as the MCP ingress hosted by
`@unicas/service-cloudflare` as a stdio MCP server backed by that client (for
clients whose MCP support cannot do OAuth, for example DeepSeek Harness).

```text
https://console.unicas.work/admin  <- /admin control-plane API (BFF session)
        ^
        | session cookie + CSRF (via @unicas/admin-client)
unicas CLI  <- /admin/auth/cli/authorize (BFF does Google OIDC) -> cli/exchange
        |     persists ~/.unicas/session.json
        |
        +-- plain commands:   unicas principal / unicas apps list ...
        `-- stdio MCP server: unicas mcp   (DSH: command "unicas", args ["mcp"])
```

## Requirements

- Node.js >= 24
- pnpm (workspace package; build with `tsc`)

## Build

```powershell
pnpm install
pnpm --filter @unicas/admin-cli build
```

This produces `dist/cli.js` (the `unicas` bin target).

## Log in

```powershell
pnpm --filter @unicas/admin-cli unicas login
```

`login` authorizes through the control-plane BFF:

1. Starts a local `127.0.0.1` callback server and opens the browser at
   `${UNICAS_ADMIN_URL}/admin/auth/cli/authorize` (fixed public client id
   `unicas-cli`, S256 PKCE, loopback redirect).
2. The BFF redirects to Google (its own confidential client + secret,
   server-side), the operator signs in and consents, and the BFF verifies
   current Platform Access by immutable Principal. The email allowlist is only
   a pre-migration fallback when Platform Access is not configured.
3. The BFF redirects the browser back to the CLI's loopback with a one-time
   code; the CLI validates `state`, then POSTs `{ code, codeVerifier }` to
   `/admin/auth/cli/exchange` and receives the session cookie + CSRF token.
4. Persists the session to `~/.unicas/session.json` (created `0600`, atomic
   writes).

## Commands

| Command | MCP tool |
| --- | --- |
| `unicas account` | `get_current_account` |
| `unicas principal` (deprecated compatibility alias) | `get_current_principal` |
| `unicas apps list [--limit N] [--cursor C]` | `list_apps` |
| `unicas apps get <appId>` | `get_app` |
| `unicas apps create <displayName> [--idempotency-key K]` | `create_app` |
| `unicas apps update <appId> [displayName] [--description D] [--etag E]` | `update_app` |
| `unicas app-members list <appId> [--limit N] [--cursor C]` | `list_app_members` |
| `unicas app-members invite <appId> <email> [--idempotency-key K]` | `invite_app_member` |
| `unicas app-members remove <appId> <accountId> --confirm-account-id <accountId>` | `remove_app_member` |
| `unicas app-oauth-issuer get <appId>` | `get_app_oauth_issuer` |
| `unicas app-oauth-issuer inspect <appId> <issuer>` | `inspect_app_oauth_issuer` |
| `unicas app-oauth-issuer activate <appId> <inspectionId> --activation-proof <jws> [--etag E]` | `activate_app_oauth_issuer` |
| `unicas app-ref-domains list <appId>` | `list_app_ref_domains` |
| `unicas app-audit control <appId> [--limit N] [--cursor C] [--after ID]` | `list_app_control_audit_events` |
| `unicas app-audit root-domain-refs <appId> <refDomain> [--space-id S] [--limit N] [--cursor C]` | `list_space_root_domain_refs` |
| `unicas app-audit root-domain-events <appId> <refDomain> [--space-id S] [--after N] [--limit N]` | `list_space_root_domain_events` |
| `unicas platform-access list [--query Q] [--effective-access active\|blocked\|no_access] [--authority platform.admin\|apps.create\|none] [--limit N] [--cursor C]` | `list_platform_accounts` |
| `unicas platform-access get <accountId>` | `get_platform_account` |
| `unicas platform-access grant\|revoke <accountId> <authority> --confirm-account-id <accountId>` | `grant_platform_authority` / `revoke_platform_authority` |
| `unicas platform-access block\|restore <accountId> --confirm-account-id <accountId>` | `block_platform_account` / `restore_platform_account` |
| `unicas platform-invitations list [--query Q] [--status S] [--limit N] [--cursor C]` | `list_platform_invitations` |
| `unicas platform-invitations create <email> --authority A [--authority A] [--idempotency-key K]` | `create_platform_invitation` |
| `unicas platform-invitations revoke <invitationId> --etag E --confirm-invitation-id <invitationId>` | `revoke_platform_invitation` |
| `unicas platform-audit [--action A] [--actor-principal-ref R] [--target-principal-ref R] [--created-after MS] [--limit N] [--cursor C]` | `list_platform_audit_events` |
| `unicas logout` | RFC 7009 revocation + clears the session |
| `unicas status` | Local session summary (no network) |
| `unicas mcp` | Run as a stdio MCP server |

MCP additionally exposes App invitation acceptance, managed issuer/capability,
and Principal-owned Playground root operations. `whoami`, `stacks`, `members`,
`oauth-issuer`, `ref-domains`, and `audit` retain their v1 Stack/Tenant schemas
as explicitly labeled compatibility commands.

Plain commands print the tool's `structuredContent` as JSON on stdout;
diagnostics go to stderr.

## Guardrails

- **ETags.** App update, member removal, issuer activation, and MCP Playground mutations
  need the current ETag. When `--etag` is omitted the CLI reads it first
  (`get_app` / `get_app_oauth_issuer`).
- **Platform authority.** Every platform command requires current
  `platform.admin`; `apps create` separately requires current `apps.create`.
  A valid session or MCP scope alone is insufficient.
- **Confirmations.** Destructive operations require their `--confirm-*` flag
  to exactly match the target. Without the flag and a TTY, the CLI prompts;
  without the flag and no TTY (scripts), the command fails.
- **Idempotency.** `create_app` and `invite_app_member` auto-generate a stable
  `unicas-cli:<uuid>` idempotency key when `--idempotency-key` is omitted.
- **Never secrets on the wire to the CLI.** `activate_app_oauth_issuer` accepts
  only a compact-JWS activation proof signed off-CLI with a private key the
  discovered issuer advertises; private key material is never a CLI input, and
  no JWK upload path exists.

## stdio MCP server (`unicas mcp`)

Spawns a stdio MCP server that advertises the exact same tool contract as the
remote control plane and forwards each `tools/call` over the authenticated
Streamable HTTP connection. Only MCP protocol frames go to stdout.

```json
{
  "mcpServers": {
    "unicas-control-plane": {
      "command": "unicas",
      "args": ["mcp"]
    }
  }
}
```

To expose the `unicas` command on PATH from this checkout:

```powershell
pnpm --filter @unicas/admin-cli build
# pnpm 10+ removed `pnpm link --global`; install the local package globally instead:
pnpm install --global ./packages/admin-cli
# or point the MCP client directly at the built script:
#   node <checkout>\packages\admin-cli\dist\cli.js mcp
```

Alternatively run any command in-process:
`pnpm --filter @unicas/admin-cli unicas apps list`.

> Windows note: pnpm's global bin is a `.CMD` shim. A Node-based MCP client
> spawning `unicas mcp` must either use `shell: true`, point at the shim path
> (`%LOCALAPPDATA%\pnpm\bin\unicas.CMD`), or use
> `command: "node"` with `args: ["<checkout>/packages/admin-cli/dist/cli.js",
> "mcp"]` — a plain `spawn("unicas", …)` fails with `ENOENT`/`EINVAL` because
> Node does not resolve `.CMD` files.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `UNICAS_ADMIN_URL` | `https://console.unicas.work` | `/admin` API origin |
| `UNICAS_CONFIG_DIR` | `~/.unicas` | Directory holding `session.json` |

## Network / proxy

The CLI itself never calls Google: only the control-plane BFF talks to
`accounts.google.com`. `unicas login` only reaches the BFF origin
(`UNICAS_ADMIN_URL`), so no proxy configuration is needed on the CLI side
beyond whatever your network requires to reach the control plane.

## Security notes

- The session cookie is stored locally with `0600` permissions; the directory
  is created on demand.
- No long-lived bearer tokens are stored: the CLI holds only the BFF session
  cookie (server-side session, TTL enforced by the BFF) plus the CSRF token.
- `unicas logout` ends the BFF session server-side (`POST /admin/auth/logout`)
  and always clears the local session.
- The one-time authorization code is exchanged once and never persisted; the
  session fails closed with a re-login prompt when the BFF rejects the cookie.

## Tests

```powershell
pnpm --filter @unicas/admin-cli test
pnpm --filter @unicas/admin-cli typecheck
```

Tests run against an in-memory fake of the `/admin` BFF API — no network, no
real OAuth. A live `unicas login` + `unicas principal` against production is a
manual verification step because it requires a real browser Google sign-in.

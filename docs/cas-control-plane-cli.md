# UniCAS Control-Plane CLI

`@unicas/admin-cli` (bin `unicas`) is the operator-facing command line for UniCAS
control plane. It exists because DeepSeek Harness's MCP client only supports
static headers and therefore cannot complete the OAuth authorization-code flow
that protects `https://api.unicas.work/mcp`. The CLI authenticates through
the control-plane BFF instead: it opens the BFF's `/admin/auth/cli/authorize`,
the BFF runs the selected Google, personal Microsoft, or GitHub flow (client
secrets held server-side) and verifies current Account admission, then redirects the browser back to the CLI's loopback with a one-time
code that the CLI exchanges (PKCE) for a BFF session cookie + CSRF token,
persisted to `~/.unicas/session.json` (0600). The CLI never talks to Google and
needs no client id or secret of its own. Every command calls the typed
`@unicas/admin-client` over the `/admin` HTTP API with that session; `unicas mcp`
is a local stdio MCP server backed by the same HTTP client (no MCP-to-MCP
forwarding).

See `packages/admin-cli/README.md` for the full command reference.

## Quick start

```powershell
pnpm --filter @unicas/admin-cli build
pnpm --filter @unicas/admin-cli unicas login        # browser: choose a configured provider via the BFF
pnpm --filter @unicas/admin-cli unicas account
pnpm --filter @unicas/admin-cli unicas apps list
pnpm --filter @unicas/admin-cli unicas apps create "Operations" --idempotency-key create-ops-1
pnpm --filter @unicas/admin-cli unicas logout       # ends the BFF session (POST /admin/auth/logout)
```

## DSH integration (stdio MCP)

Configure DeepSeek Harness's mcp-client with a stdio server:

```json
{
  "transport": "stdio",
  "serverName": "unicas",
  "command": "unicas",
  "args": ["mcp"]
}
```

`unicas mcp` advertises the identical tool contract as the remote control
plane and forwards calls over the authenticated connection, so DSH can read and
operate the control plane without any OAuth implementation of its own. To put
`unicas` on PATH from the checkout, run `pnpm --filter @unicas/admin-cli build` and
then `pnpm install --global ./packages/admin-cli` (pnpm 10+ removed
`pnpm link --global`), or configure the client with `command: "node"` and
`args: ["<checkout>/packages/admin-cli/dist/cli.js", "mcp"]`.

On Windows the global bin is a `.CMD` shim; a Node-based MCP client must spawn
it with `shell: true`, reference the shim path directly, or use the `node` +
`dist/cli.js` form above (a plain `spawn("unicas")` fails with `ENOENT`).

Alternatively, skip MCP entirely and have DSH run plain shell commands
(`unicas apps list`, `unicas account`, ...); the CLI prints JSON on stdout.

## App command surface

| Group | Commands |
| --- | --- |
| Read (`control:read`) | `account`, `apps list/get`, `app-members list`, `app-oauth-issuer get`, `app-ref-domains list`, `app-audit control/root-domain-refs/root-domain-events` |
| Write (`control:write`) | `apps create` (idempotency key), `apps update` (ETag) |
| Security (`control:security`) | `app-members invite/remove/invitations/revoke-invitation`, `app-oauth-issuer inspect/activate` |

Platform operations are available as:

```text
unicas platform-access list|get|grant|revoke|block|restore
unicas platform-invitations list|create|revoke
unicas platform-audit
```

These require current `platform.admin` authority in addition to the
authenticated session. `apps create` requires independent `apps.create`
authority. An App member without that authority can list and administer only
their Apps and is denied App creation by the server.

Commands use `appId`, stable Account IDs, and `--space-id`. They never return
`stackId`, `tenantId`, or flattened identity/profile fields. Exact provider
issuer/subject values appear only in privileged audit evidence.

`apps update <appId> --status active|suspended [--etag E]` restores or suspends
the App. Status may be combined with display metadata changes. The command
returns only `{ etag }`; use `apps get` for refreshed App data. A current
same-value update succeeds without advancing revision, while stale ETags fail.
Suspension requires current App membership and stops all Space traffic within
the bounded authority-cache window; App recovery operations remain available.

Invitation history uses `app-members invitations <appId> [--status S]
[--limit N] [--cursor C]`. Revoke with `app-members revoke-invitation <appId>
<invitationId> --etag E --confirm-invitation-id <invitationId>`, using the
invitation's revision from the list. The result is only `{ etag }`. Creating
an App invitation returns `invitationId`, `acceptUrl`, `expiresAt`, and `etag`,
not a duplicate invitation resource; the URL is not recoverable from reads.

For App issuers, `app-oauth-issuer inspect` returns only the candidate receipt,
not current authority or an ETag. First activation uses
`app-oauth-issuer activate <appId> <inspectionId> --activation-proof <jws>
--if-none-match '*'`. Replacement uses `--etag E` from the current external
issuer (or resolves that ETag if omitted). These options are mutually
exclusive. Activation returns only `{ etag }`; read the issuer separately.

Creation commands take or auto-generate an idempotency key; mutations on existing
resources resolve the current ETag when none is passed; destructive operations
require an explicit `--confirm-*` flag matching the target (or a TTY prompt).
`app-oauth-issuer activate` accepts only a compact-JWS activation proof signed
off-CLI with a key the discovered issuer advertises — private key material is
never a valid input, and there is no manual JWK upload path: UniCAS derives
keys exclusively from verified issuer JWKS discovery.

The WebUI reads the optional custom issuer with
`GET /admin/apps/:appId/oauth-issuer?optional=true`. An authorized member
receives `200 null` when no custom issuer is configured; membership failures
remain errors and use App vocabulary. Omitting `optional` preserves the default `404 NOT_FOUND`
behavior used by the CLI and MCP. Configured issuers still return their metadata
and ETag.

## Testing

```powershell
pnpm --filter @unicas/admin-cli test
pnpm --filter @unicas/admin-cli typecheck
pnpm check:workspace
```

Unit tests mock the BFF `/admin` API (login/exchange, control-plane operations)
and a stateless stdio MCP server; they never touch production. A real
`unicas login` + `unicas account` against `https://console.unicas.work/admin` is a
manual verification step (browser provider sign-in + UniCAS consent required).

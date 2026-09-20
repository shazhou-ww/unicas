---
name: unicas-cli
description: "Use whenever a task involves operating the UniCAS control plane: listing or creating Apps, managing App administrators, configuring an App OAuth issuer, reading App/Space audit data, or using the `unicas` CLI or stdio MCP mode."
---

# Using the `unicas` CLI

The CLI is the supported control-plane path for agents. It performs browser
login once, persists the resulting administrator session, and exposes the same
operations as shell commands and a stdio MCP server.

## When to use this skill

Use it for:

- App administration: list, inspect, create, and update Apps.
- Member management: list App administrators, invite a member, and remove a Principal.
- App OAuth issuer configuration: inspect and activate an issuer.
- Audit and observability: App control events and Space Root Ref balances/events.

Do not use it for Space data-plane operations, invitation acceptance in a
browser, or changes to the control-plane deployment itself.

## How login works

`unicas login` opens the administrator BFF in a browser. The BFF performs OIDC,
then returns a one-time code that the CLI exchanges with PKCE for a session
cookie and CSRF token. The session is stored in `~/.unicas/session.json` with
owner-only permissions. The CLI never receives the upstream OIDC client secret.

Commands write JSON to stdout and diagnostics to stderr. Exit code `0` means
success, `1` means an operation or remote error, and `2` means login or
authorization is required.

## First run

```powershell
pnpm --filter @unicas/admin-cli build
pnpm install --global ./packages/admin-cli
unicas login
```

The login command opens the administrator BFF in a browser, completes OIDC,
and stores the session. Check local state without a network request with
`unicas status`. If a command reports that login is required, run
`unicas login` before retrying.

## Command catalog

Read operations (`control:read`):

```text
unicas principal
unicas apps list [--limit N] [--cursor C]
unicas apps get <appId>
unicas app-members list <appId> [--limit N] [--cursor C]
unicas app-oauth-issuer get <appId>
unicas app-ref-domains list <appId>
unicas app-audit control <appId> [--limit N] [--cursor C] [--after ID]
unicas app-audit root-domain-refs <appId> <refDomain> [--space-id S] [--limit N] [--cursor C]
unicas app-audit root-domain-events <appId> <refDomain> [--space-id S] [--after N] [--limit N]
```

Write operations (`control:write`):

```text
unicas apps create <displayName> [--idempotency-key K]
unicas apps update <appId> [displayName] [--description D] [--etag E]
```

Security operations (`control:security`):

```text
unicas app-members invite <appId> <email> [--idempotency-key K]
unicas app-members remove <appId> --issuer <url> --subject <sub> [--etag E] --confirm-subject <sub>
unicas app-oauth-issuer inspect <appId> <issuer>
unicas app-oauth-issuer activate <appId> <inspectionId> --activation-proof <jws> [--etag E]
```

Session commands are `unicas login`, `unicas logout`, and `unicas status`.
Run `unicas mcp` to expose the complete App catalog over stdio.

The old `whoami`, `stacks`, `members`, `oauth-issuer`, `ref-domains`, and
`audit` commands are frozen v1 compatibility surfaces. Use them only when the
task explicitly targets the Stack/Tenant contract; never treat their fields as
aliases for App/Space.

## Guardrails

- If `--etag` is omitted for a mutation, the CLI reads the current resource
  first. After `REVISION_MISMATCH`, re-read and retry with the fresh ETag.
- Destructive commands require an exact `--confirm-*` value when noninteractive.
  Never guess it.
- Creation commands generate an idempotency key automatically. Pass a stable
  `--idempotency-key` when a retry must resolve to the original operation.
- OAuth activation accepts only a compact JWS signed outside the CLI by a key
  advertised by the issuer. Never pass private keys or upload JWKs to the CLI.
- No App deletion operation exists.

## Common workflows

Create an App:

```powershell
unicas apps create "Operations" --idempotency-key create-ops-1
```

Invite an administrator:

```powershell
unicas app-members invite <appId> ops@example.com --idempotency-key invite-ops-1
```

Connect an App OAuth issuer:

```powershell
unicas app-oauth-issuer get <appId>
unicas app-oauth-issuer inspect <appId> https://issuer.example/oauth
# Sign the returned challenge off-band with an advertised issuer key.
unicas app-oauth-issuer activate <appId> <inspectionId> --activation-proof '<jws>' [--etag E]
```

## stdio MCP mode

`unicas mcp` reuses the persisted session and serves the command catalog over
stdio:

```json
{ "transport": "stdio", "serverName": "unicas", "command": "unicas", "args": ["mcp"] }
```

On Windows, the global executable is a `.CMD` shim. A Node-based MCP client
must use `shell: true`, invoke `%LOCALAPPDATA%\pnpm\bin\unicas.CMD`, or run
`node <checkout>/packages/admin-cli/dist/cli.js mcp` directly.

## Troubleshooting

- `Not logged in` or an expired/revoked session: run `unicas login` again.
- `AUTHORIZATION_FAILED client_id is required`: the printed authorize URL was
  truncated; rerun login and use the complete URL.
- `REVISION_MISMATCH`: re-read the resource and retry with its current ETag.

## Sources of truth

- `docs/cas-control-plane-cli.md`: CLI overview and integration guidance.
- `packages/admin-cli/README.md`: complete command reference and guardrails.
- `packages/admin-protocol/src/app-mcp-catalog.ts`: shared App MCP catalog.
- `packages/admin-cli/src/mcp/catalog.ts`: combined App and v1 stdio catalog.
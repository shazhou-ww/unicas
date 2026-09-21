# UniCAS domain topology

Status: accepted target architecture

## Origins

UniCAS separates product communication, machine protocols, administrator
workflows, and documentation by origin:

| Origin | Audience | Owned surface |
| --- | --- | --- |
| `https://unicas.work` | Developers and evaluators | Product overview, quick start, and links to source, console, and docs |
| `https://api.unicas.work` | Services, SDKs, CLIs, and agents | App/Space data API, OAuth/MCP, discovery, and health |
| `https://console.unicas.work` | App administrators and Platform Admins | Administrator WebUI, BFF, invitations, Platform Administration, and CLI login |
| `https://spaces.unicas.work` | Admitted users and release automation | Separately deployed first-party file App, App OAuth issuer/JWKS, and canonical upload smoke |
| `https://docs.unicas.work` | Developers and operators | Product, protocol, deployment, and operations documentation |

The UniCAS middleware has no end-user application surface. Integrating Apps own
end-user identity, Space mapping, and business workflows. Spaces is one such
App and remains a separate deployment and trust boundary. The console is for
people who administer a UniCAS App.

Use `console.unicas.work`, not `admin.unicas.work`, for the human product. App
and Platform Administration workspaces share this deployment and origin but
retain separate server-side authorization checks. Platform authority does not
create a second frontend or identity provider.

## Origin ownership

Each security boundary has one canonical public origin:

```text
CAS_PUBLIC_ORIGIN=https://api.unicas.work
MCP_PUBLIC_ORIGIN=https://api.unicas.work
ADMIN_PUBLIC_ORIGIN=https://console.unicas.work
SPACES_PUBLIC_ORIGIN=https://spaces.unicas.work
```

- App audiences, Space routes, and protected-resource metadata use
  `CAS_PUBLIC_ORIGIN`.
- MCP resource metadata, OAuth endpoints, consent forms, and token audiences
  use `MCP_PUBLIC_ORIGIN`.
- Administrator callbacks, invitations, sessions, CSRF checks, and CLI login
  use `ADMIN_PUBLIC_ORIGIN`.
- Spaces user callbacks, sessions, CSRF checks, issuer metadata, and App APIs
  use `SPACES_PUBLIC_ORIGIN`; its UniCAS capabilities target
  `CAS_PUBLIC_ORIGIN`.

The CLI defaults to `https://console.unicas.work`. The website and docs are
separate static deployments and never receive service credentials.

## Host routing

The API Worker may serve the API and console custom domains, but must enforce
this host/path matrix:

| Host | Allowed paths |
| --- | --- |
| `api.unicas.work` | `/health`, `/.well-known/*`, `/v2/apps/*`, `/mcp`, `/oauth/*` |
| `console.unicas.work` | `/`, `/admin/*` |
| `spaces.unicas.work` | `/`, `/files*`, `/auth/google/*`, `/api/*`, `/.well-known/*` |

Wrong-host requests fail closed. Do not rely on redirects for
capability-bearing writes. The console and Admin BFF remain same-origin.
Administrator cookies are host-only and are not authentication on the API
origin.

`docs.unicas.work` is never routed to the API Worker. Exact custom domains do
not imply wildcard ownership of subdomains.

## OAuth callbacks

The production Google OAuth client registers both callbacks:

```text
https://console.unicas.work/admin/auth/callback
https://api.unicas.work/oauth/google/callback
https://spaces.unicas.work/auth/google/callback
```

The first belongs to administrator WebUI and CLI login. The second belongs to
remote MCP OAuth. The third belongs to the separately registered Spaces Google
client.

## Compatibility boundary

The previous `unidocs-cas` Worker and `unicas.shazhou.work` route form a
separate legacy environment. Its routes, Stack/Tenant vocabulary, issuers,
audiences, data, credentials, and Cloudflare resources remain unchanged.

The target App/Space resource model is defined in
[UniCAS terminology](terminology.md).
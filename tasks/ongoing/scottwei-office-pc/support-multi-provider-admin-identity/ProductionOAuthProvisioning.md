# Production OAuth provisioning

This guide lists the configuration needed to enable real administrator login
for Google, Microsoft personal accounts, and GitHub. It intentionally contains
no credential values. Store all secret values only in the GitHub `Production`
Environment and Cloudflare Worker secrets.

## GitHub Environment

Create or use the repository's protected `Production` Environment. Configure
these Environment variables (`vars`):

| Name | Value |
| --- | --- |
| `GOOGLE_OIDC_CLIENT_ID` | Google OAuth client ID |
| `MICROSOFT_OIDC_CLIENT_ID` | Microsoft application (client) ID |
| `GITHUB_CONSOLE_OAUTH_CLIENT_ID` | GitHub Console OAuth App client ID |
| `GITHUB_MCP_OAUTH_CLIENT_ID` | GitHub MCP OAuth App client ID |
| `ADMIN_EMAIL_FROM` | Verified sender address, for example `no-reply@unicas.work` |

Configure these Environment secrets (`secrets`):

| Name | Value |
| --- | --- |
| `GOOGLE_OIDC_CLIENT_SECRET` | Google OAuth client secret |
| `MICROSOFT_OIDC_CLIENT_SECRET` | Microsoft client secret value |
| `GITHUB_CONSOLE_OAUTH_CLIENT_SECRET` | GitHub Console OAuth App client secret |
| `GITHUB_MCP_OAUTH_CLIENT_SECRET` | GitHub MCP OAuth App client secret |
| `SESSION_ENCRYPTION_KEYS` | Versioned JSON map of key IDs to base64url 32-byte AES keys |
| `OAUTH_STATE_ENCRYPTION_KEY` | Base64url 32-byte AES key |

Do not use repository variables, repository secrets, workflow files, commit
messages, issue comments, or chat to store any secret value. The deployment
workflow must map the configured GitHub Environment values to the Worker and
must write secrets through Wrangler standard input before deployment.

## Google OAuth client

Create a Web application client in Google Cloud. Add both authorized redirect
URIs:

```text
https://console.unicas.work/admin/auth/callback
https://api.unicas.work/oauth/google/callback
```

Enable the OpenID Connect scopes requested by the application: `openid`,
`profile`, and `email`.

## Microsoft personal-account application

Create an Entra application registration restricted to personal Microsoft
accounts. Add both Web redirect URIs:

```text
https://console.unicas.work/admin/auth/callback/microsoft
https://api.unicas.work/oauth/microsoft/callback
```

Create a client secret and retain its *value* in
`MICROSOFT_OIDC_CLIENT_SECRET`. The Microsoft provider requires a working
Cloudflare `EMAIL` binding and an onboarded sender domain for the invitation
email challenge. `ADMIN_EMAIL_FROM` must be a verified address for that
domain.

## GitHub OAuth Apps

GitHub OAuth Apps permit only one callback URL per App, while UniCAS uses one
callback for Console sign-in and one for MCP authorization. Create two OAuth
Apps rather than choosing one path:

| App | Authorization callback URL | GitHub Environment variables |
| --- | --- | --- |
| UniCAS Console | `https://console.unicas.work/admin/auth/callback/github` | `GITHUB_CONSOLE_OAUTH_CLIENT_ID`, `GITHUB_CONSOLE_OAUTH_CLIENT_SECRET` |
| UniCAS MCP | `https://api.unicas.work/oauth/github/callback` | `GITHUB_MCP_OAUTH_CLIENT_ID`, `GITHUB_MCP_OAUTH_CLIENT_SECRET` |

The current Worker configuration accepts one GitHub credential pair. Before
enabling real GitHub login, the remaining task implementation must make the
Console and MCP credential pairs independently configurable. Do not configure
only one App and expect both flows to work.

## Before enabling production login

1. Set the GitHub `Production` Environment variables and secrets above.
2. Complete Cloudflare Email sender-domain onboarding and confirm the `EMAIL`
   binding is present on the `unicas` Worker.
3. Deploy the configuration-sync workflow after it is added to this task.
4. Test Console login with each provider, Microsoft invitation challenge email
   delivery, CLI login, and MCP consent using separate test accounts.
5. Rotate or revoke any provider secret immediately if it was copied outside
   the provider portal, GitHub Environment secret form, or Cloudflare secret
   input.
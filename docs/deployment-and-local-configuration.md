# Deployment and local configuration

This repository deploys one UniCAS Cloudflare Worker containing the Space and
administrator HTTP planes, the administrator BFF and UI, and MCP/OAuth ingress.
Keep these configuration classes separate:

1. Deployment identity authenticates Wrangler to Cloudflare.
2. Runtime secrets live in Cloudflare Workers secrets.
3. Local settings come from the current process and gitignored `.wrangler/`
   state, or from Docker Compose interpolation and its named volume.

Never commit tokens, private keys, `.dev.vars`, `.env`, or `.wrangler/`.

## Local development

Run the host runtime:

```powershell
pnpm dev
```

It starts:

| Surface | Default URL |
| --- | --- |
| Administrator console | `http://localhost:4070/admin/` |
| Browser-facing UniCAS edge | `http://localhost:4070/v2/apps/.../spaces/...` |
| Direct Miniflare edge | `http://127.0.0.1:8794` |
| Mock OIDC discovery | `http://127.0.0.1:8793/.well-known/openid-configuration` |

Host-mode Miniflare state persists under `.wrangler/miniflare`. Stop the environment
with Ctrl+C; restarting `pnpm dev` reuses that state.

Vite proxies Space, managed-issuer, and discovery routes to the direct edge so
the local browser topology matches production's single public origin.

The local runtime uses its mock OIDC provider by default. To use Google OIDC,
set both `GOOGLE_OIDC_CLIENT_ID` and `GOOGLE_OIDC_CLIENT_SECRET`. Optionally set
`GOOGLE_OIDC_ISSUER`; register
`http://localhost:4070/admin/auth/callback` as the redirect URI.

Other local settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UNICAS_LOCAL_HOST` | `127.0.0.1` | Host interface for Miniflare and Vite |
| `UNICAS_LOCAL_PUBLIC_HOST` | Same as `UNICAS_LOCAL_HOST` | Browser-visible host for local OIDC endpoints; Docker sets `localhost` |
| `UNICAS_ADMIN_ORIGIN` | `http://localhost:4070` | Browser-facing administrator origin |

To exercise managed issuers and Playground locally, set both
`MANAGED_ISSUER_PRIVATE_KEY_PKCS8` and `MANAGED_ISSUER_KEY_ID` before startup.
Host and Docker modes forward the pair together; supplying only one leaves the
managed issuer unavailable.

### Docker

Run the same environment in Docker when host Node.js is unavailable:

```powershell
pnpm dev --docker
```

Compose forwards `UNICAS_ADMIN_ORIGIN` and the three OIDC variables above. It
publishes ports 4070, 8793, and 8794 and stores `.wrangler` state in the named Docker
volume `unicas-state`; it does not bind-mount the checkout's `.wrangler/`
directory. `docker compose -f stacks/unicas/local/compose.yaml down` preserves
that volume, so the next start reuses state.

### Disposable capability fixture

Generate a local ES256 issuer fixture only when a test or non-production App
needs one:

```powershell
pnpm keys:local
```

The default output is `.wrangler/capability/local.json`, created with exclusive
owner permissions. The command refuses to overwrite an existing file. Never
commit or reuse this fixture as a production key.

## Cloudflare deployment identity

Wrangler reads its identity from the process running the deployment:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "<account-id>"
$env:CLOUDFLARE_API_TOKEN = "<api-token>"
pnpm exec wrangler whoami
```

Use a dedicated token per developer or CI environment. Scope it to the target
account and zone. For GitHub Actions, start from Cloudflare's **Edit Cloudflare
Workers** token template, include only the production account under Account
Resources, and include only the `unicas.work` zone under Zone Resources. The
deployment publishes Worker scripts, assets, routes, and Durable Object
migrations that reference already-provisioned bindings. Do not add general
DNS, account administration, Access, billing, or D1/R2/KV data-management
permissions.

The committed [Wrangler configuration](../packages/service-cloudflare/wrangler.toml)
contains production resource IDs, route names, and the Google OAuth client ID.
Those identifiers are public configuration, not credentials, but changing them
must be intentional. The previous `unidocs-cas` deployment and its
`unicas.shazhou.work` route remain online as a legacy environment. This
repository deploys isolated `unicas-*` storage resources and the `unicas`
Worker at `https://api.unicas.work` and `https://console.unicas.work`. The apex
is the separate product-site Worker. Existing wire media types and downstream
issuer identifiers remain compatibility contracts and are not renamed.

## Worker secrets

Provision secrets with Wrangler so values never appear in shell history:

```powershell
pnpm --filter @unicas/service-cloudflare exec wrangler secret put GOOGLE_OIDC_CLIENT_SECRET
pnpm --filter @unicas/service-cloudflare exec wrangler secret put SESSION_ENCRYPTION_KEYS
pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_STATE_ENCRYPTION_KEY
pnpm --filter @unicas/service-cloudflare exec wrangler secret put ADMIN_EMAIL_ALLOWLIST
```

`SESSION_ENCRYPTION_KEYS` is a non-empty JSON object mapping key IDs to
base64url keys, for example `{"2026-09":"<base64url-32-byte-key>"}`. Keep old
entries during session-key rotation until sessions sealed with them have
expired.

Additional features require these secrets:

| Secret | Required for |
| --- | --- |
| `CAS_R2_ACCESS_KEY_ID` | Presigned direct R2 uploads |
| `CAS_R2_SECRET_ACCESS_KEY` | Presigned direct R2 uploads |
| `MANAGED_ISSUER_PRIVATE_KEY_PKCS8` | UniCAS-managed App issuers |
| `CAS_AUDIT_READER_KEY` | Protected physical audit-reader RPC |

`MANAGED_ISSUER_KEY_ID` is the corresponding non-secret key ID in
`wrangler.toml`. The current implementation exposes one managed signing key;
add key-ring overlap support before rotating it in production.

Optional OIDC/session variables include `OIDC_ISSUER`, `OIDC_DISCOVERY_URL`,
`SESSION_TTL_MS`, `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SECURE`, and
`SESSION_COOKIE_SAME_SITE`. `ADMIN_TEST_ACCOUNT_EMAIL` and
`ADMIN_TEST_ACCOUNT_PASSWORD` are test-only and must never be enabled in
production.

`CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS` is optional. Unset or blank permits public
HTTPS issuer discovery; a comma-separated value restricts discovery to those
origins. The Worker intentionally keeps the `global_fetch_strictly_public`
compatibility flag so metadata and JWKS discovery cannot reach private network
targets.

Before split-origin deployment, add both production redirect URIs without
removing the existing apex callbacks:

```text
https://console.unicas.work/admin/auth/callback
https://api.unicas.work/oauth/google/callback
```

The first serves administrator WebUI and CLI login; the second serves remote
MCP OAuth. `docs.unicas.work` is served by the independent assets-only
`unicas-docs` Worker under `stacks/unicas/docs-site`; it has no API service
bindings or credentials. Validate and deploy it separately:

```powershell
pnpm docs:check
pnpm deploy:docs:plan
pnpm deploy:docs
```

The accepted origin ownership model is documented in
[UniCAS domain topology](domain-topology.md).

## Read-only deployment validation

Print the repository-controlled deployment sequence without running it:

```powershell
pnpm deploy:plan
```

Build Wrangler's actual upload bundle without contacting the deployment API:

```powershell
pnpm --filter @unicas/service-cloudflare exec wrangler deploy --dry-run
```

Do not run `pnpm deploy --dry-run`: pnpm can consume that argument instead of
forwarding it, which invokes the real root deploy script. Use only
`pnpm deploy:plan` or the direct Wrangler command above for dry runs.

## Deploy and smoke

After the plan, bundle dry-run, tests, and typecheck pass, deploy with:

```powershell
pnpm deploy:production
```

The explicit production command builds the Worker, deploys it, rebuilds the
protocol artifacts used by smoke, and then tests the production endpoint.
`pnpm deploy` intentionally refuses to run. A named Wrangler environment must
use `--skip-smoke`; otherwise the deploy command refuses to proceed because the
default smoke target is production:

```powershell
node stacks/unicas/deploy/deploy.mjs --env staging --skip-smoke
node stacks/unicas/deploy/smoke.mjs https://staging.example.com
```

No named environments are currently declared in `wrangler.toml`, so the example
above is valid only after adding isolated bindings and routes.

The smoke signer reads provisioned private keys from the gitignored
`.wrangler/cas-deploy/` directory. To target one control-plane-managed App,
set `UNICAS_SMOKE_APP_ID`, `UNICAS_SMOKE_ISSUER`, `UNICAS_SMOKE_AUDIENCE`,
`UNICAS_SMOKE_KID`, and `UNICAS_SMOKE_KEY_FILE`; optional
`UNICAS_SMOKE_SPACE_ID` defaults to `deploy-smoke`. The default smoke covers
lease, read, metadata, Root Ref idempotency, usage, GC, cross-Space isolation,
and bidirectional v1/v2 denial. `pnpm smoke:v1` retains the separate frozen v1
flow. Never commit the key files or print their contents.

## GitHub Actions production deployment

The `deploy-production` job in [the CI workflow](../.github/workflows/ci.yml)
runs only for a push to `main` or a manual workflow dispatch whose selected
branch is `main`. It waits for the same workflow's `validate` job, checks out
`github.sha` again, installs from the lockfile, and rebuilds before publishing.
Pull requests, fork workflows, non-`main` pushes, and manual runs from another
branch skip the deployment job before the protected environment is entered.

Create one GitHub environment named `Production`. Set its deployment branch
policy to selected branches and tags, allowing only `main`; add required
reviewers or a wait timer if the repository's release policy requires them.
Configure these values on that environment, not as unprotected repository
secrets:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | ID of the one production Cloudflare account |
| Secret | `CLOUDFLARE_API_TOKEN` | Dedicated **Edit Cloudflare Workers** token scoped to that account and the `unicas.work` zone |
| Variable | `UNICAS_SMOKE_APP_ID` | Provisioned production smoke App ID |
| Variable | `UNICAS_SMOKE_ISSUER` | Issuer registered for the smoke App |
| Variable | `UNICAS_SMOKE_AUDIENCE` | Audience registered for the smoke App |
| Variable | `UNICAS_SMOKE_KID` | Key ID published by the smoke issuer |
| Variable | `UNICAS_SMOKE_SPACE_ID` | Dedicated smoke Space, normally `deploy-smoke` |
| Secret | `UNICAS_SMOKE_PRIVATE_KEY_PKCS8` | PEM-encoded PKCS#8 private key matching the smoke key ID |

Do not create a GitHub value for `UNICAS_SMOKE_KEY_FILE`. The workflow assigns
a fixed file name, writes the private key under the gitignored
`.wrangler/cas-deploy/` boundary with owner-only directory and file modes, and
deletes it immediately after the service deployment and smoke step, including
when that step fails. It does not set `UNICAS_SMOKE_ALLOW_OTHER_ORIGIN` or
`UNICAS_SMOKE_ENABLE_CONCURRENCY`; production smoke remains pinned to
`https://api.unicas.work` with the Cloudflare-safe concurrency behavior.

Worker runtime secrets remain provisioned only in Cloudflare. Do not copy
`GOOGLE_OIDC_CLIENT_SECRET`, session or OAuth encryption keys, R2 credentials,
managed-issuer keys, the audit-reader key, or any future Worker runtime secret
into GitHub for routine deployment. Wrangler preserves those secrets when it
publishes a new version.

A normal release is a validated push to `main`. The protected job stops on the
first failure. Its `unicas-production` concurrency group uses `queue: max` and
does not cancel an in-progress release, so up to 100 validated revisions can
wait for serialized deployment instead of replacing the current pending run.
GitHub orders them by the time each deployment job starts waiting, which can
differ from workflow dispatch order; every job still deploys its own validated
`github.sha`. The job deploys in this order:

1. `pnpm deploy:production` for the API/console service and canonical smoke.
2. `pnpm deploy:site` for `unicas.work`.
3. `pnpm deploy:docs` for `docs.unicas.work`.
4. HTTPS checks requiring the API health JSON, the console's same-origin
   `/admin/` redirect, and identifying HTML from the product and documentation
   origins. Redirects to another host or protocol do not pass.

For a manual recovery run, open the **CI** workflow in GitHub Actions, choose
**Run workflow**, and select `main`. The dispatch repeats validation and the
same protected deployment path; it is not a bypass around a failed check. See
[CAS Middleware Operations](cas-operations.md) for failure diagnosis,
credential rotation, and version-specific rollback.

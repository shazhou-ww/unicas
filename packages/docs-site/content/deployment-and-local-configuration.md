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
| Browser-facing UniCAS edge | `http://localhost:4070/v1/apps/.../spaces/...` |
| Direct Miniflare edge | `http://127.0.0.1:8794` |
| Mock OIDC discovery | `http://127.0.0.1:8793/.well-known/openid-configuration` |

Host-mode Miniflare state persists under `.wrangler/miniflare`. Stop the environment
with Ctrl+C; restarting `pnpm dev` reuses that state.

Vite proxies Space and discovery routes to the direct edge so
the local browser topology matches production's single public origin.

The local runtime uses its mock OIDC provider by default. To use Google OIDC,
set both `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET`. Optionally set
`GOOGLE_OIDC_ISSUER`; register
`http://localhost:4070/admin/auth/callback` as the redirect URI.

Microsoft and GitHub are configuration-driven. Supply each complete client ID
and secret pair to enable it. Register
`/admin/auth/callback/microsoft` and `/admin/auth/callback/github` on the
browser-facing administrator origin. The default local runtime has no outbound
Email binding, so a Microsoft email-constrained invitation intentionally fails
closed; repository and BFF tests provide a local fake sender.

Other local settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UNICAS_LOCAL_HOST` | `127.0.0.1` | Host interface for Miniflare and Vite |
| `UNICAS_LOCAL_PUBLIC_HOST` | Same as `UNICAS_LOCAL_HOST` | Browser-visible host for local OIDC endpoints; Docker sets `localhost` |
| `UNICAS_ADMIN_ORIGIN` | `http://localhost:4070` | Browser-facing administrator origin |

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

The committed [Wrangler configuration](../../service-cloudflare/wrangler.toml)
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
pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_GOOGLE_CLIENT_SECRET
pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_MICROSOFT_CLIENT_SECRET
pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_GITHUB_CLIENT_SECRET
```

The production deployment checks Cloudflare for `SESSION_ENCRYPTION_KEYS` and
`OAUTH_STATE_ENCRYPTION_KEY` before publishing the Worker. It generates each
missing value directly into a Worker secret with 32 bytes of cryptographic
randomness and never overwrites an existing value. These internal encryption
keys do not pass through GitHub. Key rotation remains an explicit operation.

`SESSION_ENCRYPTION_KEYS` is a non-empty JSON object mapping key IDs to
base64url keys, for example `{"2026-09":"<base64url-32-byte-key>"}`. Keep old
entries during rotation until sessions and pending platform-invitation replay
receipts sealed with them have expired.

Manual OTLP tracing is independently gated by
`UNICAS_MANUAL_TRACE_SAMPLE_RATE`, which is checked in as `0` for both dynamic
Workers. At zero, no trace destination or tracing secret is required. A
reviewed nonzero deployment must provide `UNICAS_OTLP_TRACES_ENDPOINT` as a
credential-free HTTPS URL ending in `/v1/traces`, plus the Worker secrets
`UNICAS_OTLP_AUTHORIZATION` and `UNICAS_TRACE_HMAC_KEYS`. The key ring has the
form `{"active":"2026-09","keys":{"2026-09":"<base64url-32-byte-key>"}}`,
accepts one to three versions, and uses the active version for new trace IDs
and internal context. Retain an old version only for the bounded rotation
overlap. Never place endpoint credentials in the endpoint URL or a Wrangler
variable.

Administrator admission is owned by Account platform authorities and App
memberships. There is no email-allowlist fallback.

Additional features require these secrets:

| Secret | Required for |
| --- | --- |
| `CAS_R2_ACCESS_KEY_ID` | Presigned direct R2 uploads |
| `CAS_R2_SECRET_ACCESS_KEY` | Presigned direct R2 uploads |
| `CAS_AUDIT_READER_KEY` | Protected physical audit-reader RPC |
| `OAUTH_MICROSOFT_CLIENT_SECRET` | Microsoft personal-account administrator login |
| `OAUTH_GITHUB_CLIENT_SECRET` | GitHub administrator login and verified Emails API lookup |
| `UNICAS_OTLP_AUTHORIZATION` | Reviewed nonzero manual OTLP trace export |
| `UNICAS_TRACE_HMAC_KEYS` | Scoped trace identity and signed internal context when manual tracing is sampled |

`CAS_UPLOAD_URL_EXPIRY_SECONDS` defaults to `300` and must be an integer from
1 through 604800. Browser upload origins must be allowed by the R2 bucket CORS
policy for `PUT` with `Content-Type` and `If-None-Match`. Do not add
`Authorization`: the presigned URL is the upload credential. R2 cannot enforce
the canonical SHA-256 as a full-object PutObject checksum, so UniCAS validates
the digest and 32 MiB limit on the subsequent lease request.

Deploy the lease-upload migration in this order:

1. Configure the R2 signing credentials and browser CORS policy.
2. Deploy the service so its idempotent startup migration creates
   `cas_node_uploads`, `cas_node_upload_cleanup`, and the `cas_nodes.ready`
   column before accepting App/Space traffic.
3. Publish protocol and client consumers together. Clients using inline bodies
   or `X-CAS-Upload-*` headers are not compatible with the released endpoint.
4. Run the App/Space smoke test, which exercises lease, direct PUT, repeated
   lease publication, readback, Root Refs, usage, GC, and Space isolation.

### App/Space v1 rollout

The released Space HTTP API and its family-local capability claim both use
version 1 with exact operation permissions. Deploy the service and maintained
App consumers from the same accepted repository revision. Prototype routes,
claim versions, and broad permissions are rejected immediately; there is no
cutoff binding or compatibility mode. Follow the
[prototype migration guide](app-user-api/migration-v2-to-v1.md) for consumer
changes and rollback boundaries.

Optional OIDC/session variables include `OIDC_ISSUER`, `OIDC_DISCOVERY_URL`,
`SESSION_TTL_MS`, `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SECURE`, and
`SESSION_COOKIE_SAME_SITE`.

Set the corresponding non-secret `OAUTH_MICROSOFT_CLIENT_ID` and
`OAUTH_GITHUB_CLIENT_ID` variables before enabling those providers. Microsoft
configuration additionally requires the `EMAIL` send binding and a validated
`ADMIN_EMAIL_FROM` address on an onboarded UniCAS Email Service domain; Worker
startup rejects an incomplete combination. The hourly scheduled handler deletes
expired challenge rows. Challenge codes are never stored or logged, and resend
limits apply across repeated callbacks for the same invitation, identity, and
destination.

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
https://spaces.unicas.work/auth/google/callback
```

The first serves administrator WebUI and CLI login, the second serves remote
MCP OAuth, and the third belongs to the separately registered Spaces Google
client. `docs.unicas.work` is served by the independent assets-only
`unicas-docs` Worker owned by `packages/docs-site`; it has no API service
bindings or credentials. Validate and deploy it separately:

```powershell
pnpm docs:check
pnpm deploy:docs:plan
pnpm deploy:docs
```

`spaces.unicas.work` is a separately deployed full-stack App, not a route on
the UniCAS service Worker. Its browser never receives a capability or presigned
upload URL, so this server-mediated design does not add the Spaces origin to R2
CORS. See [Spaces file App operations](../../spaces/README.md) for its dedicated
D1, variables, secrets, one-time bootstrap, release smoke, and key rotation.

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
pnpm deploy:spaces:plan
```

Both dynamic Worker configs explicitly persist 5% sampled custom logs with
generated invocation logs disabled. They explicitly disable trace sampling,
persistence, and destinations in Cloudflare's native tracing. They also set
the independent manual OTLP sample to zero. The assets-only product and docs
Workers have no observability block. The deployment-plan test locks both gates
and verifies that generated Spaces production configuration preserves them:

```powershell
pnpm exec vitest run tests/deploy-plan.test.mjs
```

Do not enable native tracing, manual trace sampling, or invocation logs through
a dashboard override. Wrangler configuration is the source of truth, and the
next deploy would replace that override. A nonzero manual sample additionally
requires an approved OTLP destination, access/retention/cost review, synthetic
secret-absence evidence, and explicit approval of the exact rate. Native
automatic tracing remains disabled even after such approval. See
[Observability](observability.md) for the full contract and rollback.

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

The protected release runs `pnpm deploy:spaces` after the UniCAS service smoke
and before product or documentation promotion. It applies App-owned D1
migrations, deploys Spaces, runs upload/commit/readback/isolation/cleanup smoke,
and refuses an implicit or smoke-skipping production invocation.

The smoke signer reads provisioned private keys from the gitignored
`.wrangler/cas-deploy/` directory. To target one control-plane-managed App,
set `UNICAS_SMOKE_APP_ID`, `UNICAS_SMOKE_ISSUER`, `UNICAS_SMOKE_AUDIENCE`,
`UNICAS_SMOKE_KID`, and `UNICAS_SMOKE_KEY_FILE`; optional
`UNICAS_SMOKE_SPACE_ID` defaults to `deploy-smoke`. The default smoke covers
lease, read, metadata, Root Ref idempotency, usage, GC, cross-Space isolation,
prototype-version denial, retired-claim denial, and retired-route `404`. Never
commit the key files or print their contents.

## GitHub Actions production deployment

The `deploy-production` job in [the CI workflow](../../../.github/workflows/ci.yml)
runs only for a push to `release` or a manual workflow dispatch whose selected
branch is `release`. It waits for the same workflow's `validate` job, checks
out `github.sha` again, installs from the lockfile, and rebuilds before
publishing. Pull requests, fork workflows, `main` and other non-`release`
pushes, and manual runs from another branch skip the deployment job before the
protected environment is entered.

After every successful `release` push, the separate `tag-production` job
creates one annotated tag named
`production-YYYYMMDD-<workflow-run-number>`. The date is the UTC date of the
workflow run's original `created_at` value, not the time of a rerun, and the
tag targets that run's exact `github.sha`. Its annotation records the workflow
run URL and commit. Pull requests, other branch pushes, manual recovery runs,
failed deployments, and failed public-origin checks do not create a tag. The
workflow's push trigger selects branches only, so pushing the production tag
does not start another validation run.

The workflow and `deploy-production` job retain `contents: read` permission.
Only `tag-production` receives `contents: write`, together with `actions: read`
to retrieve the original workflow creation timestamp. It uses the ephemeral
workflow `GITHUB_TOKEN`; do not configure a PAT or another repository-write
secret. The job accepts an existing tag only when its peeled target equals the
deployed commit, never force-pushes, and fails closed on a conflicting target.

Create an active repository tag ruleset named
**Immutable production deployment tags** targeting
`refs/tags/production-*`. Enable **Restrict updates** and
**Restrict deletions**, leave **Restrict creations** disabled, and configure
no bypass actors. This allows the tagging job to create a new
marker while preventing later pushes or deletions from changing its meaning.
Do not use a legacy tag-protection rule for this namespace because it also
blocks first creation.

Create one GitHub environment named `Production`. Set its deployment branch
policy to selected branches and tags, allowing only `release`; add required
reviewers or a wait timer if the repository's release policy requires them.
Configure these values on that environment, not as unprotected repository
secrets:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | ID of the one production Cloudflare account |
| Secret | `CLOUDFLARE_API_TOKEN` | Dedicated **Edit Cloudflare Workers** token scoped to that account and the `unicas.work` zone |
| Variable | `OAUTH_GOOGLE_CLIENT_ID` | Google Web OAuth client ID |
| Secret | `OAUTH_GOOGLE_CLIENT_SECRET` | Google Web OAuth client secret |
| Variable | `OAUTH_MICROSOFT_CLIENT_ID` | Microsoft Application (client) ID |
| Secret | `OAUTH_MICROSOFT_CLIENT_SECRET` | Microsoft client secret value |
| Variable | `OAUTH_GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| Secret | `OAUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
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

The release workflow copies the three provider client secrets from the
protected GitHub Environment into Cloudflare. Internal session and OAuth-state
encryption keys remain provisioned only in Cloudflare: the production deploy
creates them when absent and preserves them on later releases. Do not copy R2
credentials, retired first-party issuer keys, the audit-reader key, or other Worker runtime
secrets into GitHub for routine deployment.

The production smoke App uses the dedicated external issuer
`https://unicas.work/deploy-smoke`. The product-site Worker serves its OAuth
metadata from `/.well-known/oauth-authorization-server/deploy-smoke` and its
public JWKS from `/deploy-smoke/jwks.json`; both paths return JSON directly
without redirects. Only public keys belong in those tracked assets. The
matching private key is a separate deployment credential and must never be
derived from or copied from any retired first-party issuer key.

Initial provisioning is an explicit bootstrap operation:

1. Generate an extractable ES256 key pair offline under the gitignored
   `.wrangler/cas-deploy/` directory and choose a unique `kid`.
2. Add only the public JWK to the product-site JWKS, validate
   `pnpm deploy:site:plan`, and deploy the product-site Worker.
3. Run `unicas app-oauth-issuer inspect <appId>
   https://unicas.work/deploy-smoke` through a production control-plane
   session. Sign its exact, expiring challenge as an ES256 compact JWS with
   the new key and activate that inspection. Never pass the private key to the
   control plane.
4. Set the five `UNICAS_SMOKE_*` variables from the activated response, set
   `UNICAS_SMOKE_SPACE_ID=deploy-smoke`, and stream the PKCS#8 PEM directly
   into the `UNICAS_SMOKE_PRIVATE_KEY_PKCS8` GitHub environment secret without
   printing it.
5. If recovery is required, dispatch **Recover Spaces production** with the
   exact reviewed `main` commit and selected operation. Retain the bootstrap key
   only in the approved operator credential store until rotation or recovery
   no longer requires it.

The App/Space v1 issuer cutover is complete. Normal production contains no
cutover switch or executable cutover step. Preserve its historical run and
cutover documentation as audit evidence; do not repeat it as recovery.

For the one-time Account-model production cutover, configure a required
reviewer on the `Production` Environment before merging the promotion pull
request. Let the release revision pass `validate` and stop at that environment
approval. From a checkout of the exact release SHA:

1. Preview the bounded inventory with
   `node stacks/unicas/deploy/reset-smoke.mjs --expected-stack-id <app-id>`.
2. Execute the authorized no-backup reset with `--execute`, the same App ID,
   and `--confirm DELETE-ALL-TEST-DATA-NO-BACKUP`.
3. Require the script to report `resetVerified`, `bootstrapVerified`, and
   `maintenanceActive` without printing provider identity data.
4. Approve the held Production deployment. The workflow replaces maintenance,
   materializes missing internal encryption keys, and runs canonical smoke.

The maintenance Worker physically enumerates the dedicated R2 bucket and OAuth
KV namespace after traffic is stopped. A pending direct upload, an unexpected
object prefix, a changed KV inventory, or a non-empty post-delete inventory
fails closed. The reset also refuses any configured direct-upload signing
credential because an already signed R2 URL bypasses Worker maintenance; the
underlying R2 API token must be revoked first. If only final count verification is interrupted after the schema
commit, run the same script with `--verify-current --expected-stack-id <app-id>`;
that mode verifies the current schema and bootstrap without reading retired
tables or repeating deletion.

Do not approve first: the old Worker could recreate retired tables between the
reset and deployment. Do not run reset before the release job is waiting for
approval: validation failure would leave an unnecessary maintenance window.

Use `main` for normal development integration and keep `release` as a promotion
branch, not a second development line. Protect `release`, require the **CI**
validation job before merge, and disable force pushes and branch deletion.
Promote a tested `main` revision by opening a pull request with `release` as
the base and `main` as the compare branch. Review the exact commit range and
merge it without bypassing required checks. Direct pushes, rebases, or manual
commits on `release` obscure what was promoted and should be reserved for an
explicit recovery procedure.

A normal release is the validated push created by merging that promotion pull
request into `release`. The protected job stops on the first failure. Its
`unicas-production` concurrency group uses `queue: max` and does not cancel an
in-progress release, so up to 100 validated revisions can wait for serialized
deployment instead of replacing the current pending run. GitHub orders them by
the time each deployment job starts waiting, which can differ from workflow
dispatch order; every job still deploys its own validated `github.sha`. The
job deploys in this order:

1. `pnpm deploy:production` for the API/console service and canonical smoke.
2. `pnpm deploy:spaces` for the Spaces App and file smoke.
3. `pnpm deploy:site` for `unicas.work`.
4. `pnpm deploy:docs` for `docs.unicas.work`.
5. HTTPS checks requiring the API health JSON, the console's same-origin
   `/admin/` redirect, and identifying HTML from the product and documentation
   origins. Redirects to another host or protocol do not pass.

If `tag-production` alone fails, production has already passed every deploy,
smoke, and public-origin step. Do not start a new manual workflow, because
manual runs intentionally create no production tag. Open the original run and
choose **Re-run failed jobs**; a rerun keeps its original `created_at`,
`github.run_number`, and deterministic tag name. Before retrying, an operator
can inspect both the direct tag object and its peeled commit with:

```text
git ls-remote --tags origin refs/tags/production-YYYYMMDD-RUN refs/tags/production-YYYYMMDD-RUN^{}
```

No output means the tag is absent and the same-run retry can create it. A
peeled target equal to the run's `github.sha` is idempotent success. A different
target is an audit-integrity incident: stop, preserve the failed run and
ruleset history, and involve a repository owner. Never force-update, silently
delete, or substitute a differently named tag for that workflow run.

For a read-only comprehensive check, dispatch **CI**; it runs
`pnpm validate:release` and has no production write path. For Spaces recovery,
open **Recover Spaces production**, enter a full reviewed commit SHA reachable
from `main`, choose `provision-deploy` or `principals`, and pass `Production`
approval. The recovery workflow shares production concurrency, cannot deploy
the service or sites, and cannot create a production tag. See
[CAS Middleware Operations](cas-operations.md) for failure diagnosis,
credential rotation, and version-specific rollback.

# Spaces file App operations

`https://spaces.unicas.work` is a separately deployed first-party App that
exercises UniCAS through the same public App/Space interfaces available to an
external backend. Application code is the private `@unicas/spaces` workspace
package. `stacks/unicas/spaces/` contains only Cloudflare deployment
composition and the App-owned D1 migration.

The browser authenticates to Spaces with Google and receives only an opaque,
host-only App session. The Spaces Worker selects the provisioned App and Space,
signs a short-lived capability, and uses `@unicas/tenant-file-client`. The
browser never receives a capability, private signing key, presigned upload URL,
or storage object key. Microsoft and GitHub remain disabled.

## Validate locally

These commands require no Cloudflare credentials and do not contact production:

```powershell
pnpm --filter @unicas/spaces test
pnpm --filter @unicas/spaces typecheck
pnpm deploy:spaces:plan
```

Run the browser-only Vite UI with:

```powershell
pnpm --filter @unicas/spaces dev
```

A complete local Worker flow additionally needs a local D1 database, an HTTPS
issuer origin that UniCAS can discover, a registered test App issuer, and an
isolated test Space. Keep local values in ignored `.wrangler/` files. Never use
production Principal identifiers, content, or keys for local testing.

## Production configuration

Create a dedicated `unicas-spaces` D1 database. Store its UUID and the following
non-secret values as GitHub `Production` environment variables:

| Variable | Meaning |
| --- | --- |
| `SPACES_D1_DATABASE_ID` | App-owned D1 database UUID |
| `SPACES_GOOGLE_CLIENT_ID` | Google OAuth client with the Spaces callback |
| `SPACES_SIGNING_KID` | Active App capability signing key ID |
| `SPACES_SIGNING_PUBLIC_JWKS` | Public JWKS JSON; may contain old and new keys during rotation |
| `SPACES_SMOKE_PRINCIPAL_ID` | Dedicated non-browser smoke Principal |
| `SPACES_UNICAS_AUDIENCE` | Audience required by the UniCAS App issuer registration |

Store only these values as GitHub `Production` environment secrets:

| Secret | Meaning |
| --- | --- |
| `SPACES_GOOGLE_CLIENT_SECRET` | Google OAuth confidential-client secret |
| `SPACES_SIGNING_PRIVATE_KEY_PKCS8` | Active ES256 private signing key |
| `SPACES_SMOKE_CREDENTIAL` | High-entropy credential for `/api/smoke/session` |

The normal release also requires `CAS_R2_ACCESS_KEY_ID` and
`CAS_R2_SECRET_ACCESS_KEY` as `Production` environment secrets. Use an R2
Object Read & Write token scoped only to the production content bucket. The
workflow synchronizes these values to the UniCAS Worker before deploying it so
the direct-upload smoke cannot encounter an unconfigured presigner.

Set `SPACES_RELEASE_ENABLED=true` as a repository variable only after every
production prerequisite is ready. It must not be environment-scoped: GitHub
evaluates the deployment job condition before attaching the `Production`
environment. Leave it false or unset during one-time bootstrap.

The deployment script writes secrets to `.wrangler/spaces/secrets.json` with
owner-only permissions, passes that file to Wrangler, and deletes it in a
`finally` path. The generated Wrangler config contains only non-secret values.

Register this callback in the dedicated Google OAuth client:

```text
https://spaces.unicas.work/auth/google/callback
```

Spaces uploads through its Worker, so the browser never performs the presigned
R2 `PUT`. Do not add `spaces.unicas.work` to R2 CORS for this architecture.
The existing R2 CORS policy remains necessary for approved browser-direct
clients and must allow only their explicit origins, methods, and headers.

## First bootstrap

Generate the App signing fixture outside source control:

```powershell
pnpm keys:local -- --output .wrangler/spaces/signing-key.json `
  --issuer https://spaces.unicas.work `
  --kid spaces-YYYY-MM
```

Put the fixture's `privateKeyPkcs8` in the private-key secret and its `jwks`
object in `SPACES_SIGNING_PUBLIC_JWKS`. Keep the fixture owner-readable only.

Set the production variables and secrets in the current shell, including the
new D1 UUID, then publish only the issuer/UI bootstrap deployment:

```powershell
$env:SPACES_BOOTSTRAP_DEPLOY_CONFIRM = "spaces.unicas.work"
pnpm deploy:spaces:bootstrap
```

This explicit one-time mode applies the additive D1 migration and deploys with
`SPACES_SMOKE_ENABLED=false`. It does not run smoke or promote any later
release artifact. Normal production deployment cannot skip smoke.

Create the dedicated App and activate its external issuer through the supported
control plane:

```powershell
unicas apps create "Spaces" --idempotency-key spaces-production-v1
$inspection = unicas app-oauth-issuer inspect <app-id> https://spaces.unicas.work | ConvertFrom-Json
$inspection.challenge | Set-Content -NoNewline -Encoding utf8 .wrangler/spaces/issuer-challenge.txt
$proof = pnpm --silent spaces:issuer-proof -- --challenge-file .wrangler/spaces/issuer-challenge.txt --key-fixture .wrangler/spaces/signing-key.json
unicas app-oauth-issuer activate <app-id> $inspection.inspectionId --activation-proof $proof --if-none-match "*"
```

Bootstrap each admitted Google Principal with its stable Google `sub`; email is
display metadata and is never an identity key. This creates and positively
retains one empty file Root through the public Space API before writing its D1
catalog row:

```powershell
$env:SPACES_BOOTSTRAP_APP_ID = "<app-id>"
$env:SPACES_BOOTSTRAP_SPACE_ID = "<dedicated-user-space-id>"
$env:SPACES_BOOTSTRAP_PRINCIPAL_ID = "<opaque-principal-id>"
$env:SPACES_BOOTSTRAP_DISPLAY_NAME = "<display-name>"
$env:SPACES_BOOTSTRAP_GOOGLE_SUBJECT = "<stable-google-sub>"
$env:SPACES_BOOTSTRAP_KEY_FILE = ".wrangler/spaces/signing-key.json"
$env:SPACES_BOOTSTRAP_REF_DOMAIN = "spaces:files"
pnpm spaces:bootstrap -- --mode google
```

Bootstrap the dedicated smoke Principal in its own Space. It has no social
identity and no persistent Root; each smoke run creates and later releases its
own Root:

```powershell
$env:SPACES_BOOTSTRAP_SPACE_ID = "<dedicated-smoke-space-id>"
$env:SPACES_BOOTSTRAP_PRINCIPAL_ID = "<smoke-principal-id>"
$env:SPACES_BOOTSTRAP_DISPLAY_NAME = "Release smoke"
$env:SPACES_BOOTSTRAP_REF_DOMAIN = "spaces:smoke"
pnpm spaces:bootstrap -- --mode smoke
```

Both modes are idempotent only for an exact complete match. Partial or
conflicting Principal, identity, Space, or Root state stops before changing
data. The script never uses an administrator session on the data path.

## Release and smoke

The protected `release` workflow runs:

```text
deploy UniCAS service and run canonical service smoke
-> apply Spaces D1 migrations
-> deploy Spaces with its ephemeral secrets file
-> run pnpm spaces:smoke -- --base-url https://spaces.unicas.work
-> deploy product and documentation sites
-> verify origins and tag the revision
```

Before the normal Spaces deploy, `packages/spaces/scripts/preflight.mjs`
checks the remote App D1 mapping and proves the active issuer through a
least-privileged public Root Ref read. A live unexpired run blocks deployment.
A failed, pending, or expired run is recoverable: the newly deployed Worker
finishes its bounded cleanup before issuing the next smoke session.

The Spaces smoke creates a unique folder and a per-run Root, uploads more than
two 1 MiB chunks, confirms presigned upload plus repeated lease publication,
renames without another content write, downloads and hashes exact bytes,
requires ready-node reuse on a second upload, checks missing-authority and
cross-Space denials, and invokes cleanup twice. Output is limited to run ID,
stage, HTTP status, and stable error code.

Cleanup removes the run folder, commits the empty manifest, releases the final
Root Ref with a stable request ID, and deletes the smoke catalog row. A
scheduled trigger processes at most ten expired or failed runs per invocation.

## Rotation and recovery

Signing-key rotation is an overlap sequence:

1. Add the new public key to `SPACES_SIGNING_PUBLIC_JWKS` while retaining the
   old key, deploy, and wait beyond the UniCAS authority cache window.
2. Change `SPACES_SIGNING_KID` and `SPACES_SIGNING_PRIVATE_KEY_PKCS8` to the new
   pair, then run a green release smoke.
3. Remove the old public key in a later deployment after all old capabilities
   have expired.

Rotate the Google client secret independently without changing provider
subjects or Principal-to-Space mappings. Rotate the smoke credential by
replacing only its GitHub secret and deploying again.

For a failed smoke, inspect only structured `spaces_request_failed` and
`spaces_smoke_cleanup_failed` events by run ID, stage, status, and code. Never
print request headers or response bodies. Let the scheduled cleanup retry a
failed run, or trigger the Worker schedule after fixing the dependency. Verify
that no non-complete `spaces_smoke_runs` row and no smoke file Root remains
before retrying a release.

Back up App-owned metadata separately from UniCAS storage:

```powershell
pnpm --filter @unicas/service-cloudflare exec wrangler d1 export SPACES_DB `
  --remote --config ../../.wrangler/spaces/wrangler.production.json `
  --output ../../.wrangler/spaces/unicas-spaces.sql
```

A Worker rollback does not roll back D1 or Root Refs. Roll Spaces back before
the UniCAS service when a failed release changed both, then run the Spaces smoke
again. Restore D1 only from a reviewed backup and reconcile every cataloged
manifest against its positive Root Ref before returning the App to service.
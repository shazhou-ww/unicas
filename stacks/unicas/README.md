# UniCAS deployment

This directory owns the independently deployable CAS service environment. Implementation code
remains under `packages/`; this directory owns local orchestration and
Cloudflare deployment order.

```text
pnpm dev
pnpm dev --docker
pnpm deploy:plan
pnpm deploy:production
pnpm deploy:site:plan
pnpm deploy:site
pnpm docs:check
pnpm deploy:docs:plan
pnpm deploy:docs
pnpm smoke -- [baseUrl]
pnpm smoke:v1 -- [baseUrl]   # frozen compatibility only
```

Production deploys one `@unicas/service-cloudflare` Worker containing the
Space and App admin HTTP service, admin BFF/UI, MCP ingress, and public routing.
The default smoke entry exercises App/Space v2 and expects provisioned App
credentials under the gitignored `.wrangler/cas-deploy/` directory.

The product apex is a separate assets-only Worker under `site/`. Its deployment
has no service bindings or secrets and must never claim the API, console, or
documentation origins.

The generated documentation site is a second assets-only Worker under
`docs-site/`. `pnpm docs:build` renders the accepted repository Markdown into
gitignored static output and fails on unresolved local links. Its deployment
owns only `docs.unicas.work` and has no service bindings or secrets.

## Managed issuer

When the Worker has both managed-issuer bindings, every newly created App
receives an active, UniCAS-managed issuer. The issuer URL is logically unique:

```text
https://<public-origin>/managed-issuers/<appId>
```

The URL is server-derived and cannot be changed. Existing Apps that predate
managed issuers expose the same fixed URL in a disabled revision-zero state;
their first enable provisions the binding atomically.

The deployment uses one ES256 signing key across those logical issuers. Set
`MANAGED_ISSUER_KEY_ID` as a non-secret Wrangler var and
`MANAGED_ISSUER_PRIVATE_KEY_PKCS8` as a Wrangler secret. A local key can be
generated with `pnpm keys:local`; use the resulting `kid` and
`privateKeyPkcs8` fields without committing the generated file.

Only current App members can mint managed capabilities through the admin BFF.
Each `(App, Principal issuer, subject)` maps to a stable isolated personal
Space. Capabilities expire after one hour and include read, write, and manage
for that Space. The Playground keeps the bearer only in React state.

Managed issuer metadata and JWKS are public only while that issuer remains
active for the App. A custom issuer has an independent lifecycle and can be
active at the same time. Protected-resource discovery lists the active custom
issuer first, so CLI login prefers it, then lists the managed issuer as the
fallback. Disabling managed issuance stops new managed capabilities
immediately, while already issued tokens age out according to their expiry and
verifier cache bounds.

Rotate the deployment signing key with overlap: deploy a JWKS/key-ring capable
revision before switching `MANAGED_ISSUER_KEY_ID`. The current implementation
holds one active managed key, so a no-downtime production rotation requires
adding key-ring support before changing the configured key.
# UniCAS deployment

This directory owns the independently deployable CAS service environment. Implementation code
remains under `packages/`; this directory owns local orchestration and
Cloudflare deployment order.

```text
pnpm dev
pnpm dev --docker
pnpm deploy:plan
pnpm deploy:production
pnpm deploy:spaces:plan
pnpm deploy:spaces
pnpm deploy:site:plan
pnpm deploy:site
pnpm docs:check
pnpm deploy:docs:plan
pnpm deploy:docs
pnpm smoke -- [baseUrl]
pnpm spaces:smoke -- --base-url <url>
pnpm smoke:v1 -- [baseUrl]   # frozen compatibility only
```

Production deploys one `@unicas/service-cloudflare` Worker containing the
Space and App admin HTTP service, admin BFF/UI, MCP ingress, and public routing.
The default smoke entry exercises App/Space v1 and expects provisioned App
credentials under the gitignored `.wrangler/cas-deploy/` directory.

The independently deployed `@unicas/spaces` file App owns
`spaces.unicas.work`, its own D1 catalog, user sessions, issuer keys, and
release smoke credential. Its deployment composition and migrations live under
`spaces/`; application source remains under `packages/spaces`. See
[`docs/spaces-smoke-app.md`](../../docs/spaces-smoke-app.md) for bootstrap,
rotation, cleanup, and recovery.

The product apex is a separate assets-only Worker under `site/`. Its deployment
has no service bindings or secrets and must never claim the API, console, or
documentation origins.

The generated documentation site is a second assets-only Worker under
`docs-site/`. `pnpm docs:build` renders the accepted repository Markdown into
gitignored static output and fails on unresolved local links. Its deployment
owns only `docs.unicas.work` and has no service bindings or secrets.

## OAuth issuers

Apps use independently operated external OAuth authorization servers. An App
administrator inspects and activates an issuer through the control plane; the
data plane then resolves the active issuer metadata and verifies its JWT
capabilities. UniCAS does not provision an issuer, issue access tokens, or
derive a personal Space from App membership.

The one-time production procedure for removing the retired first-party issuer
is documented in
[`docs/managed-issuer-retirement.md`](../../docs/managed-issuer-retirement.md).
# UniCAS

UniCAS is an independently deployable content-addressed storage service with
an App/Space data plane and App administrator access plane. This repository contains its portable
service core, Cloudflare deployment adapter, protocol packages, clients, CLI,
and administrator console.

- Product service: <https://unicas.work>
- Documentation: <https://docs.unicas.work>

## Requirements

- Node.js 24 or newer
- pnpm 11

## Development

```powershell
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm dev
```

`pnpm dev` starts the Cloudflare Worker locally, a mock OIDC provider, and the
administrator console at <http://localhost:4070/admin/>. Local state is stored
under `.wrangler/`.

Use Docker when a host Node.js environment is not available:

```powershell
pnpm dev --docker
```

## Deployment

The committed Wrangler configuration targets the live production resources.
Review `packages/service-cloudflare/wrangler.toml`, configure the required
Cloudflare secrets, and verify the active account before deploying.

```powershell
pnpm deploy:plan
pnpm deploy:production
pnpm smoke
```

`pnpm deploy` intentionally refuses to run without that explicit production
entry point. Neither command should be used for a named Wrangler environment;
see `docs/deployment-and-local-configuration.md` for isolated environment
requirements.

Architecture and operations documentation lives under `docs/`. Package
boundaries and dependency rules are documented in
`packages/README.md`.

The accepted origin architecture is documented in
[`docs/domain-topology.md`](docs/domain-topology.md). The accepted App/Space
resource vocabulary is documented in
[`docs/terminology.md`](docs/terminology.md).

Repository work is tracked alongside the code under [`tasks/`](tasks/README.md).
New work starts in `backlog/`, moves to `ongoing/` with a maintained
`Progress.md`, and finishes in `archived/` whether completed or abandoned.

Report suspected vulnerabilities privately as described in
[`SECURITY.md`](SECURITY.md).

UniCAS is available under the [MIT License](LICENSE).
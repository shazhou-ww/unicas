# UniCAS

UniCAS is an independently deployable content-addressed storage service with
an App/Space data plane and App administrator access plane. This repository contains its portable
service core, Cloudflare deployment adapter, protocol packages, clients, CLI,
and administrator console.

- Product service: <https://unicas.work>
- File App: <https://spaces.unicas.work>
- Documentation: <https://docs.unicas.work>

## Requirements

- Node.js 24 or newer
- pnpm 11

## Development

```powershell
pnpm install
pnpm validate
pnpm dev
```

`pnpm dev` starts the Cloudflare Worker locally, a mock OIDC provider, and the
administrator console at <http://localhost:4070/admin/>. Local state is stored
under `.wrangler/`.

### Test suites

| Scenario | Command | Coverage |
| --- | --- | --- |
| Routine changes outside the Cloudflare adapter | `pnpm test:quick` | Repository checks and every package test except `@unicas/service-cloudflare` |
| One package | `pnpm --filter <package> test` | The selected package only |
| All package tests | `pnpm test:packages` | Every package test, without repository checks |
| Before delivery | `pnpm validate` | Canonical branch/PR/`main` gate: repository policy, package tests except the slow Cloudflare adapter suite, build, and typecheck |
| Before release | `pnpm validate:release` | Strict superset with the Cloudflare adapter and release-policy suites, SDK artifacts, browser coverage, deployment dry-runs, and release planner checks |

Use `pnpm validate` for changes to `packages/service-cloudflare`, shared test
orchestration, or repository-wide behavior. Local delivery and ordinary CI run
the same command. The complete trigger and trust-boundary matrix is documented
in [`docs/validation-and-release-workflows.md`](docs/validation-and-release-workflows.md).

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
pnpm deploy:spaces:plan
pnpm smoke
pnpm spaces:smoke -- --base-url https://spaces.unicas.work
```

`pnpm deploy` intentionally refuses to run without that explicit production
entry point. Neither command should be used for a named Wrangler environment;
see `packages/docs-site/content/deployment-and-local-configuration.md` for
isolated environment requirements.

Published architecture, integration, and operations documentation lives under
`packages/docs-site/content/` and is served at <https://docs.unicas.work>.
Repository-development documentation remains indexed under `docs/`. Package
boundaries and dependency rules are documented in `packages/README.md`.

The accepted origin architecture is documented in
[`packages/docs-site/content/domain-topology.md`](packages/docs-site/content/domain-topology.md).
The accepted App/Space resource vocabulary is documented in
[`packages/docs-site/content/terminology.md`](packages/docs-site/content/terminology.md).

Repository work is tracked alongside the code under stable [`tasks/`](tasks/)
paths, with lifecycle state recorded in [`tasks/status.yaml`](tasks/status.yaml).
The workflow is documented in
[`docs/repository-tasks.md`](docs/repository-tasks.md).

Report suspected vulnerabilities privately as described in
[`SECURITY.md`](SECURITY.md).

UniCAS is available under the [MIT License](LICENSE).

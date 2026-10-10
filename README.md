# UniCAS

UniCAS is an independently deployable content-addressed storage service with
an App/Space data plane and App administrator access plane. This repository contains its portable
service core, Cloudflare deployment adapter, protocol packages, clients, CLI,
and administrator console.

- Product service: <https://unicas.work>
- File App: <https://spaces.unicas.work>
- Documentation: <https://docs.unicas.work>

## App-user SDK

UniCAS publishes one unified-version, ESM-only App-user SDK for the App/Space
v1 data plane:

| Package | Choose it for |
| --- | --- |
| `@unicas/codec` | Canonical node encoding, hashing, and validation |
| `@unicas/space-protocol` | App/Space contracts, schemas, capability vocabulary, and OpenAPI |
| `@unicas/space-client` | Thin Space-bound HTTP operations |
| `@unicas/space-blob-client` | Chunked blobs, random access, and retain/release |
| `@unicas/space-browser-cache` | Authenticated browser caching for immutable reads |
| `@unicas/space-file-client` | App-owned file catalogs and committed working trees |

Start with the [SDK package guide](https://docs.unicas.work/app-user-api/sdk/),
then run the
[packed-artifact quickstarts](https://docs.unicas.work/app-user-api/quickstart/).
Compatibility, versioning, TypeScript API, troubleshooting, changelog, support,
and security links are indexed from the SDK guide.

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
| Before delivery | `pnpm validate` | Canonical local and `main` pre-push gate: repository policy, package tests except the slow Cloudflare adapter suite, build, and typecheck |
| Before release | `pnpm validate:release` | Strict superset with the Cloudflare adapter and release-policy suites, SDK artifacts, browser coverage, deployment dry-runs, and release planner checks |

Use `pnpm validate` for changes to `packages/service-cloudflare`, shared test
orchestration, or repository-wide behavior. Local delivery and the
repository-managed hook for updates targeting `main` run the same command.
Ordinary branch, pull-request, and `main` pushes do not start full hosted
validation; release candidates and explicit preflight do. The complete trigger
and trust-boundary matrix is documented in
[`docs/validation-and-release-workflows.md`](docs/validation-and-release-workflows.md).

Use Docker when a host Node.js environment is not available:

```powershell
pnpm dev --docker
```

## Deployment

The committed Wrangler configuration targets the live production resources.
Review `packages/service-cloudflare/wrangler.toml`, configure the required
Cloudflare secrets, and verify the active account before deploying.

```powershell
pnpm release:service:plan
pnpm release:service:production
pnpm release:spaces:plan
pnpm release:service:smoke
pnpm release:spaces:smoke -- --base-url https://spaces.unicas.work
```

There is no implicit root deployment command; every production entry point is
unit-scoped and explicit. These commands should not be used for a named Wrangler environment;
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

Long-running repository work is captured as layered Silvermoon ideas under
stable [`.silvermoon/ideas/`](.silvermoon/ideas/) paths. The workflow is
documented in
[`docs/repository-ideas.md`](docs/repository-ideas.md).

Report suspected vulnerabilities privately as described in
[`SECURITY.md`](SECURITY.md).

UniCAS is available under the [MIT License](LICENSE).

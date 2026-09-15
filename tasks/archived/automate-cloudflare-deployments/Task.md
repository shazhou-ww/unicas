# Automate Cloudflare production deployments

Created: 2026-09-14

## Goal

Automatically deploy each validated `main` revision from GitHub Actions to the
three production Cloudflare Workers and verify the resulting public services
without requiring a developer machine.

## Context

The existing GitHub Actions workflow validates pushes and pull requests but
stops after build, test, typecheck, and Wrangler dry-run checks. Production is
currently released manually through the repository's explicit service,
product-site, and documentation-site deploy commands.

The service deployment also runs the canonical production smoke flow and needs
an explicitly provisioned stack identity and signing key. Worker runtime
secrets are already provisioned in Cloudflare and must remain separate from the
GitHub deployment identity and smoke credentials.

## Scope

- Extend GitHub Actions with a production deployment path that runs only for a
  validated commit on `main`, plus an explicit manual recovery trigger limited
  to `main`.
- Use one GitHub `Production` environment for deployment policy and secret
  access, and document every required GitHub variable or secret by name.
- Authenticate Wrangler with a dedicated, least-privilege Cloudflare API token
  and account ID scoped to the production account and required zone.
- Deploy the API/console service, product site, and documentation site through
  the existing `pnpm deploy:production`, `pnpm deploy:site`, and
  `pnpm deploy:docs` entry points in a deterministic sequence.
- Materialize the smoke signing key only as an ephemeral, permission-restricted,
  gitignored file; map the remaining `UNICAS_SMOKE_*` configuration from the
  GitHub environment; and remove the file even when deployment fails.
- Serialize production deployments so concurrent workflow runs cannot race
  Worker versions, routes, Durable Object migrations, or post-deploy checks.
- Add workflow regression checks and operator documentation covering setup,
  normal releases, failure diagnosis, manual retry, credential rotation, and
  rollback to a known Worker version.
- Verify the API with the canonical smoke suite and verify the product and
  documentation origins over HTTPS after deployment.

## Out of scope

- Adding a staging environment or preview deployments.
- Creating or changing Cloudflare accounts, zones, custom domains, storage
  resources, bindings, routes, or Worker runtime secrets.
- Automatically rotating runtime or smoke signing keys.
- Implementing automatic rollback after a failed deployment or smoke test.
- Deploying or modifying the frozen `unicas.shazhou.work` environment.
- Changing application, protocol, storage, or documentation content unrelated
  to release automation.

## Acceptance criteria

- [x] Pull requests and non-`main` pushes run CI without receiving production
      secrets and cannot invoke a production Wrangler deployment.
- [x] A push to `main` deploys only after the existing validation job succeeds,
      and the deployed artifacts are built from that workflow's exact commit.
- [x] A manual production run is available from `main` and follows the same
      validation, environment, deployment, and verification path.
- [x] Production runs use minimal GitHub token permissions, a GitHub
  `Production` environment, and a deployment concurrency group that does
      not interrupt an in-progress release.
- [x] The dedicated Cloudflare token can perform the required deployments but
      is not granted unrelated account or zone permissions.
- [x] The API/console Worker, product-site Worker, and documentation Worker are
      deployed through their repository-owned commands in a documented,
      deterministic order, stopping on the first failure.
- [x] The production smoke flow passes against `https://api.unicas.work` using
      environment-scoped credentials, without logging or retaining the private
      signing key.
- [x] Post-deploy checks confirm the expected HTTPS behavior at
      `api.unicas.work`, `console.unicas.work`, `unicas.work`, and
      `docs.unicas.work`.
- [x] Worker runtime secrets remain stored only in Cloudflare and are neither
      copied into GitHub nor rewritten on routine deployments.
- [x] A failed validation, deployment, or post-deploy check leaves a failed
      GitHub Actions run with enough non-secret context to identify the failed
      deployment unit.
- [x] Workflow regression tests, repository checks, build, typecheck, package
      tests, all Wrangler dry-runs, and GitHub CI pass.

## Constraints

- Preserve `pnpm deploy` as a refusal path; production service releases must use
  the explicit `pnpm deploy:production` command and may not skip smoke.
- Keep all production deployment steps within the protected GitHub environment
  boundary and never expose its secrets to pull requests or forked workflows.
- Store only secret names and provisioning procedures in the repository. Never
  commit API tokens, private keys, or generated credential files.
- Keep the smoke key file under the existing gitignored deployment credential
  boundary, apply owner-only permissions on the runner, and guarantee cleanup.
- Do not weaken existing validation or independent Worker ownership to reduce
  deployment time.
- Prefer the repository's current pnpm and Wrangler entry points over a second
  deployment implementation in workflow YAML.
- A partial release must fail closed, retain prior Cloudflare versions for
  operator rollback, and not trigger an automatic redeploy loop.

## References

- [Current GitHub Actions workflow](../../../.github/workflows/ci.yml)
- [Deployment and local configuration](../../../docs/deployment-and-local-configuration.md)
- [Operations guide](../../../docs/cas-operations.md)
- [UniCAS stack deployment boundary](../../../stacks/unicas/README.md)
- [Production deployment orchestrator](../../../stacks/unicas/deploy/deploy.mjs)

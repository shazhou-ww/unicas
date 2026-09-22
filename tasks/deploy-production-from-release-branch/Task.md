# Deploy production from the release branch

Created: 2026-09-15

## Goal

Keep `main` as the frequently updated development branch while allowing only
validated revisions promoted to `release` to deploy the production Cloudflare
Workers.

## Context

The protected production job currently deploys every validated push to
`main`. That makes ordinary development integration a production release. The
existing validation, exact-SHA checkout, `Production` environment, serialized
deployment, canonical smoke, and post-deploy probes should remain unchanged;
only the branch promotion boundary should move.

No remote `release` branch exists yet. The GitHub `Production` environment
currently allows `main`, so the workflow, environment policy, and branch must
be switched in a sequence that never exposes production credentials to both
development and release branches.

## Scope

- Gate automatic and manual production deployment on `refs/heads/release`.
- Continue running validation for pushes and pull requests on all branches.
- Create `release` from the validated policy-change revision and use explicit
  promotion from `main` as the normal release operation.
- Change the GitHub `Production` environment deployment policy to allow only
  `release` before the first release-branch deployment.
- Update workflow regression coverage and operator documentation for normal
  promotion, manual retry, and branch protection.
- Verify that a `main` push skips production and a `release` push completes the
  existing service, product-site, documentation, smoke, and HTTPS checks.

## Out of scope

- Changing the three Worker deployment commands, order, credentials, runtime
  secrets, routes, bindings, or rollback behavior.
- Adding staging or preview environments.
- Rewriting Git history or automatically merging development changes into
  `release`.
- Changing the frozen `unicas.shazhou.work` environment.

## Acceptance criteria

- [x] Pushes and pull requests on `main` and other non-`release` branches run
      validation without entering the `Production` environment.
- [x] A push to `release` deploys only after validation succeeds and uses that
      workflow run's exact commit.
- [x] Manual production recovery can run only when `release` is selected and
      follows the same validation and deployment path.
- [x] The GitHub `Production` environment allows only the `release` branch.
- [x] The remote `release` branch is created without rewriting history and has
      an explicit documented promotion workflow from `main`.
- [x] Existing deployment serialization, credential isolation, smoke cleanup,
      Worker order, and public-origin checks remain covered by regression
      tests.
- [x] Repository checks and GitHub CI pass, including a skipped production job
      for the policy commit on `main` and a successful production job for the
      corresponding `release` revision.

## Constraints

- Do not weaken validation or expose production secrets to `main`, pull
  requests, forks, or arbitrary manual refs.
- Keep `release` as a promotion branch rather than a second development line;
  normal promotion should preserve ancestry from `main`.
- Keep the existing `Production` environment and deployment concurrency group.
- Do not push the first `release` revision until its environment branch policy
  is confirmed.

## References

- [GitHub Actions workflow](/.github/workflows/ci.yml)
- [Deployment and local configuration](/packages/docs-site/content/deployment-and-local-configuration.md)
- [Operations guide](/packages/docs-site/content/cas-operations.md)
- [Deployment regression tests](/tests/deploy-plan.test.mjs)
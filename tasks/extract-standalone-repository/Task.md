# Extract and publish the standalone UniCAS repository

Created: 2026-09-14

## Goal

Create an independently buildable, testable, and publishable UniCAS repository
without modifying the original UniDocs monorepo or breaking legacy deployment
contracts.

## Context

UniCAS originally lived inside a larger application monorepo. Its packages,
deployment adapter, local runtime, documentation, and retained Git history
needed to become an independent source of truth.

## Scope

- Extract the UniCAS packages and relevant history.
- Establish the standalone pnpm and TypeScript workspace.
- Validate host and Docker development paths.
- Add repository boundary, OpenAPI drift, test, build, and deployment gates.
- Add license, security policy, task-independent documentation, and CI.
- Publish the repository to GitHub without overwriting another repository.

## Out of scope

- Removing UniCAS from the original monorepo.
- Migrating downstream consumers.
- Renaming compatibility media types, issuer identifiers, or legacy resources.
- Performing the later App/Space or public-domain migrations.

## Acceptance criteria

- [x] Standalone repository is published on `main`.
- [x] Install, build, typecheck, tests, host runtime, and Docker runtime pass.
- [x] Wrangler dry-run and production-safe deployment guards pass.
- [x] Full-history and current-tree secret scans pass.
- [x] CI validates the standalone workspace.
- [x] Legacy deployment remains unchanged.

## Constraints

- Preserve relevant Git history without retaining the entire source monorepo.
- Never commit local credentials, generated output, or `.wrangler` state.
- Keep legacy wire/resource identifiers compatible unless separately planned.
- Do not force-push over unexpected destination content.

## References

- [Repository README](/README.md)
- [Package boundaries](/packages/README.md)
- [Deployment and local configuration](/packages/docs-site/content/deployment-and-local-configuration.md)
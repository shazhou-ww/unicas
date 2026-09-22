# Progress

Updated: 2026-09-22

## Current state

The documentation site is now the private `@unicas/docs-site` workspace
package. It owns the renderer, 17 published Markdown sources, browser assets,
unit and browser tests, generated artifact, dependencies, and assets-only
Wrangler configuration. Root commands delegate to the package, and CI invokes
its build, test, browser, typecheck, provenance, and deployment-plan boundaries
directly.

The explicit 24-page inventory preserves every reviewed public route and
records title, navigation category, canonical source, owner, and lifecycle.
Package READMEs and the root glossary remain canonical with their owners. The
Space API reference resolves the exported `@unicas/space-protocol/openapi.json`
artifact and records its SHA-256 digest without copying a schema into source.

Published documents moved from `docs/` to `packages/docs-site/content/`. The
private Spaces operations guide moved to `packages/spaces/README.md`, while
`docs/` now contains only its boundary index, repository task workflow, and the
historical managed-issuer retirement procedure. Maintained repository links,
generated edit links, task artifact links, and product-site source links now
resolve to the canonical locations.

Implementation and agent-verifiable acceptance checks are complete. The next
action is source publication, primary integration, and delivery acceptance for
the exact integrated commit.

## Decisions

- Preserve the existing custom Node/Marked/esbuild static renderer and Scalar
  API reference. Do not introduce a documentation framework or redesign the UI
  during this ownership refactor.
- Keep all existing routes, navigation labels, heading anchors, static asset
  URLs, OpenAPI download URL, trailing-slash behavior, and 404 behavior.
- Keep browser layout and orchestration improvements outside this task; the
  requesting user will provide separate feedback against the migrated site.
- Resolve OpenAPI through the package export and fail on tracked-schema drift,
  copied-byte drift, or digest drift.
- Emit deterministic static output plus a non-secret artifact manifest. Record
  a source revision only when CI explicitly supplies a full Git commit.
- Run unit/artifact tests as the package's default workspace test. Run the
  Chrome responsive/API-reference suite as a separate explicit CI step so it
  does not contend with parallel Miniflare package tests.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | The requesting user explicitly approved [Task.md](./Task.md) on 2026-09-22. The approval was bound to primary revision `fe4ea06774f60a08998b2e54ac83e48bd02faf5a`. |
| Interface | Approved | The requesting user explicitly approved [ContentInventory.md](./ContentInventory.md) on 2026-09-22 at refreshed primary revision `1749a3e7ad19dbb50a37e82adf10ba29169c88dd`, preserving the reviewed route set and deferring later site-composition feedback. |
| Architecture | Approved | The requesting user explicitly approved [Architecture.md](./Architecture.md) on 2026-09-22 at refreshed primary revision `1749a3e7ad19dbb50a37e82adf10ba29169c88dd`, with refactoring as the task's primary goal and no framework migration. |
| Business and data model | Not applicable | Documentation packaging changes no domain entity, ownership, persistence, lifecycle, or migration semantics. |
| Delivery acceptance | Pending | Requires the exact integrated primary commit and final artifact, route, and validation evidence. |

## Validation

- `pnpm --filter @unicas/docs-site test`: 7 content-inventory, route, link,
  artifact, determinism, provenance, and OpenAPI-digest tests passed.
- `pnpm --filter @unicas/docs-site test:browser`: 3 Chrome checks passed for
  desktop layout, mobile navigation/overflow, and rendered Scalar/OpenAPI.
- `pnpm --filter @unicas/docs-site typecheck`: strict JavaScript and browser
  test typechecking passed.
- `pnpm --filter @unicas/docs-site deploy:plan`: built 24 pages and 59 static
  files; Wrangler dry-run reported no bindings.
- `pnpm check:openapi`: all 3 generated OpenAPI documents matched source.
- `pnpm check:tasks`: all moved-document links resolve; only existing unrelated
  warning and legacy notices remain.
- `pnpm vitest run tests/workspace-boundaries.test.mjs`: all 93 package,
  dependency, reference, and standalone-boundary tests passed.
- `pnpm vitest run tests/deploy-plan.test.mjs`: all 36 CI, release-order, and
  deployment-isolation tests passed.
- `pnpm build`: all 15 workspace package build targets passed.
- `pnpm typecheck`: all 15 workspace package typecheck targets passed.
- `pnpm test:exhaustive`: canonical repository checks and all 15 workspace
  package test targets passed after browser validation was separated into its
  explicit CI step. The Cloudflare adapter contributed 267 passing tests.

## Blockers

- None for source publication or primary integration. Delivery acceptance is
  the remaining human checkpoint.

## Outcome

The existing documentation site is now a coherent private workspace and
deployment package with package-owned public content, deterministic evidence,
direct CI coverage, and unchanged public behavior. Repository `docs/` is an
explicit development-documentation boundary rather than an implicit site
source, and later layout feedback can proceed independently of this refactor.

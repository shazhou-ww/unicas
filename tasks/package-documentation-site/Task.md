# Package the UniCAS documentation site

Created: 2026-09-22

## Goal

Turn the existing UniCAS documentation site into a private, independently
buildable, testable, and deployable workspace package, with published service
documentation owned by that package and the repository-level `docs/` directory
reserved for contributor and development documentation.

## Context

`docs.unicas.work` is already an independently deployed assets-only Cloudflare
site, and the repository already generates an interactive Space API reference
from the canonical OpenAPI document. Its implementation is not yet a coherent
package: the renderer and static assets live under `stacks/`, dependencies and
commands are owned by the workspace root, tests live under the root test tree,
and published source documents are mixed with repository-development material
under `docs/`.

The completed `deploy-documentation-site` task established the public origin
and deployment isolation. The completed `document-app-user-api` task established
the App-user guide. This task preserves those outcomes while making ownership,
build inputs, release artifacts, and documentation classification explicit.
The resulting package is a deployment unit, not a public npm library.

## Scope

- Create a private `@unicas/docs-site` workspace package that owns the site
  renderer, browser assets, package-local tests, build dependencies, generated
  output, and assets-only Cloudflare deployment configuration.
- Give the package direct build, test, clean, and deployment dry-run commands
  that work through its workspace identity; retain concise root commands only
  as delegating repository entry points.
- Inventory and classify the current documentation as published service
  standards, integration guidance, operations guidance, historical or legacy
  reference, or repository-development material.
- Move every document intentionally published by the site from `docs/` into a
  package-owned content tree while preserving a clear canonical source for
  each page. Keep `docs/` only for repository contributor, test, release
  engineering, and other development documentation, with an index that states
  that boundary.
- Keep package-specific README files with their owning packages. The docs-site
  build may render selected package references, but it must not create a second
  canonical copy of those files.
- Continue deriving the interactive API reference from the generated
  `@unicas/space-protocol` OpenAPI artifact. Do not copy or hand-maintain a
  competing HTTP schema in the docs-site package.
- Define an explicit content and route inventory so every published page has a
  stable route, title, category, source path, and lifecycle classification.
- Preserve existing public documentation URLs unless an interface review
  explicitly approves a redirect or removal. Keep `docs.unicas.work` isolated
  from the API, Console, product site, and their credentials or bindings.
- Produce a self-contained static deployment artifact containing the rendered
  pages, assets, OpenAPI document, not-found page, link-check result, and
  non-secret build metadata sufficient to identify the documentation and API
  contract revision represented by the artifact.
- Update repository links, source-edit links, package-boundary documentation,
  root scripts, CI checks, and deployment tests for the new canonical paths;
  leave no dangling references to moved public documents or the former site
  implementation location.
- Validate package-local builds and tests, generated links and routes,
  OpenAPI drift, workspace boundaries, clean artifact contents, desktop and
  mobile usability, and a Wrangler deployment dry-run.

## Out of scope

- Changing HTTP routes, request or response schemas, capability semantics,
  storage behavior, SDK behavior, or administrator-plane behavior.
- Publishing the docs-site package to npm or adding it to the public App-user
  SDK package set, npm provenance workflow, or dist-tag policy.
- Moving canonical package README files away from their owning packages or
  duplicating their content solely to make the site package source-isolated.
- Redesigning the documentation UI or changing established public routes as
  part of the package-boundary migration.
- Rewriting accepted architecture, protocol, authorization, or operations
  decisions except for path corrections, classification metadata, and small
  consistency fixes required by the move.
- Moving documentation routes into the API or Console Worker, adding service
  bindings or credentials to the docs deployment, or modifying frozen legacy
  Cloudflare resources.
- Performing the App-user beta production promotion; the existing promotion
  task consumes the validated documentation artifact and owns release-level
  production acceptance.

## Acceptance criteria

- [ ] `packages/docs-site/` is a private workspace package with coherent
      metadata and package-owned build, test, clean, and deployment-plan
      commands.
- [ ] The package owns its renderer, browser assets, tests, published content,
      generated output convention, and assets-only Wrangler configuration;
      the workspace root contains only deliberate delegating commands.
- [ ] A reviewed inventory classifies every former `docs/` document, and every
      document rendered at `docs.unicas.work` has one canonical source under
      the docs-site package or its owning package.
- [ ] The remaining `docs/` tree contains only clearly indexed repository
      contributor, test, release-engineering, or development documentation and
      is not an implicit source directory for the public site.
- [ ] Existing public documentation routes continue to render equivalent
      content, navigation, anchors, source links, static assets, OpenAPI
      download, and not-found behavior unless a reviewed route map explicitly
      records an approved change and compatibility treatment.
- [ ] The interactive reference consumes the generated public App/Space v1
      OpenAPI artifact from `@unicas/space-protocol`; package and repository
      checks fail on schema drift or an untracked duplicate contract.
- [ ] A clean package build emits a self-contained static artifact plus
      non-secret metadata that identifies the docs-site version, source
      revision when supplied by CI, included page inventory, and OpenAPI
      digest.
- [ ] Repository-local and generated links resolve after the content move,
      including links from the root README, package documentation, task
      artifacts, code comments, tests, and generated “Edit source” targets.
- [ ] CI invokes the package boundary directly and covers package build and
      tests, link and route validation, workspace boundaries, OpenAPI drift,
      clean artifact contents, responsive browser checks, and Wrangler
      dry-run without credentials.
- [ ] The docs deployment remains an independent assets-only Worker for the
      exact `docs.unicas.work` custom domain and has no API, data-plane,
      administrator, OAuth, storage, or secret binding.
- [ ] Focused package checks, repository checks, build, typecheck, exhaustive
      tests, and deployment dry-run pass from a clean checkout.
- [ ] The user explicitly accepts the packaged documentation site, content
      classification, stable route map, generated artifact evidence, and
      repository documentation boundary for the exact reviewed primary
      commit.

## Constraints

- Preserve `@unicas/space-protocol` source and generated OpenAPI as the
  machine-readable API contract. The site is a versioned presentation of that
  contract, not a second authority.
- Treat source location, public URL, and package version as separate concerns:
  moving a Markdown file must not silently change its public route or imply an
  HTTP API version change.
- Keep the docs-site package private and deployment-focused. Its static output
  may be archived as release evidence, but npm publication requires a separate
  reviewed outcome.
- Keep the deployment artifact deterministic apart from explicitly supplied
  provenance metadata, and never embed credentials, bearer material, private
  keys, local absolute paths, customer data, or unreviewed environment values.
- Preserve the administrator and Space access-plane separation and the
  repository prohibition on runtime `@unidocs/*` dependencies.
- Use forward edits and normal non-force publication. Do not modify or roll
  back the existing production documentation origin outside the protected
  release workflow.

## Human review checkpoints

Task registration records this plan, not approval. Each required artifact must
be reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's package boundary, content-migration scope, exclusions, acceptance criteria, and relationship to the existing documentation and beta-promotion tasks. | Substantive implementation. |
| Interface | Required | Requesting user or delegated API/documentation owner | Task-local content inventory and public route map covering canonical source paths, lifecycle classification, stable URLs, OpenAPI source, redirects if any, and “Edit source” behavior. | Moving published sources, changing navigation, or changing any public documentation route or compatibility behavior. |
| Business and data model | Not applicable: the task relocates and packages documentation without changing domain entities, ownership, persistence, lifecycle, or migration semantics. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user or delegated package/deployment owner | Task-local package design covering source ownership, workspace dependencies, build inputs and outputs, artifact metadata, Cloudflare configuration ownership, CI integration, and deployment isolation. | Creating the package, moving build or deployment ownership, or changing workspace and CI configuration. |
| Delivery acceptance | Required | Requesting user | Exact primary revision, packaged site and content inventory, route-compatibility evidence, generated artifact inventory, focused and repository validation, responsive review, and Wrangler dry-run result. | Running `task complete` for the exact approved primary commit. |

## References

- [Existing documentation deployment task](../deploy-documentation-site/Task.md)
- [Existing App-user documentation task](../document-app-user-api/Task.md)
- [App-user beta promotion task](../promote-app-user-api-to-beta/Task.md)
- [Package and deployment boundaries](/packages/README.md)
- [Current documentation site builder](/stacks/unicas/docs-site/build.mjs)
- [Repository task workflow](/docs/repository-tasks.md)
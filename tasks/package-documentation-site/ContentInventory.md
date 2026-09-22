# Documentation content and route review

Status: Awaiting interface approval.

## Decision requested

Approve the canonical source destinations, lifecycle classifications, and
compatibility treatment below. Approval permits moving the published Markdown
sources into `packages/docs-site/content/`, moving the private Spaces operations
guide to its owning package, and updating source links and navigation metadata.

No public route, heading, navigation label, asset URL, OpenAPI URL, or not-found
behavior changes in this migration. No redirects or aliases are proposed.

## Classification rules

- **Published service standard** defines accepted architecture, terminology,
  protocol, topology, or generated contract behavior.
- **Integration guidance** explains how an App developer or administrator uses
  a supported public interface.
- **Operations guidance** explains deployment, observability, recovery, or
  production operation.
- **Historical or legacy reference** remains available for compatibility or
  migration context but is not the current service contract.
- **Repository-development material** governs contribution, testing, task, or
  release-engineering work and is not published on the service documentation
  site.

Navigation section and lifecycle classification are independent. For example,
the prototype migration guide remains under the `Integrate` navigation section
while being classified as historical reference.

## Published Markdown sources

All routes remain trailing-slash routes. The move changes only the canonical
repository source shown in the final column.

| Stable route | Title | Navigation | Lifecycle | Current source | Canonical source after move |
| --- | --- | --- | --- | --- | --- |
| `/app-user-api/` | App-user API | Integrate | Integration guidance | `/docs/app-user-api/README.md` | `/packages/docs-site/content/app-user-api/README.md` |
| `/app-user-api/scenarios/` | App-user scenarios | Integrate | Integration guidance | `/docs/app-user-api/scenarios.md` | `/packages/docs-site/content/app-user-api/scenarios.md` |
| `/app-user-api/http-api/` | App-user HTTP API | Integrate | Integration guidance | `/docs/app-user-api/http-api.md` | `/packages/docs-site/content/app-user-api/http-api.md` |
| `/app-user-api/authorization/` | App-user authorization | Integrate | Integration guidance | `/docs/app-user-api/authorization.md` | `/packages/docs-site/content/app-user-api/authorization.md` |
| `/app-user-api/migration-v2-to-v1/` | Prototype v2 migration | Integrate | Historical or legacy reference | `/docs/app-user-api/migration-v2-to-v1.md` | `/packages/docs-site/content/app-user-api/migration-v2-to-v1.md` |
| `/cas-architecture/` | CAS Architecture | Architecture | Published service standard | `/docs/cas-architecture.md` | `/packages/docs-site/content/cas-architecture.md` |
| `/cas-binary-format/` | CAS Binary Format | Architecture | Published service standard | `/docs/cas-binary-format.md` | `/packages/docs-site/content/cas-binary-format.md` |
| `/cas-state-protection-and-gc/` | State Protection and GC | Architecture | Published service standard | `/docs/cas-state-protection-and-gc.md` | `/packages/docs-site/content/cas-state-protection-and-gc.md` |
| `/domain-topology/` | Domain Topology | Architecture | Published service standard | `/docs/domain-topology.md` | `/packages/docs-site/content/domain-topology.md` |
| `/terminology/` | Terminology | Architecture | Published service standard | `/docs/terminology.md` | `/packages/docs-site/content/terminology.md` |
| `/cas-control-plane-cli/` | Control-Plane CLI | Control plane | Integration guidance | `/docs/cas-control-plane-cli.md` | `/packages/docs-site/content/cas-control-plane-cli.md` |
| `/cas-control-plane-mcp/` | Control-Plane MCP | Control plane | Integration guidance | `/docs/cas-control-plane-mcp.md` | `/packages/docs-site/content/cas-control-plane-mcp.md` |
| `/cas-oauth-discovery-and-issuer-migration/` | OAuth Discovery and Issuer Migration | Control plane | Operations guidance | `/docs/cas-oauth-discovery-and-issuer-migration.md` | `/packages/docs-site/content/cas-oauth-discovery-and-issuer-migration.md` |
| `/cas-operations/` | Operations | Operate | Operations guidance | `/docs/cas-operations.md` | `/packages/docs-site/content/cas-operations.md` |
| `/deployment-and-local-configuration/` | Deployment and Local Configuration | Operate | Operations guidance | `/docs/deployment-and-local-configuration.md` | `/packages/docs-site/content/deployment-and-local-configuration.md` |
| `/observability/` | Observability | Operate | Operations guidance | `/docs/observability.md` | `/packages/docs-site/content/observability.md` |
| `/cas-tenant-debug-tools/` | Legacy Tenant Debug Tools | Operate | Historical or legacy reference | `/docs/cas-tenant-debug-tools.md` | `/packages/docs-site/content/cas-tenant-debug-tools.md` |

The content move preserves each Markdown file without an editorial rewrite.
Path corrections and small consistency fixes are limited to links affected by
the move.

## Generated and owner-rendered pages

These pages remain published but do not create duplicate canonical Markdown
inside the docs-site package.

| Stable route | Title | Lifecycle | Canonical input | Treatment |
| --- | --- | --- | --- | --- |
| `/` | Overview | Published service standard | Package-owned renderer and content manifest | Generate the same index and navigation from the reviewed manifest. |
| `/app-user-api/reference/` | Space API Reference | Published service standard | `@unicas/space-protocol/openapi.json` | Continue generating the interactive reference from the tracked App/Space v1 OpenAPI artifact. |
| `/glossary/` | UniCAS Glossary | Published service standard | `/GLOSSARY.md` | Continue rendering the curated storage, identity, and access sections; keep the repository glossary canonical. |
| `/reference/packages/` | Package Boundaries | Published service standard | `/packages/README.md` | Render in place; do not copy. |
| `/reference/admin-protocol/` | Admin Protocol | Published service standard | `/packages/admin-protocol/README.md` | Render in place; do not copy. |
| `/reference/space-protocol/` | Space Protocol | Published service standard | `/packages/space-protocol/README.md` | Render in place; do not copy. |
| `/reference/admin-cli/` | Administrator CLI | Published service standard | `/packages/admin-cli/README.md` | Render in place; do not copy. |

The resulting inventory remains 24 generated HTML pages: 17 package-owned
Markdown articles, one overview, one interactive API reference, one glossary,
and four owner-rendered package references.

## Documents not published today

No currently unpublished document becomes public as a side effect of the move.

| Current source | Classification | Canonical source after move | Treatment |
| --- | --- | --- | --- |
| `/docs/repository-tasks.md` | Repository-development material | unchanged | Keep as the repository task workflow. |
| `/docs/managed-issuer-retirement.md` | Historical release-engineering procedure | unchanged | Keep as a non-public retirement and rollback record. |
| `/docs/spaces-smoke-app.md` | Package-specific operations guidance | `/packages/spaces/README.md` | Move to the private App that owns the workflow; do not add a public route. |

A new `/docs/README.md` indexes the two remaining repository-owned documents
and states that public service documentation is owned by
`/packages/docs-site/content/`. Package-specific documentation remains with its
owning package.

## Compatibility contract

- The route manifest carries route, title, navigation section, canonical source
  path, and lifecycle classification as explicit data.
- Existing routes keep their exact slugs and trailing-slash behavior. Wrangler
  retains `auto-trailing-slash`; there is no redirect table.
- Markdown contents and the existing heading slugger remain unchanged, so
  anchors remain stable. Generated-link tests validate routes and fragments.
- `Edit source` uses each manifest entry's new canonical path. Owner-rendered
  references continue linking to their owning files; generated overview and
  API-reference pages have no edit link.
- Static URLs remain `/assets/docs.css`, `/assets/docs.js`,
  `/assets/api-reference.js`, `/assets/api-reference.css`, and `/favicon.svg`.
- The OpenAPI download remains `/openapi/app-space-v1.openapi.json` and is copied
  from the exported `@unicas/space-protocol` artifact without a competing schema.
- The package continues emitting `/404.html`; Wrangler retains
  `not_found_handling: "404-page"` and the existing not-found message.
- Repository and generated link checks must reject any unresolved old source
  path, missing route, missing fragment, or stale `Edit source` target.

## Review question

Approve this complete content classification, the canonical source moves, and
the zero-route-change compatibility contract?
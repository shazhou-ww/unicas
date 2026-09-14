# Progress

Updated: 2026-09-14

## Checklist

- [x] Define the published document and package-reference inventory.
- [x] Build static HTML from repository-owned Markdown sources.
- [x] Generate navigation, heading anchors, and deep links.
- [x] Validate source links and generated internal links.
- [x] Provide readable code, table, desktop, and mobile layouts.
- [x] Configure an independent assets-only documentation Worker.
- [x] Add repeatable build, check, dry-run, and deploy commands.
- [x] Validate local routing and responsive browser rendering.
- [ ] Deploy `docs.unicas.work` and verify HTTPS behavior.
- [ ] Update product-site and console documentation links.
- [ ] Run build, link, Wrangler, browser, gitleaks, and CI gates.
- [ ] Archive the completed task.

## Current state

The generator publishes all 12 accepted Markdown documents under `docs/`, a
curated UniCAS glossary, and four package reference pages. It emits 18 static
HTML pages with deterministic URLs, heading anchors, navigation, source links,
and a generated-link report. The independent assets-only Worker has no runtime
bindings or credentials.

Desktop and 390 x 844 mobile browser checks passed for the overview and the
long CAS architecture article. Code and tables scroll within the article,
mobile navigation opens and closes correctly, the page has no horizontal
overflow, and unknown paths return 404.

Next concrete action: run the full local repository and deployment gates,
commit the implementation, then deploy and validate `docs.unicas.work` before
updating product-site documentation links.

## Decisions

- Keep `docs/` as the source of accepted architecture, protocol, deployment,
  operations, and terminology content.
- Deploy documentation through a separate assets-only Worker with no service
  credentials, storage bindings, or API routes.
- Fail the build on unresolved local links instead of silently emitting broken
  documentation URLs.
- Keep document content unchanged; presentation and navigation are generated
  around the repository-owned Markdown.

## Validation

- Working tree was clean before task activation.
- The repository contains 12 accepted Markdown documents under `docs/`.
- No Markdown parser dependency existed before implementation.
- `marked` 18.0.13 is used only at build time.
- Documentation generator tests passed (3 tests).
- Deployment ownership tests passed with docs isolated from API and product
  Workers (14 focused tests total).
- `pnpm docs:build` generated 18 pages; Wrangler dry-run read 42 static files
  and reported no bindings.
- Desktop navigation/TOC and mobile menu/overflow checks passed. Local unknown
  documentation routes return 404.
- Full workspace build and typecheck passed.
- Full repository and package tests passed, including 104 repository checks
  and 185 service-cloudflare tests.
- CI now builds the documentation site and performs its Wrangler dry-run.

## Blockers

None.

## Outcome

In progress.

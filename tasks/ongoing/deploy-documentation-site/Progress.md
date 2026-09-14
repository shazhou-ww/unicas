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
- [x] Deploy `docs.unicas.work` and verify HTTPS behavior.
- [x] Update product-site and console documentation links.
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

The assets-only `unicas-docs` Worker is deployed as version
`451ec409-6a29-4df7-9b1e-4e61c057b5e1`. Production overview, deep-link, CSS,
and JavaScript requests return 200; unknown documentation paths return 404;
the same deep link on the API origin returns 404. Cloudflare assigns only
`docs.unicas.work` to this Worker.

The console already linked to the docs origin. Product-site links now target
the validated production origin and are ready for the apex site redeploy.

Next concrete action: commit and deploy the product-link update, run final
production and repository validation, push, verify CI, and archive the task.

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
- Documentation Worker version `451ec409-6a29-4df7-9b1e-4e61c057b5e1`
  deployed to the exact `docs.unicas.work` custom domain with no bindings.
- Production docs overview, architecture deep link, CSS, JavaScript, 404, and
  API wrong-host behavior returned the expected HTTP statuses.
- System DNS, Cloudflare certificate provisioning, and CDN response headers
  were verified. Integrated Chromium production navigation remained affected
  by a local `ERR_CONNECTION_CLOSED`; responsive rendering was validated
  against the identical local Worker build instead.

## Blockers

None.

## Outcome

In progress.

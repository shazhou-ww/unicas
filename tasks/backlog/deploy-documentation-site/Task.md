# Deploy the UniCAS documentation site

Created: 2026-09-14

## Goal

Publish the repository's accepted documentation at `https://docs.unicas.work`
as an independently deployable static site.

## Context

The public domain split reserves `docs.unicas.work` for developer and operator
documentation. The origin is currently unconfigured and is deliberately not
routed to the UniCAS API Worker. During the domain-topology cutover, product
and console documentation links continue to target the repository sources.

## Scope

- Select and configure a static documentation build from the accepted files in
  `docs/`, plus the repository glossary and relevant package references.
- Provide usable navigation, deep links, code blocks, and mobile layouts.
- Deploy the site through its own Cloudflare Worker or static deployment unit.
- Add `docs.unicas.work` as that deployment's exact custom domain.
- Update product-site and console documentation links after production
  validation.
- Add build, link, routing, responsive-layout, and Wrangler dry-run checks.

## Out of scope

- Moving documentation routes into the API or console Worker.
- Changing CAS, MCP, administrator, tenant, or legacy protocol behavior.
- Modifying `unicas.shazhou.work` or any legacy Cloudflare resource.
- Rewriting accepted architecture or protocol decisions as part of deployment.

## Acceptance criteria

- [ ] `docs.unicas.work` serves the accepted UniCAS documentation over HTTPS.
- [ ] The documentation site is deployed independently from API, console, and
      product-site releases.
- [ ] The API Worker has no route, binding, or redirect for the docs origin.
- [ ] Repository documentation links resolve in the generated site.
- [ ] Navigation and code content are usable on desktop and mobile viewports.
- [ ] Product and console links target the deployed documentation origin.
- [ ] Build, link checks, responsive browser checks, Wrangler dry-run, and CI
      pass.

## Constraints

- Keep `docs/` as the source of accepted stable documentation.
- Do not add service credentials or data-plane bindings to the documentation
  deployment.
- Preserve the independent release and security boundary defined in
  `docs/domain-topology.md`.

## References

- [Finalized domain topology](../../../docs/domain-topology.md)
- [Deployment and local configuration](../../../docs/deployment-and-local-configuration.md)
- [Domain split task](../../archived/split-public-domain-topology/Task.md)

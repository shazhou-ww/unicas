# `@unicas/docs-site`

Private workspace package for the independently deployed UniCAS documentation
site at `https://docs.unicas.work`. It is a static deployment unit, not a public
npm package.

The package owns the renderer, published Markdown content, browser assets,
tests, generated `dist/` artifact, and assets-only Wrangler configuration. It
renders selected repository and package references in place without creating
canonical copies. The interactive API reference consumes the generated
`@unicas/space-protocol/openapi.json` export.

## Commands

```powershell
pnpm --filter @unicas/docs-site build
pnpm --filter @unicas/docs-site test
pnpm --filter @unicas/docs-site typecheck
pnpm --filter @unicas/docs-site run clean
pnpm --filter @unicas/docs-site deploy:plan
```

`deploy` performs a production publication. It runs either inside the complete
protected repository release or the manual **Deploy documentation** workflow;
local validation should use `deploy:plan`.

The documentation-only workflow requires a full lowercase commit SHA equal to
the current `origin/main`, uses the existing `Production` environment review,
shares the `unicas-production` serialization group with complete releases, and
deploys no API, Spaces, product-site, npm, tag, or GitHub Release surface. It
runs the docs unit, type, and browser checks plus a Wrangler dry-run before
publication, records the exact SHA in `artifact-manifest.json`, and verifies the
public SDK routes after deployment.

If its post-deploy verification fails, inspect the deployed source revision and
use the documented Wrangler version rollback. Do not rebuild a moving branch
as a substitute for selecting the known-good documentation version.

The build output contains only static pages and assets, the generated OpenAPI
document, `404.html`, `link-check.json`, and non-secret `artifact-manifest.json`
metadata. It has no service, storage, OAuth, or secret binding.

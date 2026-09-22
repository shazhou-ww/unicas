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

`deploy` performs a production publication and remains part of the protected
repository release workflow. Local validation should use `deploy:plan`.

The build output contains only static pages and assets, the generated OpenAPI
document, `404.html`, `link-check.json`, and non-secret `artifact-manifest.json`
metadata. It has no service, storage, OAuth, or secret binding.

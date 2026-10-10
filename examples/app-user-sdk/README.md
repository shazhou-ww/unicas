# App-user SDK examples

These examples consume the public package roots exactly as an external
application does.

## Offline quickstarts

- `node-quickstart.ts` creates an App-level transport with a synthetic
  capability provider and fetcher, reads immutable metadata from an explicit
  Space, and runs without credentials or network access.
- `browser-quickstart.ts` attaches the browser cache, proves a repeated
  immutable read is cached, and clears the authenticated Principal partition
  at logout.

The release gate copies these files to a clean directory, installs only the
packed SDK tarballs, typechecks them with TypeScript 5.9, runs the Node example,
and bundles the browser example for Chromium, Firefox, and WebKit.

## Host responsibilities

`host-responsibilities.ts` provides tested reference functions for:

- obtaining a short-lived capability from an App-owned authenticated route;
- persisting a blob hash before calling `retain` with a stable request ID;
- implementing an App-owned, Principal-scoped `SpaceFileRootCatalog`; and
- making `commit()` the catalog-visible file snapshot boundary.

The in-memory catalog is demonstration code, not a production database
adapter.

## Optional live read

`live-metadata.ts` performs one metadata read with credentials supplied only
through the caller's environment:

```powershell
$env:UNICAS_BASE_URL = "https://api.unicas.work"
$env:UNICAS_APP_ID = "<your-app-id>"
$env:UNICAS_SPACE_ID = "<your-space-id>"
$env:UNICAS_CAPABILITY = "<short-lived-capability>"
$env:UNICAS_CAPABILITY_EXPIRES_AT = "<token-expiration-unix-seconds>"
$env:UNICAS_NODE_HASH = "<64-character-node-hash>"
pnpm exec tsx examples/app-user-sdk/live-metadata.ts
```

Use a non-production Space and a short-lived, least-privileged capability.
Never commit or paste a capability into an example, issue, log, or test
fixture.

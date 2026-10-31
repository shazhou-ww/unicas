# @unicas/site

Private assets-only Worker for the `unicas.work` product apex. This package owns
the static source, tests, Wrangler configuration, and Wrangler tool dependency.

Use the repository release entrypoints for deployment review and production
release:

```powershell
pnpm release:site:plan
pnpm release:site:production
```

The package has no service bindings, secrets, database, object storage, or
application runtime.

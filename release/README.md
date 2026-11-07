# Release orchestration

This tree owns reviewed release commands, contracts, and evidence. Deployable
packages continue to own their source, migrations, static assets, Wrangler
configuration, and Wrangler dependency.

Every deployment entrypoint requires an explicit plan or production command.
Repository validation invokes plan mode only and must not mutate production
resources.

## Units

- `service/` orchestrates the single `@unicas/service-cloudflare` deployment,
  schema application, release smoke, and bounded recovery tools.
- `spaces/` orchestrates the independently deployed `@unicas/spaces` App,
  including its bootstrap, preflight, smoke, and issuer proof.
- `site/` and `docs/` wrap assets-only package deployments with explicit modes.
- `app-user-sdk/` owns public-package release contracts and evidence.
- `shared/` contains helpers used by more than one release unit.

Apps continue to operate their own OAuth authorization servers. Release tooling
may inspect and activate an App issuer through the control plane, but UniCAS
does not provision issuers or derive personal Spaces from App membership.

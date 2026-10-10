# Release orchestration

This tree owns reviewed release commands, contracts, and evidence. Deployable
packages continue to own their source, migrations, static assets, Wrangler
configuration, and Wrangler dependency.

Every deployment entrypoint requires an explicit plan or production command.
Repository validation invokes plan mode only and must not mutate production
resources.

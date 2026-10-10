# Repository cleanup inventory

## Snapshot

- Repository commit: `d81253cdba2a1c6bc49370881e173b7858854329`
- Inventory date: `2026-10-10`
- Method: inspect tracked top-level paths, workspace manifests, package scripts,
  workflows, deployment configuration, tests, documentation references and
  relevant Git history without changing repository deliverables.

This inventory classifies the inspected snapshot. It is evidence for the Ideal
World, not a permanent claim that a retained asset can never become obsolete.

## Directory responsibilities

| Path | Current responsibility | Cleanup implication |
| --- | --- | --- |
| `packages/` | Sixteen workspace packages, including the private first-party `spaces` App; package ownership and dependency direction are guarded | Do not merge, split, rename or delete based only on apparent overlap |
| `stacks/unicas/` | Local orchestration, Cloudflare deployment order, product site assets and Spaces deployment composition | Paths may be reorganized only with all deployment and test consumers updated |
| `scripts/` | Cross-package local development, Git hook, SDK, release, smoke and verification tools | Active tools with package, CI, test or deployment consumers are not deletion candidates |
| `tests/` | Repository-level architecture, release, deployment and retirement guards | A historical name can represent an intentional negative guard rather than stale code |
| `sdk/` | App-user SDK package matrix, deterministic release manifest and reviewed API baseline | Generated or declarative release evidence; rebuildability alone does not make it disposable |
| `examples/app-user-sdk/` | Packed-artifact external-consumer verification and public quickstarts | Release inputs and documentation targets, not duplicate source |
| `docs/` | Accepted repository architecture, operations, release and workflow consensus | Public or operational references require external, rollback and retention checks |
| `.agents/` | Canonical Agent skills and reusable repository instructions | Excluded from ordinary provider-specific or convenience cleanup |
| `.silvermoon/` | Repository-owned idea contracts, evidence, ledger and lifecycle history | Excluded from ordinary cleanup deletion |

## Candidate classification

### Migrate

#### `stacks/unicas/deploy/migrations/tenant/`

- Current consumer:
  `packages/service-cloudflare/wrangler.toml` configures this directory as the
  `CAS_DB` migration source.
- Verification consumer:
  `packages/service-cloudflare/tests/schema.test.ts` reads
  `0001_baseline.sql` and proves empty-database application, idempotence and
  schema behavior.
- Current ownership:
  `packages/service-cloudflare/src/schema.ts` describes an App-scoped Space
  storage schema and exports `APP_SPACE_SCHEMA_MIGRATIONS`.
- History:
  the baseline remains actively maintained; its latest commits repaired D1
  parser compatibility and supported current Spaces behavior.
- Conclusion:
  the SQL is active and must not be deleted. The `tenant` directory segment is
  a legacy naming debt and should be atomically renamed to `app-space`.

## Retain

### `stacks/unicas/deploy/cut-over-app-space-v1-issuers.mjs`

- Referenced by the release workflow and focused tests.
- Updated on `2026-10-09` for current multi-Space capability grants.
- Encodes idempotent current-state handling as well as the historical cutover.
- Conclusion: active deployment/recovery surface; retain.

### `docs/managed-issuer-retirement.md`

- Referenced by the deployment README and docs-site completeness tests.
- Preserves approval, rollback, D1 cleanup and key-revocation boundaries.
- Conclusion: accepted operational and rollback record; retain.

### Root `scripts/*.mjs`

- Fourteen tracked scripts were checked by basename against repository
  consumers.
- Every script has a package script, workflow, test, deployment entry or
  maintained module consumer.
- The directory mixes several responsibilities, but all files are active.
- Conclusion: retain in place for this idea; a future grouping proposal needs
  its own exact path plan and benefit evidence.

### `sdk/` and `examples/app-user-sdk/`

- SDK API declarations, package matrix and release manifest are consumed by
  SDK readiness and release checks.
- Examples are copied into clean packed-artifact consumer tests and linked by
  current documentation.
- Conclusion: release baseline and verification inputs; retain.

## Excluded

### `.silvermoon/ideas/**`

Historical names such as `legacy-repoledger` occur inside preserved idea
history. These files are lifecycle and audit records, not obsolete source
files.

### Frozen legacy environment

`unicas.shazhou.work` and its Cloudflare resources are outside this cleanup.
No observation in this inventory authorizes changing or deleting them.

## Current deletion result

No inspected tracked file satisfies the approved deletion standard in this
snapshot. This is the expected evidence-driven result. The implementation must
not substitute an unproven deletion merely to make the cleanup contain a file
removal.

## First-batch candidate

The implementation candidate is limited to:

1. Git rename
   `stacks/unicas/deploy/migrations/tenant/0001_baseline.sql` to
   `stacks/unicas/deploy/migrations/app-space/0001_baseline.sql`;
2. update the Wrangler migration directory and schema-test reads;
3. prove the SQL content is unchanged;
4. run existing schema migration and narrow repository/package checks;
5. record that the old directory and maintained references are absent.

No compatibility copy, symlink, new dedicated regression guard, production
migration or deployment belongs to this batch.

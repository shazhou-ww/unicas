# Progress

Updated: 2026-09-22

## Current state

The publication task is active. The prepared beta package interface and OIDC
activation architecture are approved. GitHub environment `npm` exists with
`shazhou-ww` as required reviewer, no deployment branch policy, and no secrets
or variables.

npm identity `shazhou.ww` is authenticated against the official registry and is
an owner of organization `unicas`. All six package names remain absent. npm's
organization UI rejected both empty-package name forms with `forbidden`, and
npm 11.19.1 `npm trust` returned `E404` after human authentication because the
package record does not exist.

The requesting user approved the separately reviewed first-package bootstrap.
The maintained candidate now uses unified version `0.0.0-bootstrap.0` and
non-user-facing dist-tag `bootstrap`. The generated release manifest records
its deterministic tarballs and exact internal dependency pins. No npm package,
version, dist-tag, trusted publisher, or release tag has been created yet.

## Decisions

- Preserve `0.1.0-beta.1` as the first supported release published by the
  protected GitHub OIDC workflow with provenance.
- Bootstrap package records with the same reviewed implementation and package
  surfaces at unified version `0.0.0-bootstrap.0`; do not publish placeholders.
- Publish bootstrap tarballs only under `bootstrap`, never `latest` or `beta`.
- Keep all six versions unified and publish in matrix dependency order.
- Use interactive organization-owner authentication outside chat. Add no npm
  token to source, GitHub, task artifacts, logs, or environment state.
- After verified bootstrap writes, configure and read back all six trusted
  publishers, then restore and revalidate the maintained beta.1 candidate.
- Treat any partial bootstrap publication as immutable registry state. Stop and
  inspect before continuing; never overwrite or unpublish a version.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | On 2026-09-22, the requesting user explicitly invoked `/publish app-user-sdk 0.1.0-beta.1`, authorizing execution of the registered publication outcome subject to its protected gates. |
| Interface | Approved | On 2026-09-22, the requesting user selected “批准接口” for [InterfaceReview.md](./InterfaceReview.md), approving the exact six-package beta.1 contract, `beta` dist-tag, immutable tag, and order. |
| Architecture | Approved | On 2026-09-22, the requesting user selected “批准激活架构” for [Architecture.md](./Architecture.md), approving the protected GitHub environment and token-free OIDC path. After npm package creation proved blocked, the user selected “批准 bootstrap.0 方案” for [BootstrapReview.md](./BootstrapReview.md). |
| Business and data model | Not applicable | Package publication and registry metadata change no UniCAS domain entity, customer data, ownership model, schema, retention, or service lifecycle state. |
| Delivery acceptance | Pending | Requires verified bootstrap and trust configuration, beta workflow success, registry provenance and dist-tags, clean registry-consumer evidence, exact integrated primary commit, and explicit requesting-user acceptance. |

## Validation

- Exact beta candidate `a6a9450a617b75c39cb50e91100cee9289b8a37e`
  passed main and task-source CI, read-only release planning, deterministic
  double-pack, external Node/Chrome consumers, planner policy tests, serial
  workspace build, and workspace typecheck.
- Target beta tag and all six beta versions were absent during preflight.
- GitHub API readback proves the `npm` environment has one required reviewer
  (`shazhou-ww`) and no secrets or variables.
- `pnpm sdk:prepare` passes for `0.0.0-bootstrap.0`: generated OpenAPI drift,
  six-package build, double-pack determinism, tarball allowlists, exact internal
  version pins, external installation, declaration typecheck, Node consumer,
  and real-Chrome IndexedDB consumer all pass.
- `pnpm check:sdk-release` passes all 11 matrix and artifact checks for the
  generated bootstrap evidence.
- `pnpm check:npm-release` passes all 10 tag, version, primary, workflow,
  permission, token, ordering, and sole-write policy tests.

## Blockers

- The bootstrap source candidate must pass task-source and integrated primary
  CI before any registry write.
- The repository's installed `/publish` skill normally prohibits developer
  machine publication. The approved bootstrap is an exceptional human-owner
  operation; the agent must not execute it unless the repository policy is
  explicitly reconciled for this one-time procedure.
- Each interactive npm publish may require security-key or 2FA handling by the
  organization owner outside chat.

## Outcome

The one-time bootstrap artifacts are prepared and locally validated but remain
unpublished. Next publish the candidate through the normal source/primary path,
obtain exact-commit bootstrap authorization after CI, perform the six guarded
owner writes, configure all six trusted publishers, and restore beta.1.

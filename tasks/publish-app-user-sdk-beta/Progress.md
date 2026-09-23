# Progress

Updated: 2026-09-23

## Current state

The reviewed App-user SDK beta is published. Immutable tag
`npm/app-user-sdk/v0.1.0-beta.1` targets exact source commit
`45c1681e2cfb071ffcc2be694bae48ad2e267514`. GitHub Actions run
`35800458882` completed both validation and protected publication jobs and
published all six packages in dependency order through npm OIDC with SLSA
provenance.

npm identity `shazhou.ww` is authenticated against the official registry and is
an owner of organization `unicas`. The approved owner bootstrap created all six
public package records at `0.0.0-bootstrap.0` in dependency order. Registry
tarball integrity, exports, exact dependencies, visibility, collaborators, and
tags match the reviewed evidence for every package.

All six packages trust GitHub repository `shazhou-ww/unicas`, workflow
`publish-npm.yml`, and environment `npm` for direct and staged publication.
npm `beta` and `latest` now both point to `0.1.0-beta.1` for every package.
The retained `bootstrap` tag points to `0.0.0-bootstrap.0`, and every bootstrap
version is deprecated with guidance to use beta.1 or later. GitHub environment
`npm` requires reviewer `shazhou-ww` and contains no secret or variable.

`pnpm verify:npm-release -- --expect-latest` is the maintained anonymous
registry check. It binds all six SLSA attestations to the exact repository,
workflow, tag, source commit, and one Actions run; downloads and hashes every
tarball; validates exports, dependencies, tags, and bootstrap deprecation; and
runs a fresh no-token npm consumer through declarations, Node, real Chrome,
registry signatures, and attestations.

## Decisions

- Preserve `0.1.0-beta.1` as the first supported release published by the
  protected GitHub OIDC workflow with provenance.
- Bootstrap package records with the same reviewed implementation and package
  surfaces at unified version `0.0.0-bootstrap.0`; do not publish placeholders.
- Request only `bootstrap` during owner bootstrap. Accept npm's unavoidable
  first-version `latest` temporarily, then move it to the verified beta.1 set.
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
- Bootstrap source commit `308b4af53081b74432a35f78dafd79a4f96bfabe`
  passed task-source CI run `35714888082` and integrated main CI run
  `35715365057` before any registry write.
- Six npm publish dry-runs matched the generated tarball names, versions, file
  inventories, and SHA-512 integrity values before the requesting user executed
  each security-key-protected owner publication.
- All six registry versions match `sdk/release-manifest.json`; scope inventory
  contains exactly the reviewed packages with read-write organization access.
  Every package is public and has `bootstrap` plus npm-forced `latest` pointing
  to `0.0.0-bootstrap.0`.
- All six npm trusted-publisher records were created and immediately read back
  with exact repository, workflow, environment, and direct-publish permission.
- The restored beta.1 candidate passes `pnpm sdk:prepare`, all 11 focused SDK
  release checks, all 10 npm workflow/planner tests, external declaration
  typecheck, Node consumer, and real-Chrome consumer.
- Reconciled source commit `45c1681e2cfb071ffcc2be694bae48ad2e267514`
  passed task-source CI run `35718757533` and integrated main CI run
  `35719150063`, including the concurrent observability implementation.
- Release workflow run `35800458882` validated the tagged commit, rebuilt and
  verified deterministic artifacts, repeated immutable registry preflight,
  passed the protected `npm` environment gate, and published all six beta.1
  versions in matrix order without a long-lived token.
- Every live beta.1 manifest matches the tracked SHA-512 integrity, exports,
  and exact internal dependency evidence. All six provenance endpoints and
  root package documents are public and identify the reviewed GitHub workflow.
- A fresh official-registry consumer installed all six exact beta versions,
  typechecked shipped declarations, passed Node and real-Chrome smoke checks,
  and verified 41 registry signatures plus 29 attestations.
- Every package has `beta` and `latest` at `0.1.0-beta.1`; retained bootstrap
  versions are deprecated and remain isolated under `bootstrap`.
- `pnpm verify:npm-release -- --expect-latest` reproduces the complete live
  metadata, provenance, tarball, tag, bootstrap-cleanup, and consumer checks
  without npm credentials.

## Blockers

- No implementation or registry blocker remains.
- Delivery acceptance remains pending for the final integrated primary commit
  that adds the maintained live-registry verifier and records this evidence.

## Outcome

The first App-user SDK beta release, one-time package bootstrap, trusted
publisher activation, protected workflow, provenance, dist-tags, registry
consumer, and bootstrap cleanup are complete and verified. Publish the final
verification tooling and evidence through primary, then request delivery
acceptance for that exact commit and complete the Repoledger task.

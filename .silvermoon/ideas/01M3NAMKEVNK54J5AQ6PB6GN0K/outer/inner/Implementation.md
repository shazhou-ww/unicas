# Implementation

## Steps

### I-S01: Reconcile prerequisites and the beta contract

Map current implementation and history to the required App/Space v1 operations,
capabilities, OpenAPI, SDK exports, compatibility policy, migration guidance,
and prerequisite outcomes; resolve superseded or abandoned assumptions.

### I-S02: Finalize canonical guidance and operations

Align the App-user guide, installation and browser/backend flows,
least-privilege issuance, version axes, support expectations, rollout,
observability, partial-failure recovery, deprecation, and path to stable.

### I-S03: Prove release artifacts are reproducible

Generate and verify package tarballs, OpenAPI, documentation, external-consumer
installation, registry preflight, and retired-surface guards from the exact
candidate.

### I-S04: Assemble exact-revision release evidence

Run the complete release-grade validation and produce a non-secret inventory
that ties every expected package, contract, documentation, and deployment input
to one primary revision.

## Acceptance criteria

### I-AC01: The beta contract has no unresolved breaking change

The inventory agrees with implementation, generated OpenAPI, package tarballs,
canonical documentation, capability grammar, and compatibility policy. Prove
it with generated-artifact checks and reviewed inventory.

### I-AC02: Only the accepted App/Space v1 surface remains

Focused guards and runtime probes reject retired Stack/Tenant and prototype v2
wire or SDK surfaces. Prove it with retirement, API-version, OpenAPI, and
external-consumer tests.

### I-AC03: Public packages are release-ready

All intended package names, versions, exports, dependencies, packed contents,
provenance inputs, and clean external installation match the beta contract.
Prove it with SDK artifact and npm release verification.

### I-AC04: Documentation and recovery are complete

The canonical guide provides a setup-to-request path, supported entry points,
version distinctions, migration guidance, rollout, observability, and
partial-failure recovery without obsolete current guidance. Prove it with docs
tests and reviewed content inventory.

### I-AC05: Release-grade validation passes

Package tests, workspace checks, build, typecheck, release-policy suites,
deterministic artifacts, browser tests, and all deployment dry runs pass for
the exact candidate. Prove it with `pnpm validate:release`.

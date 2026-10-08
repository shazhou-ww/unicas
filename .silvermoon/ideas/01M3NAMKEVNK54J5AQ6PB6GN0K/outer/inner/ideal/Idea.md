# Promote the App-user API and SDKs to beta

## Intent

Promote the assembled App/Space v1 API, public SDKs, documentation, and smoke
flows as one production-verified UniCAS App-user beta tied to an exact primary
revision.

## Context

The contract cutover, legacy retirement, package preparation, publication
workflow, documentation site, and supporting smoke capabilities were developed
as separate outcomes. The remaining capstone must reconcile their current
state and prove that registry artifacts, deployed services, documentation, and
public end-to-end behavior form one coherent beta.

This idea was migrated from the unfinished Repoledger task
`promote-app-user-api-to-beta`. Git history retains its original artifact; no
previous approval is transferred to this new ideal revision.

## Desired outcome

The exact reviewed primary revision has reproducible public SDK artifacts,
verified npm registry metadata and provenance, a protected production
deployment of the App/Space v1 API and documentation, successful public-route
smoke evidence, a reconciled retired-surface inventory, and explicit user
acceptance of the assembled beta.

## Scope

### In scope

- Reconcile the final HTTP, capability, OpenAPI, SDK, compatibility, migration,
  and product-maturity contract.
- Confirm prerequisite outcomes and resolve any abandoned or superseded
  dependency assumptions before freezing the beta.
- Align canonical App-user guidance, install flows, least-privilege issuance,
  migration guidance, support expectations, rollout, recovery, and the path to
  stable.
- Verify protected npm publication and registry state for all public packages.
- Promote one exact validated revision through the protected release workflow.
- Exercise public API, authorization, direct upload, Root Ref lifecycle,
  readback, isolation, bounded cleanup, and the independent file-upload smoke
  App.
- Complete the retired-surface inventory and exact-revision acceptance record.

### Out of scope

- Reimplementing completed contract, retirement, SDK packaging, publication,
  concept, or smoke capabilities.
- Adding new App-user features, storage semantics, entities, or Admin APIs only
  for the beta label.
- Publishing service implementations, private WebUIs, or first-party stacks as
  public SDKs.
- Deleting persisted data because it retains a historical storage name.
- Claiming stable 1.0 compatibility or general availability.

## Constraints

- Use `origin/main` and protected release workflows as the only accepted source
  for npm and production promotion.
- Keep npm, Cloudflare, OAuth, capability-signing, and smoke credentials in
  approved secret stores and out of artifacts and logs.
- Reproduce OpenAPI, documentation, packages, and deployment bundles from
  source; never repair drift by editing generated outputs.
- Treat npm versions as immutable and recover partial publication only through
  the reviewed version and dist-tag procedure.
- Any package, API, documentation, authorization, isolation, or smoke mismatch
  blocks promotion.

## Open questions

- Reconcile the previously abandoned directional Root Ref task with the current
  implementation and decide whether its required behavior is already supplied,
  superseded, or still blocks beta.
- Confirm the intended beta package version and initial production promotion
  revision during implementation planning.

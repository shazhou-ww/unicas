# Promote the App-user API and SDKs to beta

Created: 2026-09-21

## Goal

Promote the completed App/Space v1 API and public SDK release work as one
production-verified UniCAS App-user beta, with canonical documentation,
registry evidence, protected deployment evidence, and explicit acceptance of
the exact primary revision.

## Context

The original task combined contract renumbering, legacy removal, SDK package
hardening, npm publication automation, documentation, deployment, and live
acceptance. Those changes have different ownership boundaries, review gates,
and failure recovery, so their implementation is delegated to four sibling
tasks:

- `cut-over-app-space-api-to-v1` owns the released HTTP and capability
  contract and removal of the prototype App/Space v2 surface.
- `retire-stack-tenant-data-plane` owns removal of the old Stack/Tenant
  App-user contract and its compatibility implementation.
- `prepare-app-user-sdk-beta-packages` owns public package contents, metadata,
  dependency shape, and clean external-consumer validation.
- `publish-app-user-sdk-beta` owns protected npm publication and registry
  verification.

This task remains the release capstone. It consumes those outcomes together
with the existing App/Space concept refactor, directional Root Ref API, and
independent file upload smoke App, then proves that the assembled beta is one
coherent deployed product rather than a set of individually passing changes.

## Scope

- Maintain one release-level beta contract inventory that links the accepted
  App/Space v1 operations, capability grammar, permission matrix, generated
  OpenAPI, SDK package and export matrix, compatibility policy, and migration
  guidance produced by the implementation tasks.
- Confirm that the App/Space concept refactor and directional Root Ref API are
  completed and integrated before freezing the beta contract.
- Reconcile the canonical App-user guide, installation and browser/backend
  flows, least-privilege issuance guidance, migration guidance, and the
  distinct HTTP, capability, package-semver, and product-maturity version axes
  against the final implementation and packed packages.
- Document beta support expectations, rollout order, observability, npm and
  service failure recovery, package deprecation procedure, and the path from
  beta to a future stable release.
- Run the protected npm publication path for the approved package revision and
  retain non-secret evidence of expected package names, versions, dist-tags,
  provenance, exports, dependency ranges, and clean installation from npm.
- Promote the exact validated revision through the protected `release`
  workflow and verify the public API origin, generated contract,
  documentation, authorization denials, direct upload, directional Root Ref
  lifecycle, reads, isolation, and bounded cleanup.
- Consume the independently deployed file upload smoke App as external
  end-to-end evidence without adding a privileged UniCAS route or private
  storage shortcut.
- Run the final retired-surface inventory and repository guards, record every
  intentionally retained historical storage or compatibility name with its
  owner and removal condition, and reject leaks into the released wire or SDK
  surface.
- Assemble exact-primary-revision delivery evidence and obtain explicit user
  acceptance of the published packages, deployed API, documentation, and
  cleanup result.

## Out of scope

- Implementing the App/Space v1 route and capability cutover, which belongs to
  `cut-over-app-space-api-to-v1`.
- Removing the Stack/Tenant data-plane implementation, which belongs to
  `retire-stack-tenant-data-plane`.
- Choosing or preparing public SDK package contents, which belongs to
  `prepare-app-user-sdk-beta-packages`.
- Building the npm publication workflow, which belongs to
  `publish-app-user-sdk-beta`.
- Reimplementing the App/Space concept refactor, directional Root Ref API, or
  independent file upload smoke App.
- Adding new App-user product features, storage semantics, business entities,
  or administrator-plane operations solely for the beta label.
- Deleting persisted customer or smoke data because a schema or key uses a
  historical name.
- Publishing service implementations, administrator packages, private WebUIs,
  or first-party application stacks as App-user SDKs.
- Claiming stable `1.0` compatibility, general availability, or an indefinite
  beta support lifetime.

## Acceptance criteria

- [ ] `complete-app-space-concept-refactor`, `split-root-ref-update-api`,
      `cut-over-app-space-api-to-v1`, `retire-stack-tenant-data-plane`,
      `prepare-app-user-sdk-beta-packages`, and `publish-app-user-sdk-beta` are
      completed and integrated before the production freeze.
- [ ] The reviewed beta contract inventory contains no unresolved planned
      breaking App-user change and agrees with the implementation, generated
      OpenAPI, package tarballs, and canonical documentation.
- [ ] The assembled release exposes only the accepted App/Space v1 wire and SDK
      contract; focused guards and runtime probes reject retired Stack/Tenant
      and prototype App/Space v2 surfaces.
- [ ] The deployed documentation provides a complete setup-to-request path,
      names the supported SDK entry points, distinguishes all version axes,
      and contains no obsolete current guidance.
- [ ] Registry verification confirms the approved public package names,
      versions, dist-tags, provenance, exports, dependency ranges, and clean
      installation from npm rather than the workspace.
- [ ] The protected release path deploys the exact validated App/Space v1 API
      and documentation revision, and production health, contract,
      authorization, direct-upload, directional Root Ref, readback, isolation,
      and bounded-cleanup checks pass.
- [ ] The independently deployed file upload smoke App passes against the same
      release through public packages and routes only.
- [ ] Any retained historical storage name or compatibility adapter is
      documented with its owner, reason, isolation boundary, and removal
      condition; none leaks into the released wire or SDK surface.
- [ ] Package, external-consumer, OpenAPI, documentation, workspace-boundary,
      build, typecheck, exhaustive, deployment dry-run, publication, registry,
      and live post-deployment evidence is complete and contains no secrets or
      customer data.
- [ ] The user explicitly accepts the published npm packages, deployed API and
      documentation, legacy cleanup result, and validation evidence for the
      exact reviewed primary commit.

## Constraints

- Treat `origin/main` as the accepted contract and release source. Publish npm
  packages and deploy production only from the exact protected revision; do
  not release from an implementation branch, mutable local build, or dirty
  workspace.
- Do not begin the production freeze while a named dependency is incomplete
  or while a planned breaking App-user change remains unresolved.
- Preserve the administrator and App-user credential boundary. npm,
  Cloudflare, OAuth, capability-signing, and smoke credentials stay in
  approved secret stores and never enter source, task artifacts, package
  tarballs, logs, or generated documentation.
- Keep generated OpenAPI, documentation inputs, and package outputs
  reproducible from source; never repair release drift by editing generated
  artifacts manually.
- npm versions are immutable. Recover a partial publication through the
  reviewed version and dist-tag procedure, never by overwriting or silently
  unpublishing an accepted artifact.
- A package, API, documentation, authorization, isolation, or smoke mismatch
  blocks promotion. Do not bypass it with aliases, private routes, direct
  storage access, or weaker credentials.
- Do not delete persisted data or physical storage namespaces without a new
  required business/data-model review and explicit approval.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This capstone's dependency boundary, release evidence, documentation reconciliation, protected promotion, exclusions, constraints, and acceptance criteria. | Substantive capstone implementation. |
| Interface | Required | Requesting user or delegated API/package owner | Release-level beta contract inventory linking the accepted HTTP/OpenAPI, capability, SDK, compatibility, migration, and version-policy artifacts. | Freezing the beta contract, publishing packages, or promoting production. |
| Business and data model | Not applicable: the capstone consumes reviewed implementation outcomes and prohibits persisted-data or lifecycle migration. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user or delegated release owner | Release plan covering dependency convergence, exact-revision provenance, npm and service sequencing, smoke ordering, observability, partial-failure recovery, and rollback. | Running protected npm publication or production promotion. |
| Delivery acceptance | Required | Requesting user | Exact primary revision, published npm registry evidence, deployed App/Space v1 API and documentation checks, cleanup inventory result, automated validation, and live smoke evidence. | Running `task complete` for the exact approved primary commit. |

## References

- [App-user API guide](/docs/app-user-api/README.md)
- [Deployment and local configuration](/docs/deployment-and-local-configuration.md)
- [CAS operations](/docs/cas-operations.md)
- [Package boundaries](/packages/README.md)
- [Completed direct node upload](/tasks/complete-direct-node-upload/Task.md)
- [Completed Space operation permissions](/tasks/split-app-space-operation-permissions/Task.md)
- [Directional Root Ref API task](/tasks/split-root-ref-update-api/Task.md)
- [App/Space concept refactor](/tasks/complete-app-space-concept-refactor/Task.md)
- [File upload smoke App](/tasks/build-file-upload-smoke-app/Task.md)
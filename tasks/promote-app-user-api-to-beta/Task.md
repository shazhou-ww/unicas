# Promote the App-user API and SDKs to beta

Created: 2026-09-21

## Goal

Ship the first production-verified beta generation of the UniCAS App-user data
plane as an App/Space `/v1` HTTP API with published npm SDKs and canonical
documentation, then remove the old Stack/Tenant v1 and prototype App/Space v2
surfaces so one public contract remains.

## Context

The App-user surface has moved beyond its prototype. The newer contract uses
App/Space `/v2` routes, lease-driven direct node upload, and Space capability
claim `ver: 3` with exact operation permissions. A separate older
Stack/Tenant v1 contract remains in the protocol, service, clients, OpenAPI,
tests, and compatibility adapters.

Neither generation has been accepted as the formal public baseline. The beta
release will restart the supported HTTP version sequence at App/Space `/v1`
rather than preserving prototype numbering. The old Stack/Tenant v1 may be
removed; it does not retain a compatibility claim against the released
App/Space v1 API.

The SDK packages remain at `0.1.0` and have package-level `publishConfig`, but
the repository has no reviewed npm release contract or protected publication
workflow. Package names and compatibility treatment also depend on the
backlog App/Space concept refactor. The backlog Root Ref direction split may
still change the final mutation surface, and the ongoing file upload smoke App
is intended to validate the same boundary from an independent consumer.

## Scope

- Produce and approve one beta contract inventory covering every supported
  App-user HTTP operation, request and response schema, error, capability
  claim, permission, limit, retry rule, compatibility promise, and generated
  OpenAPI artifact.
- Replace the prototype `/v2/apps/{appId}/spaces/{spaceId}` route family with
  the released `/v1/apps/{appId}/spaces/{spaceId}` route family across protocol
  contracts, route builders, clients, service routing, generated OpenAPI,
  smoke tests, examples, documentation, and deployment verification.
- Make an explicit interface decision on the released Space capability claim
  version. Decide whether prototype `ver: 3` resets to `ver: 1` with the HTTP
  baseline or remains independently versioned, then use exactly one released
  claim grammar and permission vocabulary everywhere.
- Resolve all known pre-beta public-contract decisions. Consume the accepted
  outcome of `split-root-ref-update-api` rather than duplicating its Root Ref
  design, and do not freeze beta while that task remains an unresolved planned
  breaking change.
- Remove the old Stack/Tenant route family, capability claims and permission
  parser, protocol and OpenAPI contract, client construction and exports,
  service authorization and routing, compatibility adapters, configuration,
  examples, documentation, and tests after the App/Space v1 replacement is
  validated.
- Remove prototype App/Space v2 route builders, operation identifiers,
  generated artifacts, documentation names, compatibility flags, legacy
  broad-permission acceptance, and other superseded issuance or request paths.
  Do not retain unbounded aliases between prototype and released contracts.
- Finalize the canonical App-user documentation with installation guidance,
  complete browser and backend request flows, least-privilege capability
  issuance, migration from prototype contracts, and explicit HTTP,
  capability, SDK, and product-maturity version axes.
- Define the supported public SDK package set after consuming the accepted
  package names and compatibility outcome of
  `complete-app-space-concept-refactor`. Cover the protocol, transport, blob,
  file, browser-cache, and codec layers that are intentionally public without
  publishing service implementations or private applications.
- Finalize package metadata, exports, declaration output, dependency ranges,
  runtime and browser support, README and license inclusion, semantic version,
  prerelease or dist-tag policy, and package dependency publication order.
- Add a protected, repeatable npm publication path using repository-approved
  identity and provenance. It must build and test the exact release revision,
  reject version or generated-artifact drift, avoid long-lived registry tokens
  where trusted publishing is available, and never overwrite an existing npm
  version.
- Pack every public SDK package and validate its actual tarball from a clean
  external-consumer fixture. Verify dependency resolution and representative
  Node and browser-facing imports without relying on workspace source paths.
- Deploy the finalized App/Space v1 API and documentation through the existing
  protected `release` workflow, then verify the public API origin, generated
  contract, documentation, authorization denials, direct upload, Root Ref
  lifecycle, reads, isolation, and cleanup against the deployed revision.
- Consume the independently deployed file upload smoke App for end-to-end beta
  evidence when its task is complete; do not add a privileged test-only UniCAS
  route or private storage shortcut.
- Inventory any remaining deprecated route, type, export, package alias,
  configuration flag, adapter, fixture, generated artifact, and documentation
  reference. Remove accepted obsolete entries and add guards that prevent the
  retired Stack/Tenant v1 and prototype App/Space v2 surfaces from returning.
- Document beta support expectations, rollout order, observability, npm and
  service failure recovery, package deprecation procedure, and the path from
  beta to a future stable release.

## Out of scope

- Adding new App-user product features, storage semantics, business entities,
  or administrator-plane operations solely for the beta label.
- Reimplementing the directional Root Ref work, package-family naming refactor,
  or file upload smoke App already owned by their existing repository tasks.
- Deleting persisted customer or smoke data merely because its schema or key
  uses a historical Stack/Tenant name. Any destructive data migration requires
  a reviewed data-model decision and recovery plan.
- Publishing `@unicas/service`, `@unicas/service-cloudflare`, administrator
  packages, private WebUIs, or first-party application stacks as App-user SDKs.
- Claiming stable `1.0` compatibility, general availability, or an indefinite
  beta support lifetime.
- Performing an unreviewed production deployment, npm publication, package
  unpublish, destructive migration, or secret provisioning during task
  registration.

## Acceptance criteria

- [ ] A reviewed beta contract inventory identifies the exact App/Space v1
      operations, capability claim version and grammar, permission matrix,
      schemas, errors, limits, retry semantics, SDK package names and exports,
      and compatibility policy, with no unresolved planned breaking App-user
      change at the freeze point.
- [ ] The only released App-user base path is
      `/v1/apps/{appId}/spaces/{spaceId}`; protocol constants, route builders,
      service matching, generated OpenAPI, SDK calls, examples, smoke tests,
      and documentation agree on it.
- [ ] `split-root-ref-update-api` is either completed and integrated before the
      freeze or explicitly excluded through an accountable lifecycle decision;
      the beta docs, OpenAPI, service, clients, and migration guidance agree
      with that outcome.
- [ ] The accepted output of `complete-app-space-concept-refactor` determines
      final public package names and internal App/Space boundaries before npm
      publication; this task does not preserve temporary names by accident.
- [ ] The released Space capability claim uses the one version approved during
      interface review. No old Stack/Tenant v1 claim, prototype claim grammar,
      broad permission, or migration cutoff can authorize an App/Space v1
      request.
- [ ] Old Stack/Tenant routes and prototype App/Space v2 routes return no
      supported operation and are absent from protocol exports, route builders,
      clients, service dispatch, generated OpenAPI, maintained examples, and
      current documentation.
- [ ] The old Stack/Tenant capability parser, client factory and types,
      compatibility adapters, v1-only tests, and obsolete configuration are
      removed; replacement App/Space v1 coverage proves equivalent intended
      behavior and rejects cross-version or legacy authority.
- [ ] The App-user HTTP implementation, generated OpenAPI, SDK methods,
      examples, and documentation expose one consistent beta contract and
      clearly distinguish HTTP versioning, capability versioning, package
      semver, and product maturity.
- [ ] Every supported SDK package produces a minimal tarball containing the
      declared JavaScript, type declarations, required generated contracts,
      README, and license, with no source-only entry point, workspace-only
      dependency specifier, credential, local path, test fixture, or unrelated
      build artifact.
- [ ] A clean external-consumer test installs only the packed artifacts and
      passes representative protocol, transport, direct-upload, blob, file,
      and browser-cache import and usage checks for each advertised runtime.
- [ ] A protected npm workflow publishes immutable versions in dependency order
      with provenance and the reviewed beta version or dist-tag policy, fails
      closed on an existing version or validation drift, and can be rerun
      without republishing completed versions incorrectly.
- [ ] Registry verification confirms the expected public package names,
      versions, dist-tags, provenance, exports, dependency ranges, and clean
      installation from npm rather than the workspace.
- [ ] The existing protected release path deploys the exact validated App/Space
      v1 API and documentation revision. Production health, contract,
      capability, direct upload, Root Ref, readback, cross-App and cross-Space
      denial, and bounded cleanup checks pass without exposing credentials or
      user data.
- [ ] The deployed documentation gives an App team a complete setup-to-request
      path, names the supported SDK entry points, and contains no old
      Stack/Tenant or prototype App/Space v2 guidance.
- [ ] A focused repository guard rejects reintroduction of retired public
      routes, capability grammars, client exports, package aliases,
      configuration, generated contracts, and current-documentation terms.
- [ ] Any retained historical storage name or compatibility adapter is
      documented with its owner, reason, isolation boundary, and removal
      condition; no retained internal name leaks into the App/Space v1 wire or
      SDK surface.
- [ ] Package tests, external-consumer tests, OpenAPI drift checks,
      documentation checks, workspace boundary checks, build, typecheck,
      exhaustive tests, deployment dry-runs, protected publication, and live
      post-deployment smoke checks pass for the release candidate.
- [ ] The user explicitly accepts the published npm packages, deployed API and
      documentation, legacy cleanup result, and validation evidence for the
      exact reviewed primary commit.

## Constraints

- Treat the App/Space `/v2` and Stack/Tenant v1 surfaces as unpublished
  prototype contracts, not as compatibility aliases that constrain the first
  supported App/Space v1 release.
- Treat `origin/main` as the source of accepted contract state and use the
  existing protected `release` branch workflow for production promotion. Do
  not deploy directly from an implementation branch or mutable local build.
- Preserve the administrator and App-user credential boundary. npm, Cloudflare,
  OAuth, capability-signing, and smoke credentials stay in approved secret
  stores and never enter source, task artifacts, package tarballs, logs, or
  generated documentation.
- Keep generated OpenAPI and package outputs reproducible from source. Do not
  hand-edit generated artifacts or publish from a dirty workspace.
- Keep public SDK dependency direction aligned with the reviewed package
  architecture; public clients may depend on protocol and codec layers, but
  must not acquire runtime dependencies on service implementations,
  administrator packages, private stacks, or `@unidocs/*`.
- Make cleanup inventory-driven. Search source, exports, generated files,
  tests, docs, configuration, and known consumers before deletion, and land
  migrations and compatibility notes with each accepted removal.
- Do not delete persisted data or physical storage namespaces without the
  business/data-model checkpoint becoming required and receiving explicit
  approval.
- npm versions are immutable. A failed partial publication is recovered with a
  new reviewed version and correct deprecation or dist-tag changes, never by
  overwriting or silently unpublishing an accepted artifact.
- Coordinate release ordering with `build-file-upload-smoke-app`; a consumer
  incompatibility blocks beta promotion rather than being bypassed with a
  private API or storage binding.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's App/Space v1 beta outcome, dependencies, included release and cleanup work, exclusions, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | Required | Requesting user or delegated API/package owner | Task-local beta contract review containing the exact App/Space v1 HTTP/OpenAPI surface, released capability claim version, SDK package and export matrix, semantic-version and dist-tag policy, compatibility break, migration path, and removal inventory. | Renumbering routes or claims, changing public surfaces, deleting compatibility APIs, or publishing packages. |
| Business and data model | Assess during execution: required if retiring v1 requires persisted-data, schema, key, or lifecycle migration rather than code and interface removal only. | Requesting user or delegated data owner | Task-local legacy-data assessment and, when applicable, migration and recovery review. | Modifying or deleting persisted data, schemas, keys, or lifecycle state. |
| Architecture | Required | Requesting user or delegated release owner | Task-local architecture covering version cutover, package dependency order, trusted npm publication, artifact provenance, protected API/docs deployment, smoke sequencing, observability, partial-failure recovery, and rollback. | Removing compatibility implementations, adding publication automation, changing release workflows, or performing beta deployment. |
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
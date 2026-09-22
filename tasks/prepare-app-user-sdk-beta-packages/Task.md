# Prepare the App-user SDK beta packages

Created: 2026-09-21

## Goal

Produce a reviewed set of publishable App-user SDK beta tarballs whose package
names, exports, declarations, dependencies, runtime support, metadata, and
external-consumer behavior match the final App/Space v1 contract, together
with a protected tag-triggered GitHub Action that publishes the complete
unified-version package set.

## Context

The App-user package family provides protocol, transport, blob, file,
browser-cache, and codec layers, but the current packages have not been
reviewed as an npm release set. Workspace builds can hide missing files,
source-only exports, undeclared dependencies, and `workspace:` ranges that
fail for consumers installing packed artifacts.

Final package names and compatibility treatment depend on the App/Space
concept refactor. The supported methods and protocol exports also depend on
the App/Space v1 cutover and Stack/Tenant retirement. This task turns that
settled source surface into reproducible release artifacts and one automatic
publication path. The separate `publish-app-user-sdk-beta` task owns external
npm trusted-publisher configuration, the explicit first-release authorization,
creation of the immutable release tag, workflow observation, recovery, and
registry verification.

## Scope

- Define and approve the public App-user package set after consuming the final
  package names and compatibility decision from the App/Space concept
  refactor. Cover only the protocol, transport, blob, file, browser-cache, and
  codec layers intentionally supported for external use.
- Define the package and export matrix, supported Node and browser runtimes,
  one package-set semantic version or prerelease policy, npm dist-tag policy,
  dependency ranges, and dependency publication order. Every public package
  in one release must have the same exact version.
- Finalize each public package manifest, entry points, conditional exports,
  type declarations, runtime files, `files` allowlist, side-effect metadata
  where applicable, README, license inclusion, repository metadata, and
  supported-engine declarations.
- Ensure packed manifests resolve only published dependencies with valid
  registry ranges and do not expose workspace-only specifiers, source paths,
  private packages, or implementation-only entry points.
- Build and pack every public SDK package from a clean release-like checkout,
  inspect the actual tarball contents, and generate a deterministic non-secret
  release manifest for later publication verification.
- Add a clean external-consumer fixture that installs only the packed
  tarballs, without workspace source resolution or implicit monorepo links.
- Verify representative Node and browser-facing imports and usage across the
  protocol, transport, direct-upload, blob, file, browser-cache, and codec
  layers using public entry points only.
- Add focused CI or repository checks for package metadata, generated
  declarations and contracts, tarball contents, dependency order, external
  installation, runtime exports, and release-manifest drift.
- Add one protected GitHub Actions workflow triggered only by an immutable
  `npm/app-user-sdk/v<version>` tag. It must verify that the tag version, all
  six package versions, packed manifests, and release manifest agree before
  publishing the complete package set in dependency order under the reviewed
  dist-tag with npm trusted-publishing provenance.
- Add a local tag/release planner and workflow tests that fail closed for a
  tag not reachable from primary, a noncanonical or mismatched version, an
  incomplete package set, existing-version conflicts, release-manifest drift,
  unsafe permissions, or any attempt to use a long-lived npm token.
- Document installation, supported entry points and runtimes, package
  relationships, beta compatibility policy, and consumer migration from any
  prototype package names or exports.

## Out of scope

- Choosing temporary package names before
  `complete-app-space-concept-refactor` is accepted.
- Changing the App/Space v1 HTTP, capability, permission, or Root Ref contract.
- Retaining Stack/Tenant API exports or package aliases contrary to the
  reviewed cleanup and compatibility decisions.
- Creating or pushing a release tag, configuring the npm organization or
  package trusted-publisher records, approving the GitHub `npm` environment,
  executing the first registry write, moving a live dist-tag, or verifying a
  live npm release. Those operational actions belong to
  `publish-app-user-sdk-beta`.
- Publishing service implementations, Cloudflare adapters, administrator
  packages, private WebUIs, first-party application stacks, tests, fixtures,
  or `@unidocs/*` dependencies.
- Provisioning credentials or validating a live production deployment.

## Acceptance criteria

- [ ] A reviewed package matrix identifies every supported public package,
      package name, version policy, dist-tag policy, runtime, entry point,
      export, dependency range, and publication-order edge.
- [ ] One reviewed version is applied uniformly to all six public package
  manifests and every internal packed dependency resolves to that exact
  version; mixed-version release sets fail validation.
- [ ] The accepted App/Space concept-refactor output determines final package
      names and compatibility behavior; no temporary Stack/Tenant name or
      alias is preserved accidentally.
- [ ] Each package builds JavaScript and type declarations from source and its
      manifest exports only files present in the packed artifact for every
      advertised runtime and module mode.
- [ ] Every tarball contains only the required JavaScript, declarations,
      generated public contracts, README, license, and package metadata, with
      no credentials, local paths, source-only entry points, test fixtures,
      build caches, or unrelated artifacts.
- [ ] Packed manifests contain no unresolved `workspace:` specifier and no
      dependency on service implementations, administrator packages, private
      applications, or `@unidocs/*`.
- [ ] A clean external-consumer fixture installs only the packed artifacts in
      dependency order and cannot resolve imports through workspace source or
      monorepo links.
- [ ] Representative Node and browser-facing checks pass for every advertised
      package and cover protocol construction, transport configuration,
      lease-driven direct upload, blob and file operations, browser caching,
      and codec round trips through public entry points.
- [ ] The generated release manifest records expected package names, versions,
      tarball integrity, exports, dependency ranges, and publication order and
      fails validation when source or generated artifacts drift.
- [ ] A tag-triggered GitHub Action accepts only
  `npm/app-user-sdk/v<version>`, verifies the tag target is an accepted
  primary revision, rebuilds and validates the deterministic package set,
  performs registry preflight, and publishes all packages in dependency
  order with public access, the reviewed dist-tag, trusted identity, and
  provenance.
- [ ] Workflow and planner tests prove that no branch push, pull request,
  manual dispatch, noncanonical tag, mixed version, stale manifest,
  existing immutable version, missing dependency, or token-based fallback
  can cause a registry write.
- [ ] Installation and migration documentation agrees with the packed
      artifacts and clearly distinguishes package semver, HTTP version,
      capability version, and beta product maturity.
- [ ] Focused package tests, external-consumer tests, generated-artifact
      checks, workspace-boundary checks, build, typecheck, and exhaustive tests
      pass from a clean checkout.
- [ ] The user explicitly accepts the public package set and packed artifacts
      for the exact reviewed primary commit.

## Constraints

- Complete and integrate `complete-app-space-concept-refactor`,
  `cut-over-app-space-api-to-v1`, and `retire-stack-tenant-data-plane` before
  freezing package names, exports, and tarballs.
- Preserve the dependency direction from higher-level clients through
  transport to protocol and codec packages; do not introduce cycles or
  runtime dependencies on service or administrator implementations.
- Use package-manager and registry-compatible structured metadata rather than
  rewriting packed manifests with ad hoc string substitution.
- Build and pack from maintained source; do not hand-edit generated
  declarations, OpenAPI, bundled output, or tarball contents.
- Keep fixtures hermetic and credential-free. External-consumer validation may
  use mocks or local test servers but must not depend on private bindings or
  production secrets.
- Do not create or push a release tag, publish or reserve an npm version, move
  a live dist-tag, or configure external npm/GitHub environment state during
  task implementation or review. The implemented Action remains inert until
  the protected publication task explicitly authorizes and pushes its first
  immutable tag.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's public package boundary, artifact and consumer validation, publication exclusion, dependencies, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | Required | Requesting user or delegated package owner | Task-local package and release-trigger contract containing names, one unified version and dist-tag, exports, runtime support, dependency ranges, tag grammar, compatibility treatment, installation guidance, and migration path. | Changing manifests or public exports, versioning packages, encoding the tag contract, or removing compatibility names. |
| Business and data model | Not applicable: package assembly changes distribution metadata and executable artifacts without changing domain entities, ownership, persistence, or lifecycle. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user or delegated SDK/release owner | Task-local package graph and publication design covering dependency direction, build and pack inputs, declaration generation, tarball policy, clean consumer fixtures, runtime matrix, release manifest, tag-triggered GitHub Action, trusted-publishing permissions, preflight, ordering, and fail-closed tests. | Changing package boundaries, build outputs, dependency graphs, CI validation, or adding the publication Action. |
| Delivery acceptance | Required | Requesting user | Published implementation, package and export matrix, packed-artifact inventory, external-consumer results, release manifest, and workspace validation. | Running `task complete` for the exact approved primary commit. |

## References

- [Beta promotion capstone](/tasks/promote-app-user-api-to-beta/Task.md)
- [App/Space concept refactor](/tasks/complete-app-space-concept-refactor/Task.md)
- [App/Space v1 cutover](/tasks/cut-over-app-space-api-to-v1/Task.md)
- [Stack/Tenant data-plane retirement](/tasks/retire-stack-tenant-data-plane/Task.md)
- [Package boundaries](/packages/README.md)
- [App-user API guide](/packages/docs-site/content/app-user-api/README.md)
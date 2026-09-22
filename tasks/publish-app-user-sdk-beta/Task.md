# Publish the App-user SDK beta packages

Created: 2026-09-21

## Goal

Activate and use the prepared tag-triggered npm publication path to publish
the reviewed unified-version App-user SDK beta package set from an exact
primary revision with trusted identity, provenance, immutable-version safety,
and registry-backed verification.

## Context

The package-preparation task owns the accepted release contract, unified
versions, deterministic tarballs and release manifest, release planner, and
tag-triggered GitHub workflow. Manual local publication would not prove which
revision was built, whether generated files or tarballs drifted, whether
packages were ordered correctly, or whether an existing immutable version was
handled safely.

This task consumes that immutable input and owns external npm trusted-publisher
identity, GitHub environment protection, explicit authorization and creation
of the first `npm/app-user-sdk/v<version>` tag, workflow observation,
partial-failure recovery decisions, and npm verification. It does not redesign
package contents or the workflow while releasing them.

## Scope

- Review the prepared npm release contract and prove the exact package set,
  unified version, dist-tag, dependency order, registry visibility,
  provenance, rerun behavior, and first-beta promotion sequence are still
  current.
- Configure and verify repository-approved npm trusted publishing plus the
  protected GitHub `npm` environment with least privilege and no long-lived
  registry token.
- Authorize and create one immutable
  `npm/app-user-sdk/v<package-set-version>` tag at the exact accepted primary
  revision. Tag creation is the sole publication instruction.
- Verify the package-preparation release manifest and fail closed on source,
  generated-artifact, dependency, version, tarball, or working-tree drift.
- Query npm before each write, reject an unexpected existing version, and
  verify any already-published package before treating a retry as complete.
- Observe the prepared Action publishing packages in dependency order and
  applying the reviewed dist-tag only when the required package set is present
  and verified; do not invoke a second publication command.
- Make reruns safe after interruption without overwriting versions,
  republishing completed artifacts incorrectly, or advancing tags to an
  incomplete or inconsistent package set.
- Document partial-publication recovery using a new reviewed version and
  deliberate deprecation or dist-tag correction; never silently unpublish or
  overwrite an accepted artifact.
- Add registry verification that checks names, versions, dist-tags,
  provenance, exports, dependency ranges, integrity, and clean installation
  and representative use from npm rather than workspace paths.
- Keep workflow logs and retained evidence free of tokens, credentials,
  unpublished package contents, local paths, and customer data.
- Execute the first beta publication only after explicit authorization names
  the exact primary revision, package versions, dist-tag policy, and successful
  dry-run evidence.

## Out of scope

- Choosing package names, exports, dependency ranges, runtime support, or
  tarball contents before `prepare-app-user-sdk-beta-packages` is accepted.
- Adding a second publication workflow, changing the tag grammar, independently
  versioning one package, or redesigning the prepared Action during release.
- Changing the App/Space HTTP, capability, authorization, storage, or business
  contract while preparing a release.
- Publishing service implementations, Cloudflare adapters, administrator
  packages, private WebUIs, first-party applications, or `@unidocs/*`.
- Provisioning registry credentials in source, task artifacts, logs, or local
  configuration, or bypassing repository environment protection.
- Overwriting or silently unpublishing an npm version after a failed or
  partial release.
- Deploying the UniCAS API or documentation service; production assembly and
  live service verification belong to the beta promotion capstone.

## Acceptance criteria

- [ ] The prepared release contract identifies the exact public packages, one
  unified version, dist-tag, dependency order, visibility, trusted
  identity, provenance, approval gates, tag grammar, rerun semantics, and
  recovery procedure, and remains unchanged during execution.
- [ ] The prepared protected workflow and planner pass their complete dry-run
  and negative test suite for the exact accepted primary revision before
  any release tag is created.
- [ ] Publication uses repository-approved trusted publishing with provenance
      and least privilege; no long-lived npm token is required where the
      registry supports trusted identity.
- [ ] The workflow validates the accepted release manifest and actual tarballs
      and fails closed on version, dependency, generated-artifact, integrity,
      export, or package-set drift.
- [ ] Registry preflight prevents overwriting an existing version and accepts
      an already-published package during a retry only after verifying it
      matches the expected immutable release evidence.
- [ ] Packages publish in dependency order, and the reviewed beta dist-tag is
      not left pointing to an incomplete or inconsistent package set after a
      failed run.
- [ ] A documented partial-publication recovery uses a new reviewed version
      plus deliberate deprecation or dist-tag repair and never overwrites or
      silently unpublishes an accepted artifact.
- [ ] Workflow dry-run and negative tests cover non-primary revisions, dirty or
      drifting artifacts, existing-version conflicts, missing dependencies,
      interrupted publication, mismatched registry state, and unauthorized
      execution.
- [ ] Registry verification confirms expected public names, versions,
      dist-tags, provenance, integrity, exports, and dependency ranges and a
      clean consumer can install and use the packages from npm.
- [ ] Logs, artifacts, workflow metadata, and task evidence contain no npm
      token, OIDC assertion, credential, private key, presigned URL, local
      secret, or customer data.
- [ ] The user explicitly accepts the published packages and registry evidence
      for the exact reviewed primary commit.

## Constraints

- Complete and integrate `prepare-app-user-sdk-beta-packages` before adding
  external trusted-publisher configuration, creating a release tag, or
  performing any registry write.
- Treat npm versions as immutable. A version conflict or evidence mismatch
  fails closed and requires investigation or a new reviewed version.
- Require explicit user or delegated release-owner authorization immediately
  before the first registry write; authorization must identify the exact
  primary commit, one package-set version, dist-tag, immutable tag, and
  successful dry-run evidence.
- Use the repository's protected workflow and approved identity boundary;
  never publish directly from a developer worktree or expose credentials to a
  build, pull request, fork, package script, or untrusted environment.
- Keep build, pack, and external-consumer validation reproducible from source;
  do not patch a tarball or generated output in the publication job.
- Do not couple npm recovery to service rollback. Package deprecation and
  dist-tag repair follow their reviewed procedure because published versions
  cannot be revoked as if they were a deployable service revision.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's protected publication outcome, registry boundary, package-preparation dependency, exclusions, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | Required | Requesting user or delegated package owner | Review of the prepared release contract covering exact packages, unified version, tag, dist-tag, visibility, registry metadata, compatibility expectations, and consumer verification. | Creating the first release tag or publishing packages. |
| Business and data model | Not applicable: npm distribution changes package availability and metadata without changing UniCAS domain entities, persisted customer data, ownership, or lifecycle. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user or delegated release owner | Activation plan for the prepared publication design covering trusted identity, environment protection, exact-revision provenance, immutable tag creation, registry preflight, workflow observation, reruns, partial-failure recovery, and audit evidence. | Configuring trusted publication, creating the tag, or performing the first registry write. |
| Delivery acceptance | Required | Requesting user | Published workflow, dry-run and negative-test evidence, exact primary revision, npm provenance and registry checks, clean registry-consumer validation, and recorded recovery behavior. | Running `task complete` for the exact approved primary commit. |

## References

- [Beta promotion capstone](/tasks/promote-app-user-api-to-beta/Task.md)
- [App-user SDK beta package preparation](/tasks/prepare-app-user-sdk-beta-packages/Task.md)
- [Package boundaries](/packages/README.md)
- [Deployment and local configuration](/packages/docs-site/content/deployment-and-local-configuration.md)
- [CAS operations](/packages/docs-site/content/cas-operations.md)
# Build a file upload smoke App

Created: 2026-09-20

## Goal

Build and operate a small independently deployed file upload service that uses
only the public UniCAS App/Space API and published client packages, then run it
after UniCAS deployments as the canonical end-to-end smoke target for real
capability issuance, direct node upload, file commit, download, and retention.

## Context

The management-plane Playground and managed issuer were retired because they
bypassed the integration boundaries that customer applications must implement.
The completed lease-driven direct upload task now has comprehensive protocol,
client, kernel, Cloudflare, and mock-transport coverage, but its live smoke
still depends on manually configured environment variables and does not test a
maintained application-owned file workflow.

The abandoned
[reference file App task](/tasks/replace-playground-with-reference-app/Task.md)
combined a broad product, tutorial, Console removal, and legacy-data migration.
Those cleanup concerns are already complete or no longer needed. This task is a
narrow replacement: one production-like test App whose primary purpose is to
exercise deployed UniCAS through the same public interfaces available to an
external application.

## Scope

- Choose and review the repository, package, and deployment boundary for a
  separately deployed first-party file upload smoke App.
- Build the App as a Cloudflare full-stack service deployed at
  `spaces.unicas.work`, with a responsive user interface that follows the
  existing UniCAS Console visual language without importing administrator UI
  workflows or data-plane credentials.
- Give the App ownership of its OAuth issuer, end-user or smoke principal,
  Principal-to-Space mapping, capability issuance, and file-root catalog.
- Design authentication around provider-neutral external identities for
  Google, Microsoft, and GitHub. Implement Google sign-in for the MVP and keep
  Microsoft and GitHub unavailable until their reviewed integrations are
  implemented; do not expose either as an enabled login path.
- Use only documented public UniCAS packages and App/Space HTTP routes. Do not
  import service implementation modules, use administrator sessions as data
  credentials, access UniCAS D1/R2 bindings, or add a privileged smoke-only
  endpoint to UniCAS.
- Implement the smallest useful file workflow: upload a file through the public
  file/blob clients, create and navigate folders, upload into the selected
  folder, rename files, commit the file-system root with a positive
  Root Ref, download and verify exact bytes, then release test data through an
  idempotent cleanup path.
- Exercise the lease-driven direct upload path, including the initial lease,
  presigned PUT, repeated identical lease, ready-node reuse, and at least one
  multi-node file whose index references uploaded children.
- Deploy an isolated maintained instance with dedicated test App, Space,
  issuer, credentials, business catalog, and bounded test-data lifecycle.
- Add a non-interactive smoke command suitable for the protected `release`
  workflow. It must verify authentication, upload, commit, readback, isolation,
  and cleanup without printing credentials, capabilities, presigned URLs, or
  uploaded content.
- Integrate the smoke command after UniCAS service deployment and before later
  release artifacts are promoted. A failed smoke must fail the deployment job
  with actionable, non-secret output.
- Document local setup, production secret and CORS prerequisites, App/Space
  bootstrap, deployment ownership, smoke operation, cleanup, rotation, and
  incident recovery.
- Add focused unit, integration, browser or HTTP, deployment-plan, and live
  smoke validation appropriate to the accepted implementation.

## Out of scope

- Restoring the Console Playground, managed issuer, managed capability minting,
  or implicit `(App, Account) -> Space` mapping.
- Migrating or deleting historical Playground records or content.
- Building a general-purpose drive, collaboration product, sharing system,
  synchronization engine, previews, version history, or a full file-management
  tutorial beyond the reviewed folder, navigation, upload, rename, download,
  and delete workflow.
- Changing UniCAS node identity, lease, Root Ref, authorization, usage,
  garbage-collection, or direct-upload semantics solely for the smoke App.
- Giving the App private UniCAS bindings or deployment credentials unavailable
  to customer applications.
- Running production deployment or creating production credentials as part of
  task registration.

## Acceptance criteria

- [ ] The reviewed architecture places the App in an independently deployable
      boundary and mechanically prevents private UniCAS implementation imports
      or direct storage bindings.
- [ ] `spaces.unicas.work` serves the independently deployed Cloudflare App,
  and its responsive shell and interaction styling are consistent with the
  current Console without importing administrator workflows.
- [ ] The authentication model can bind Google, Microsoft, and GitHub external
  identities to an App Principal without provider-derived Space identity;
  the MVP implements and validates Google while leaving the other providers
  unavailable rather than presenting non-functional login paths.
- [ ] A dedicated external OAuth issuer authenticates the smoke principal and
      issues least-privileged, Space-scoped capabilities without a UniCAS admin
      session or managed issuer.
- [ ] The App owns its Principal-to-Space mapping and file-root catalog; UniCAS
      stores only opaque canonical nodes, leases, edges, and Root Refs.
- [ ] An authenticated user can create folders, navigate the hierarchy, upload
  into the currently selected folder, and rename files without re-uploading
  unchanged file bytes.
- [ ] The deployed App uploads a multi-node file through published clients and
      the public lease-driven direct upload API, commits a positive Root Ref,
      downloads the file, and verifies exact bytes.
- [ ] A second run reuses immutable ready nodes where hashes match and does not
      require client-visible upload IDs, upload lengths, inline node bodies, or
      upload-mode selection.
- [ ] The smoke proves App/Space isolation and least privilege, including at
      least one denied request outside the configured Space or authority.
- [ ] Test data is uniquely named, bounded, released in an idempotent cleanup
      path, and cannot accumulate indefinitely after interrupted smoke runs.
- [ ] The protected production workflow invokes the App smoke after service
      deployment and fails safely before later release artifacts on any upload,
      commit, readback, authorization, isolation, or cleanup failure.
- [ ] Logs and artifacts contain no credentials, capabilities, private keys,
      presigned URLs, production object keys, or uploaded customer data.
- [ ] Setup, deployment, CORS, key rotation, cleanup, and incident recovery are
      reproducible from stable documentation.
- [ ] Focused tests, workspace boundaries, build, typecheck, deployment dry-run,
      and an isolated live deployment smoke pass.
- [ ] The user explicitly accepts the deployed App and release-smoke integration
      for the exact reviewed primary commit.

## Constraints

- Keep administrator and App-user credentials separate. The App may use admin
  APIs during explicit bootstrap, but its runtime and smoke data path must use
  only App-issued Space capabilities.
- Use dedicated non-customer App, Space, catalog, issuer, keys, and uploaded
  data. Never reuse production customer identities or content.
- Keep signing keys, API tokens, capabilities, and presigned URLs only in
  approved secret stores and process memory.
- Preserve deterministic file and canonical-node hashes and use the published
  blob/file clients rather than reproducing their encoding logic in the App.
- Bound file size, node count, runtime, retries, retained roots, and cleanup
  work so the smoke cannot become an unbounded deployment dependency.
- Coordinate with
  [Space operation permissions](/tasks/split-app-space-operation-permissions/Task.md)
  and consume its final least-privilege vocabulary if that task lands first.
- Coordinate with
  [App/Space concept refactor](/tasks/complete-app-space-concept-refactor/Task.md)
  and update package names or imports to its accepted final surface rather than
  preserving temporary aliases.
- Never place credentials, bearer capabilities, private keys, presigned URLs,
  production identities, or uploaded data in source, task artifacts, fixtures,
  logs, screenshots, or commits.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This narrow smoke-App goal, included file workflow, release integration, exclusions, constraints, and acceptance criteria. | Substantive implementation. |
| Architecture | Required | Requesting user | Task-local design covering repository/package/deployment placement, trust boundaries, issuer and capability flow, App-owned catalog, UniCAS dependency boundary, release ordering, and failure recovery. | Scaffolding the App, provisioning deployment resources, or changing release workflows. |
| Business and data model | Required | Requesting user | App, Space, smoke Principal, file-root catalog, retained manifest, test-run identity, cleanup lifecycle, keys, and ownership/retention relationships. | Creating persistence, Root Ref lifecycle, or deployed test data. |
| Interface | Required | Requesting user | Smoke command contract and any user-facing upload/download surface, including inputs, outputs, error states, non-secret diagnostics, and automation behavior. | Implementing public App endpoints, UI, CLI, or release workflow invocation. |
| Delivery acceptance | Required | Requesting user | Integrated revision, deployed App, bootstrap evidence, live upload/commit/download/isolation/cleanup smoke, focused tests, deployment dry-run, and recorded limitations. | Running `task complete` for the exact approved primary commit. |

## References

- [Completed lease-driven direct upload](/tasks/complete-direct-node-upload/Task.md)
- [Abandoned broad reference App task](/tasks/replace-playground-with-reference-app/Task.md)
- [Retired Playground and managed issuer](/tasks/retire-playground-and-managed-issuer/Task.md)
- [App-user integration guide](/packages/docs-site/content/app-user-api/README.md)
- [Deployment and local configuration](/packages/docs-site/content/deployment-and-local-configuration.md)
- [CAS operations](/packages/docs-site/content/cas-operations.md)
- [Published client package boundaries](/packages/README.md)

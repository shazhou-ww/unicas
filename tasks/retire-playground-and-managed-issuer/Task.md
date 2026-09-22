# Retire Playground and managed issuer

Created: 2026-09-20

## Goal

Restore the UniCAS management plane to App and Space administration only by
removing all remaining Playground surfaces and retiring the built-in managed
OAuth issuer without changing the external OAuth issuer path or CAS data-plane
semantics.

## Context

The Playground file-root implementation and API have already been retired, but
residual tests, styles, protocol descriptions, deployment guidance, and related
implementation may remain. The managed issuer still provisions issuer state for
new Apps, mints managed capabilities, and derives personal Spaces from
`(App, Account)`. Those responsibilities belong to applications using the
standard external OAuth issuer contract, not to the UniCAS management plane.

This task supersedes the abandoned
[`replace-playground-with-reference-app`](/tasks/replace-playground-with-reference-app/Task.md)
task. It deliberately separates first-phase cleanup from any future design or
implementation of an independent file storage service.

## Scope

- Re-inventory and remove every remaining Playground-only skipped test, style,
  OpenAPI tag or description, deployment/documentation reference, generated
  artifact, and implementation surface.
- Stop automatic managed issuer provisioning for new Apps and remove managed
  issuer capability issuance and implicit `(App, Account) -> personal Space`
  mapping.
- Remove managed issuer surfaces from the Admin API, MCP, BFF, admin client,
  Console WebUI, public metadata/JWKS/authorize/token routes, discovery and
  verifier branches, persistence schema and indexes, Wrangler/local runtime
  signing-key configuration, generated OpenAPI, tests, and documentation.
- Preserve and test the standard external OAuth issuer configuration,
  discovery, capability verification, and App/Space administration paths.
- Define a staged production retirement runbook that separates code rollout
  from destructive data/key cleanup, preserves verification material for at
  least the current one-hour token TTL plus the 60-second verifier cache
  boundary, and requires explicit human approval before deleting production
  managed issuer rows or revoking/deleting signing keys.
- Keep protocol definitions, generated OpenAPI, checked-in generated outputs,
  implementation, tests, and directly related stable documentation consistent.

## Out of scope

- Designing, building, or deploying an independent file storage service,
  reference application, or replacement Playground.
- Changing CAS nodes, Root Refs, Space data, existing content, leases, usage, or
  garbage-collection semantics.
- Running production garbage collection or performing any production data
  deletion, signing-key revocation, or secret removal.
- Removing or weakening the standard external OAuth issuer capability.
- Unrelated Console, Platform Access, or administrator identity changes.

## Acceptance criteria

- [ ] A complete repository inventory finds no active Playground-only code,
      skipped tests, styling, protocol/OpenAPI descriptions, generated output,
      deployment configuration, or documentation outside intentional
      historical task records.
- [ ] Creating an App no longer provisions managed issuer state, and no runtime
      path can mint a managed capability or implicitly map `(App, Account)` to a
      personal Space.
- [ ] Managed issuer Admin API, MCP, BFF, client, WebUI, public OAuth routes,
      discovery/verifier branches, persistence objects, configuration, generated
      OpenAPI, tests, and current documentation are removed coherently.
- [ ] Standard external OAuth issuer configuration, discovery, verification,
      and App/Space management remain supported and covered by focused tests.
- [ ] Schema migration and operations documentation preserve already-issued
      token verification material through the one-hour TTL plus 60-second cache
      boundary and distinguish deploy-safe changes from explicitly approved
      production row/key deletion.
- [ ] No production data deletion, key revocation, secret deletion, or GC is
      executed by this task.
- [ ] The narrowest complete relevant test, typecheck, OpenAPI drift/generation,
      package-boundary, and build checks pass.
- [ ] The user approves the exact integrated primary commit for delivery.

## Constraints

- Treat `origin/main` as authoritative and preserve unrelated concurrent work.
- Use additive/staged migrations for deploy-safe code retirement; do not bundle
  destructive production cleanup into application deployment.
- Verification material for issued managed tokens remains available until at
  least 3,660 seconds after new managed issuance is disabled in production.
- Any production managed issuer row deletion, signing-key revocation/deletion,
  or secret removal requires a separate explicit human approval after the
  waiting boundary has elapsed.
- Preserve admin/data-plane separation and package dependency direction.
- Keep secrets, production identities, tokens, and customer data out of source,
  task artifacts, tests, logs, and commits.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This goal, included/excluded work, acceptance criteria, constraints, and supersession of the broader reference-app task. | Substantive implementation. |
| Business and data model | Required | Requesting user | Current/target App, Space, account mapping, external issuer, managed issuer, signing material, and retirement lifecycle model with migration effects. | Removing managed issuer persistence or mapping behavior. |
| Architecture | Required | Requesting user | Current/target control-plane, public OAuth, verifier, configuration, and deployment responsibilities plus staged cutover sequence. | Removing runtime routes, dependencies, and configuration. |
| Interface | Required | Requesting user | Removal inventory for Admin API, MCP, client, BFF, Console, OpenAPI, and public OAuth routes, including compatibility behavior. | Removing the affected interfaces. |
| Delivery acceptance | Required | Requesting user | Integrated revision, migration/runbook outcome, inventory, generated-artifact consistency, and validation evidence. | Running `task complete` for the exact approved primary commit. |

## References

- [Package and access-plane boundaries](/packages/README.md)
- [UniCAS architecture](/packages/docs-site/content/cas-architecture.md)
- [OAuth issuer migration](/packages/docs-site/content/cas-oauth-discovery-and-issuer-migration.md)
- [Deployment and local configuration](/packages/docs-site/content/deployment-and-local-configuration.md)
- [Operations](/packages/docs-site/content/cas-operations.md)

# Retire the Stack/Tenant App-user data plane

Created: 2026-09-21

## Goal

Remove the unpublished Stack/Tenant App-user HTTP, capability, client, service,
configuration, and compatibility surfaces after App/Space v1 is validated, so
the repository exposes and authorizes only the released App/Space contract.

## Context

The repository retains an older Stack/Tenant v1 generation alongside the
prototype App/Space implementation. It includes routes, capability claims and
permissions, protocol and OpenAPI types, client construction, service routing,
compatibility adapters, configuration, examples, documentation, and focused
tests.

The Stack/Tenant generation was never accepted as a supported public contract
and does not constrain the App/Space beta. Removal is intentionally separate
from the App/Space v1 cutover: the replacement must first be validated, then
the legacy authority and dispatch paths can be deleted without conflating
contract migration with cleanup. Historical persisted names are not evidence
that customer data may be deleted or rewritten.

## Scope

- Produce an inventory of maintained Stack/Tenant routes, operation IDs,
  protocol types, generated OpenAPI entries, capability claims, permission
  parsing, client exports, service branches, adapters, configuration, tests,
  fixtures, examples, and current-documentation references.
- Remove the old Stack/Tenant route family from route builders, service
  matching and dispatch, Cloudflare integration, generated OpenAPI, mocks,
  and supported deployment verification.
- Remove Stack/Tenant capability issuance and parsing, legacy permission
  vocabulary, broad-permission or migration-cutoff acceptance, and any
  authorization adapter that could grant App/Space authority.
- Remove old public protocol types, client factories, methods, exports, and
  compatibility adapters after their intended App/Space v1 replacement is
  covered.
- Remove obsolete environment variables, configuration fields, examples,
  current documentation, fixtures, and tests whose only purpose is the retired
  wire contract.
- Preserve and classify genuinely external vocabulary such as identity
  provider tenant IDs and any historical physical storage name that does not
  cross the released wire, SDK, or authorization boundary.
- Add focused source, export, generated-artifact, configuration, documentation,
  and runtime guards that reject reintroduction or dispatch of the retired
  Stack/Tenant surface.
- Document each retained compatibility adapter or historical storage name with
  its owner, reason, isolation boundary, and removal condition.

## Out of scope

- Implementing or renumbering the App/Space v1 contract, which belongs to
  `cut-over-app-space-api-to-v1`.
- Renaming canonical App/Space packages and internals solely for terminology;
  that belongs to `complete-app-space-concept-refactor`.
- Changing App/Space operations, capability semantics, permissions, storage
  behavior, or business entities beyond deleting legacy entry points.
- Deleting, rewriting, or migrating persisted customer or smoke data,
  physical object namespaces, Durable Object identities, or audit history.
- Removing third-party terminology such as Microsoft identity tenant IDs,
  JavaScript error stacks, or immutable historical task records.
- Preparing or publishing beta npm packages and performing production
  promotion.

## Acceptance criteria

- [ ] A reviewed removal inventory classifies every maintained Stack/Tenant
      occurrence as obsolete wire/API implementation, external terminology,
      historical storage, generated output, or explicitly retained adapter.
- [ ] Stack/Tenant App-user routes return no supported operation and are absent
      from protocol exports, route builders, service dispatch, generated
      OpenAPI, clients, examples, smoke commands, and current documentation.
- [ ] The old capability claim, permission parser, broad-permission and cutoff
      logic, issuance path, and authorization adapters cannot parse, issue, or
      authorize an App/Space v1 request.
- [ ] Old client factories, public methods, protocol types, compatibility
      exports, and obsolete configuration are removed without leaving package
      aliases that imply support for the retired contract.
- [ ] App/Space v1 replacement coverage proves every intended surviving
      behavior, including authorization denial and cross-App and cross-Space
      isolation, without routing through a legacy adapter.
- [ ] Guards fail when retired routes, claim grammars, permissions, exports,
      configuration fields, generated contracts, or current-documentation
      terms are reintroduced.
- [ ] Every retained historical storage name or compatibility adapter has a
      documented owner, reason, isolation boundary, and removal condition and
      cannot leak into the App/Space v1 wire or SDK surface.
- [ ] No persisted data, physical namespace, schema, key, or lifecycle state is
      deleted or migrated without a separately approved data-model decision
      and recovery plan.
- [ ] Focused protocol, client, service, Cloudflare, authorization, OpenAPI,
      documentation, source-scan, package-boundary, build, typecheck, and
      exhaustive tests pass.
- [ ] The user explicitly accepts the legacy removal and retained-name
      inventory for the exact reviewed primary commit.

## Constraints

- Complete and integrate `cut-over-app-space-api-to-v1` before removing any
  Stack/Tenant implementation needed to demonstrate replacement coverage.
- Treat the old surface as an unpublished prototype and do not preserve it
  through an unbounded alias, hidden route, permissive parser, or compatibility
  flag.
- Make deletion inventory-driven and land replacement coverage and migration
  notes with each accepted removal.
- Preserve administrator and App-user credential separation; legacy authority
  must fail closed rather than being translated into a released capability.
- Keep external provider vocabulary and historical storage details isolated in
  their owning modules instead of mechanically replacing matching words.
- Stop and require the business/data-model checkpoint if implementation would
  modify persisted schemas, keys, data, ownership, retention, or lifecycle
  state.
- Never hand-edit generated OpenAPI or build output; regenerate and verify it
  from maintained source.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's legacy-removal boundary, dependency on App/Space v1, retained-name policy, exclusions, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | Required | Requesting user or delegated API owner | Task-local removal inventory and compatibility review covering routes, claims, permissions, protocol and client exports, configuration, errors, migration guidance, and runtime rejection behavior. | Deleting public or compatibility interfaces. |
| Business and data model | Assess during execution: required if removal needs persisted-data, schema, key, ownership, retention, or lifecycle migration rather than code and interface deletion only. | Requesting user or delegated data owner | Legacy-data assessment and, when applicable, migration, isolation, backup, and recovery design. | Modifying or deleting persisted data, schemas, keys, or lifecycle state. |
| Architecture | Required | Requesting user or delegated service owner | Task-local removal design covering service and authorization branches, adapter boundaries, configuration cleanup, generated artifacts, guards, rollout order, and rollback. | Removing service, authorization, adapter, configuration, or deployment paths. |
| Delivery acceptance | Required | Requesting user | Published implementation, final classified scan, runtime rejection evidence, App/Space replacement coverage, workspace validation, and retained-name report. | Running `task complete` for the exact approved primary commit. |

## References

- [Beta promotion capstone](/tasks/promote-app-user-api-to-beta/Task.md)
- [App/Space v1 cutover](/tasks/cut-over-app-space-api-to-v1/Task.md)
- [App/Space concept refactor](/tasks/complete-app-space-concept-refactor/Task.md)
- [Repository glossary](/GLOSSARY.md)
- [App-user API guide](/packages/docs-site/content/app-user-api/README.md)
- [Package boundaries](/packages/README.md)
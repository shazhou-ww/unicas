# Cut over the App-user API to App/Space v1

Created: 2026-09-21

## Goal

Replace the prototype App/Space `/v2` HTTP and capability surface with one
reviewed App/Space `/v1` implementation across protocol, service, clients,
generated OpenAPI, tests, examples, and current documentation.

## Context

The current App-user implementation exposes the intended App/Space model under
`/v2/apps/{appId}/spaces/{spaceId}` because an older Stack/Tenant contract
already occupied the first HTTP version. Neither surface has been released as
a supported public baseline, so the beta contract may restart App/Space at
`/v1` without retaining a prototype `/v2` alias.

The final operation set depends on the directional Root Ref API, while package
and internal symbol names depend on the App/Space concept refactor. The
separate `retire-stack-tenant-data-plane` task removes the older Stack/Tenant
contract after this replacement is validated; this task keeps that legacy
surface isolated but does not remove it.

## Scope

- Produce and approve an App/Space v1 contract inventory covering every HTTP
  operation, operation identifier, request and response schema, error, limit,
  retry rule, idempotency rule, and generated OpenAPI entry.
- Decide whether the released Space capability claim retains the independently
  evolved prototype version or resets its claim version for beta, then define
  one exact released grammar and permission vocabulary.
- Replace App/Space `/v2/apps/{appId}/spaces/{spaceId}` constants, route
  builders, matchers, operation identifiers, and generated contracts with
  `/v1/apps/{appId}/spaces/{spaceId}` equivalents.
- Update public protocol types, client methods, higher-level client workflows,
  service dispatch, authorization, Cloudflare integration, mocks, fixtures,
  examples, and smoke commands to use the released App/Space v1 contract.
- Consume the accepted increase/decrease Root Ref operations and final exact
  Space permission vocabulary rather than freezing an obsolete mutation or
  broad-permission surface.
- Remove prototype App/Space v2 route builders, operation identifiers, claim
  issuance and acceptance paths, generated OpenAPI entries, examples,
  compatibility flags, and current-documentation references.
- Add focused compile-time, generated-artifact, source-scan, and runtime guards
  that reject reintroduction or accidental dispatch of the prototype
  App/Space v2 surface.
- Document migration from prototype App/Space v2 requests and capabilities to
  the released v1 contract, including changed Root Ref calls, version axes,
  and authorization failure behavior.

## Out of scope

- Removing the old Stack/Tenant route, claim, parser, client, adapter, or
  configuration surface; that belongs to `retire-stack-tenant-data-plane`.
- Renaming the data-plane package family or internal Stack/Tenant symbols;
  those outcomes belong to `complete-app-space-concept-refactor`.
- Redesigning directional Root Ref semantics owned by
  `split-root-ref-update-api`.
- Finalizing package tarballs, package versions, npm publication automation,
  registry promotion, or production deployment.
- Adding new App-user operations, storage semantics, business entities, or
  administrator-plane behavior solely for the version cutover.
- Migrating or deleting persisted data, physical object keys, Durable Object
  identities, or historical audit records.

## Acceptance criteria

- [ ] A reviewed contract inventory identifies every released App/Space v1
      operation, operation ID, schema, error, limit, retry and idempotency rule,
      capability requirement, and generated OpenAPI entry.
- [ ] The released App/Space base path is exactly
      `/v1/apps/{appId}/spaces/{spaceId}` across protocol constants, route
      builders, service matching, generated OpenAPI, SDK calls, examples,
      smoke commands, and current documentation.
- [ ] The released Space capability uses exactly the reviewed claim version,
      grammar, resource binding, and exact-operation permission vocabulary;
      prototype claims, broad permissions, and migration cutoffs cannot
      authorize App/Space v1 requests.
- [ ] The accepted directional Root Ref increase and decrease operations are
      represented consistently in protocol, OpenAPI, clients, service routing,
      authorization, examples, and migration guidance.
- [ ] Prototype `/v2/apps/{appId}/spaces/{spaceId}` routes return no supported
      operation and are absent from maintained exports, route builders,
      generated OpenAPI, clients, examples, and current documentation.
- [ ] Cross-version tests prove that prototype routes or capabilities cannot
      be mixed with the released v1 route and authority.
- [ ] The old Stack/Tenant surface remains behaviorally unchanged and isolated
      pending its dedicated retirement task; no temporary alias translates
      between it and App/Space v1.
- [ ] Protocol, client, higher-level workflow, service, Cloudflare, OpenAPI,
      authorization, smoke, documentation, source-scan, build, typecheck, and
      exhaustive tests pass.
- [ ] The user explicitly accepts the App/Space v1 contract and prototype v2
      removal for the exact reviewed primary commit.

## Constraints

- Complete and integrate `complete-app-space-concept-refactor` and
  `split-root-ref-update-api` before freezing or implementing this contract.
- Treat App/Space v2 and Stack/Tenant v1 as unpublished prototypes, not as
  compatibility contracts that constrain the first supported App/Space v1
  release.
- Preserve the administrator and App-user credential boundary and derive App,
  Space, permission, and Root Ref domain only from verified authority and
  route identity.
- Keep the old Stack/Tenant implementation isolated until its dedicated
  retirement task; do not broaden, repair, or silently alias it here.
- Keep generated OpenAPI reproducible from source and never hand-edit generated
  output.
- Coordinate consumers with `build-file-upload-smoke-app`; incompatibility is
  fixed at the public boundary rather than bypassed with private routes or
  storage access.
- Do not modify persisted schemas, keys, or lifecycle state as part of the
  wire-version cutover.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's App/Space v1 cutover, dependency boundary, prototype v2 removal, exclusions, constraints, and acceptance criteria. | Substantive implementation. |
| Interface | Required | Requesting user or delegated API owner | Task-local contract review containing exact routes, operations, schemas, errors, limits, retry rules, claim version and grammar, permission matrix, compatibility break, migration path, and OpenAPI diff. | Renumbering routes or claims, changing public clients, or removing prototype v2 surfaces. |
| Business and data model | Not applicable: the task changes the wire and authorization contract without changing entities, ownership, persistence schemas, keys, or lifecycle semantics. | Not applicable | Not applicable | Not applicable |
| Architecture | Required | Requesting user or delegated service owner | Task-local cutover design covering protocol generation, service dispatch, authorization boundaries, client migration, generated artifacts, rollout ordering, and rollback. | Changing service routing, authorization, generated contracts, or cross-package dependencies. |
| Delivery acceptance | Required | Requesting user | Published implementation, contract and OpenAPI diff, prototype rejection evidence, focused tests, workspace validation, and documented migration. | Running `task complete` for the exact approved primary commit. |

## References

- [Beta promotion capstone](/tasks/promote-app-user-api-to-beta/Task.md)
- [App/Space concept refactor](/tasks/complete-app-space-concept-refactor/Task.md)
- [Directional Root Ref API](/tasks/split-root-ref-update-api/Task.md)
- [Completed Space operation permissions](/tasks/split-app-space-operation-permissions/Task.md)
- [File upload smoke App](/tasks/build-file-upload-smoke-app/Task.md)
- [App-user API guide](/docs/app-user-api/README.md)
- [Data-plane package boundaries](/packages/README.md)
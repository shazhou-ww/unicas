# Replace Console Playground with a reference file app

Created: 2026-09-16
Reframed: 2026-09-17

## Goal

Replace the per-App Console Playground with an independently deployable,
first-party reference file service that exercises UniCAS only through the same
public App/Space protocols and published client packages available to customer
applications, and use that service as both a maintained dogfood application
and the basis of a step-by-step integration tutorial.

## Context

This task was originally accepted as desktop and mobile layout polish for the
Console Playground. Architecture review on 2026-09-17 found that polishing the
current surface would reinforce a misleading application model:

- an administrator opens a file application inside every App detail page;
- the Console obtains a managed Space capability through an admin-only helper;
- UniCAS control-plane storage owns the Playground file-root catalog; and
- file workflows, Space usage, and garbage collection are presented as App
  administration even though they are Space data-plane operations.

The intended replacement is a real service application that the UniCAS team
operates continuously. It must encounter the same integration boundaries,
authorization flow, performance costs, failure modes, and SDK ergonomics as an
external application. Its source and documentation should also teach users how
to build an equivalent service incrementally.

Existing Playground root records retain CAS manifests for current App/member
partitions. Removing the UI, APIs, or persistence without an approved migration
or disposal decision could release retained DAGs and make content eligible for
garbage collection.

## Scope

- Design and build a separately deployable reference file service, isolated in
  either a dedicated repository or an explicitly boundary-checked example
  workspace chosen at architecture review.
- Give the reference service ownership of its end-user authentication, mapping
  from principals to Spaces, Space capability issuance, file-root catalog, and
  other file-domain metadata.
- Configure and use a standard App OAuth issuer and least-privileged,
  Space-scoped capabilities. The service and browser must use only documented
  public routes and published UniCAS packages, with no admin session,
  Playground capability minting shortcut, private source import, or direct
  storage binding.
- Carry forward representative file workflows needed to exercise the product:
  create and rename roots, browse directories, upload, download, create folders,
  copy, move, rename, delete, commit concurrent changes, recover from failures,
  and use the supported browser cache. Include Space usage and garbage
  collection only through explicit `cas:manage` authority and an approved
  application-level interaction.
- Add local integration coverage and operate a maintained deployed instance so
  the team continuously exercises authorization, immutable content, Root Refs,
  leases, caching, concurrency, usage, garbage collection, and failure states.
- Publish a reproducible tutorial that starts with App registration and issuer
  configuration, then implements user-to-Space mapping, capability issuance,
  application-owned root retention, file operations, cache behavior,
  concurrency handling, usage, and garbage collection.
- Remove the Playground route, tab, managed-issuer availability probe, browser
  cache wiring, file application, styling, tests, and tenant implementation
  dependencies from the management Console.
- Inventory and retire Playground-only admin protocol, client, BFF, MCP, service,
  repository, schema, generated OpenAPI, and documentation surfaces. Any
  managed-issuer or managed-capability surface retained for a separate supported
  purpose requires an explicit approved contract and must not be used by the
  reference service.
- Inventory existing Playground records and retention effects, then implement
  the approved export, migration, deprecation, or disposal path before removing
  their APIs or storage. Do not silently release retained manifests.

## Out of scope

- Changing CAS node, lease, Root Ref, usage, garbage-collection, or capability
  semantics solely to simplify the reference application.
- Giving the reference service privileged access unavailable to customer
  applications or weakening the App/Space and admin/data-plane boundaries.
- Turning the reference service into a general-purpose collaboration, sharing,
  synchronization, or end-user drive product beyond the workflows needed to
  validate and teach UniCAS.
- Unrelated management Console, Platform Access, or identity-provider redesign.
- Migrating unrelated production application data.

## Acceptance criteria

- [ ] The user approves the revised scope and the concrete architecture,
      business/data model, migration, compatibility, and interface proposals.
- [ ] The reference service is independently deployable and its enforced
      dependency graph contains only documented public UniCAS packages and
      protocols available to external applications.
- [ ] A fresh deployment can register/configure its App issuer, authenticate an
      application user, map that principal to a Space, issue a least-privileged
      capability, and complete the representative file, cache, usage, and GC
      workflows without an admin credential or Playground-only endpoint.
- [ ] The file-root catalog and related business records are owned by the
      reference service, while CAS continues to treat manifests and content as
      opaque application data under the existing retention model.
- [ ] The management Console no longer exposes or bundles the per-App Playground
      and no longer depends on tenant implementation packages for that workflow.
- [ ] Every Playground-only API, MCP tool, persistence object, and managed
      capability path is either removed through an approved compatibility plan
      or retained under a separately justified, documented, and tested public
      purpose that the reference service does not rely on.
- [ ] Existing Playground records are handled according to the approved plan;
      retained content is neither silently orphaned nor made GC-eligible, and
      any destructive production action requires explicit human approval.
- [ ] The tutorial is reproducible from a clean environment, contains no secret
      material, and is validated by following it against an isolated UniCAS
      deployment using only public interfaces.
- [ ] Unit, integration, protocol/OpenAPI drift, package-boundary, typecheck,
      build, and focused browser tests pass. Desktop and mobile screenshots,
      deployed dogfood evidence, performance observations, and validation limits
      are recorded.
- [ ] The user explicitly accepts the integrated Console removal, reference
      application, migration outcome, deployed dogfood flow, and tutorial.

## Constraints

- Keep this work in backlog until claimed. Do not fold it into unrelated
  Platform Access or administrator identity work.
- Choose repository placement and deployment ownership at architecture review;
  enforce isolation mechanically so private workspace imports cannot masquerade
  as supported customer integration.
- Preserve public compatibility until the approved deprecation or removal plan
  is complete. Treat existing admin protocol and MCP surfaces as contracts, not
  as incidental UI implementation details.
- Preserve App/Space isolation, least privilege, admin/data-plane credential
  separation, bounded authority behavior, and application ownership of file
  semantics.
- Use isolated test data and local-only generated signing material for
  development. Never commit credentials, tokens, private keys, production
  identities, or customer data.
- Do not delete Playground records, release their retained manifests, drop
  persistence, or run production GC before the business/data review and
  destructive-operation approval are complete.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | Revised goal, included/excluded work, constraints, acceptance criteria, and relationship to the original layout task. | Substantive implementation. |
| Architecture | Required | Requesting user | Repository/deployment placement, dependency boundary, authentication and capability sequence, App/Space ownership, managed-issuer disposition, and Console/reference-service responsibilities. | Scaffolding the reference service or changing component ownership and dependencies. |
| Business and data model | Required | Requesting user | Current/proposed ownership and lifecycle model for App, Space, principal mapping, capabilities, file roots, retained manifests, plus existing Playground data migration/disposal and compatibility impact. | Changing persistence, retention ownership, APIs, or existing Playground records. |
| Interface | Required | Requesting user | Illustrative before/after Console removal and reference-app desktop/mobile workflows, including authorization, empty/error/loading, file operations, usage, and destructive GC states. | Implementing Console navigation removal or reference-app UI workflows. |
| Delivery acceptance | Required | Requesting user | Integrated revision, migration outcome, tutorial dry run, deployed dogfood instance, screenshots, tests, browser evidence, and documented validation limits. | Marking the task completed and archiving it. |

## References

- [Platform Access task](/tasks/archived/add-platform-access-management/Task.md)
- [Current Console UI design](/tasks/archived/add-platform-access-management/UiDesign.md)
- [Current Playground implementation](/packages/admin-webui/src/ui/views/file-playground.tsx)
- [Package and access-plane boundaries](/packages/README.md)
- [UniCAS architecture](/docs/cas-architecture.md)

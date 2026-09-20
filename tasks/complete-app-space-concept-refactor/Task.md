# Complete the App and Space concept refactor

Created: 2026-09-20

## Goal

Make App, Space, and data plane the canonical vocabulary throughout current
UniCAS package names, source modules, types, functions, variables, tests, and
documentation, with every retained Stack/Tenant occurrence confined to a
named frozen-v1, external-standard, or compatibility boundary that automated
checks can verify.

## Context

The completed [public terminology migration](/tasks/migrate-app-space-terminology/Task.md)
introduced App/Space v2 routes, claims, physical schemas, user interfaces, and
documentation while intentionally preserving Stack/Tenant v1. The current
repository still carries the former concepts deeper than that compatibility
contract requires. Examples include App/Space requests being normalized back
into `stackId`/`tenantId` repository scopes, service and Durable Object modules
named for tenants, App UI source files named for stacks, old internal type and
function names, and the `tenant-*` package family.

Some matching words are legitimate and must not be mechanically replaced:
the frozen v1 protocol and tests, Microsoft identity-provider tenant IDs,
JavaScript error stacks, historical task records, and other externally owned
vocabulary. This task turns that distinction into an explicit architecture
rather than relying on scattered comments and reviewer memory.

## Scope

- Produce a source-controlled inventory that classifies Stack/Tenant names in
  maintained source, package metadata, tests, scripts, generated-interface
  inputs, and current documentation as frozen v1, external standard,
  compatibility adapter, or obsolete internal vocabulary.
- Define and approve one canonical naming map for the Space data-plane package
  family, including package directories and package names, dependency
  direction, public exports, import paths, documentation routes, build
  artifacts, and consumer migration treatment.
- Rename current App/Space modules, files, types, functions, variables,
  constants, fixtures, and comments so their names describe App, Space, or the
  data plane without translating v2 concepts back to Stack/Tenant internally.
- Introduce or tighten explicit v1 compatibility modules at ingress and client
  construction boundaries. Convert frozen `stackId`/`tenantId` inputs once to
  a canonical internal `{ appId, spaceId }` scope and prevent old vocabulary
  from leaking back into v2 paths.
- Rename the accepted data-plane package family and update package manifests,
  workspace references, imports, lockfile entries, scripts, boundary guards,
  generated-documentation inputs, stable documentation, and examples as one
  staged migration.
- Decide during interface review whether old package specifiers and renamed
  exports receive a time-bounded compatibility release or a clean repository
  cutover; document the supported consumer migration path and removal point.
- Preserve genuinely external uses such as Microsoft `tenantId` behind
  provider-specific types and names so they cannot be confused with a UniCAS
  Space.
- Add a terminology boundary check with an allowlist narrow enough to identify
  each retained compatibility or external occurrence and reject newly
  introduced legacy names in current App/Space code.
- Update the repository glossary, package-boundary documentation, architecture
  documentation, and package READMEs to reflect the accepted names and the
  location of frozen v1 compatibility code.

## Out of scope

- Changing App, Space, Principal, Profile, node, lease, Root Ref, or capability
  business semantics, ownership, lifecycle, or persistence relationships.
- Changing public App/Space v2 routes, JSON fields, capability claims,
  permission strings, database columns, object keys, or Durable Object keys
  solely to perform this naming refactor.
- Removing, reinterpreting, or silently aliasing frozen Stack/Tenant v1 wire
  contracts, tokens, OpenAPI artifacts, or their focused regression tests.
- Modifying the frozen `unicas.shazhou.work` deployment or migrating its data.
- Renaming third-party concepts whose canonical vocabulary includes tenant or
  stack, or rewriting historical task records and generated build outputs as
  if they were maintained source.
- Combining this work with the direct-node-upload protocol redesign or the
  Space operation-permission split.

## Acceptance criteria

- [ ] A reviewed inventory assigns every maintained Stack/Tenant occurrence to
      frozen v1, external standard, compatibility adapter, or obsolete
      internal vocabulary, and every obsolete occurrence is removed.
- [ ] The reviewed naming map defines the canonical data-plane package family,
      and package directories, `package.json` names, imports, TypeScript
      references, workspace metadata, scripts, guards, and current docs agree
      with it.
- [ ] App/Space v2 requests remain `{ appId, spaceId }` through the protocol,
      service core, platform ports, Cloudflare repositories, Durable Objects,
      caches, and clients; any conversion for v1 occurs only in explicitly
      named compatibility modules.
- [ ] Current v2 and shared implementation exports contain no misleading
      Stack/Tenant type, function, variable, constant, fixture, file, or module
      names; retained legacy exports are visibly versioned or compatibility
      scoped.
- [ ] Provider-specific external vocabulary such as Microsoft `tenantId` is
      isolated by its owning provider context and is not used as a UniCAS
      domain identifier.
- [ ] The accepted package/export migration strategy is implemented and
      documented, including compatibility duration or clean-cutover behavior,
      consumer update instructions, and explicit removal criteria for any
      temporary aliases.
- [ ] A repository terminology check fails when legacy domain names are added
      outside its reviewed, reason-bearing allowlist and ignores generated
      outputs and historical task artifacts by construction.
- [ ] Frozen v1 route, capability, client, and cross-version denial tests pass
      unchanged in behavior, while v2 tests prove App/Space names and isolation
      across the renamed internal path.
- [ ] Package boundary tests, OpenAPI drift checks, documentation checks,
      workspace build, typecheck, and serialized test suites pass after the
      refactor.
- [ ] The user explicitly accepts the implemented naming architecture and
      migration result for the exact reviewed primary commit.

## Constraints

- Do not implement this as a global text replacement. Classify each occurrence
  by protocol version, domain ownership, and generated/source status first.
- Preserve wire compatibility and authorization separation: v1 and v2 routes,
  claims, headers, permissions, and clients must not cross-authorize or become
  ambiguous aliases.
- Keep the Admin and data access planes separate and preserve the dependency
  direction from presentation and higher-level clients through transport to
  protocol packages.
- Treat package and exported-symbol renames as public interface changes even
  when every current consumer is in this workspace.
- Keep compatibility adapters thin, one-way, and close to v1 ingress or
  construction. Canonical repositories and service operations must not expose
  dual field names.
- Sequence implementation after
  [direct node upload](/tasks/complete-direct-node-upload/Task.md) and
  [Space operation permissions](/tasks/split-app-space-operation-permissions/Task.md)
  are integrated, then rebase the inventory and naming map on their final
  protocol and service surfaces.
- Preserve unrelated uses of `stack` in language/runtime concepts and `tenant`
  in external identity-provider contracts.
- Do not edit generated `dist`, TypeScript build-info, bundled UI asset, or
  OpenAPI output by hand; regenerate tracked artifacts from renamed sources.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
reviewed explicitly before the work named in the final column begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | This task's goal, classification boundary, included rename surfaces, exclusions, sequencing, constraints, and acceptance criteria. | Substantive implementation. |
| Architecture | Required | User or delegated architecture owner | Task-local naming architecture containing the occurrence inventory, canonical package/module map, v1 adapter boundary, dependency graph, staged rename order, and rollback strategy. | Renaming packages/modules or changing service, adapter, client, and compatibility ownership. |
| Interface | Required | User or delegated package/API owner | Task-local compatibility matrix covering package specifiers, exported symbols, source paths used by tooling, v1/v2 API stability, consumer migration, temporary aliases, deprecation window, and removal criteria. | Renaming packages or exports, publishing aliases, or changing consumer-facing documentation and commands. |
| Business and data model | Not applicable: the task preserves domain entities, authority, ownership, relationships, physical schemas, keys, lifecycle, and migration semantics; it changes names and compatibility placement only. | Not applicable | Not applicable | Not applicable |
| Delivery acceptance | Required | Requesting user | Published implementation, final classified scan, package and export migration diff, v1/v2 regression evidence, workspace validation, and documented remaining compatibility names. | Running `task complete` for the exact approved primary commit. |

## References

- [Completed public App/Space terminology migration](/tasks/migrate-app-space-terminology/Task.md)
- [Repository glossary](/GLOSSARY.md)
- [Package boundaries](/packages/README.md)
- [UniCAS architecture](/docs/cas-architecture.md)
- [Data-plane protocol boundary](/packages/tenant-protocol/README.md)
- [Cloud-neutral service routing](/packages/service/src/actor.ts)
- [Direct node upload task](/tasks/complete-direct-node-upload/Task.md)
- [Space operation permission task](/tasks/split-app-space-operation-permissions/Task.md)
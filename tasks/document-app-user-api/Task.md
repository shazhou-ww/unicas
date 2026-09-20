# Document the App user API

Created: 2026-09-20

## Goal

Publish a navigable `docs/app-user-api/` documentation set that enables an App
team to implement and troubleshoot end-user Space access through the public v2
HTTP API, with reviewed scenarios, call sequences, endpoint definitions, and
least-privilege permission rules traceable to the implemented contracts.

## Context

The repository has authoritative Space routes, generated OpenAPI, capability
vocabulary, architecture, retention semantics, and package-level client
guidance, but it does not provide one App-user-oriented entry point that joins
those facts into complete request flows. An integrator currently has to infer
which actor authenticates the user, maps the user to a Space, issues a
capability, calls UniCAS, commits durable Root Refs, and handles retries or
collection.

This task documents the reusable public contract. It is complementary to
[Replace Console Playground with a reference file app](/tasks/replace-playground-with-reference-app/Task.md):
that task builds and teaches one concrete file application, while this task
defines the general API guide that any App and the reference application can
consume.

## Scope

- Create `docs/app-user-api/` with a clear index and a documented reading path
  for App developers integrating user-facing workflows.
- Define the participating actors and trust boundaries, including the App
  user, App frontend, App backend or issuer, UniCAS Space data plane, and the
  administrator-only setup boundary.
- Catalog representative scenarios and show their successful, retry, and
  relevant failure paths with Mermaid sequence diagrams. Cover capability
  acquisition, Space-scoped reads, immutable node upload and lease, atomic
  Root Ref commit/release, usage inspection, and bounded garbage collection.
- Inventory every public v2 Space HTTP operation from the authoritative
  protocol and generated OpenAPI. For each operation, document method and
  path, parameters, required headers and body, response and error shapes,
  streaming or range behavior where applicable, idempotency and concurrency
  semantics, and required authority.
- Define the v2 capability claims and operation-to-permission matrix, including
  issuer and audience validation, exact `appId` and `spaceId` matching,
  `refDomain`, `cas:read`, `cas:write`, `cas:manage`, least privilege, expiry,
  and App suspension behavior.
- Explain which responsibilities remain App-owned, especially end-user
  authentication, Principal-to-Space mapping, capability delivery, business
  root catalogs, and application data formats. Link administrator setup
  prerequisites without presenting administrator credentials or APIs as part
  of an App-user request path.
- Cross-link the guide to the machine-readable v2 OpenAPI, public client
  packages, architecture, retention and GC semantics, domain topology, and
  relevant operational guidance without duplicating their unrelated content.
- Validate all documented paths, fields, permissions, examples, links, and
  sequence steps against the current protocol, client, service authorization
  behavior, and generated OpenAPI.

## Out of scope

- Changing, adding, or deprecating HTTP endpoints, capability semantics,
  storage behavior, clients, or service implementation.
- Documenting frozen Stack/Tenant v1 as an App/Space alias or producing a v1
  migration guide.
- Re-documenting the administrator control plane, Console, CLI, or MCP beyond
  links needed to explain App setup and the credential boundary.
- Building the reference file application, an App-specific identity system,
  a business root catalog, or a complete SDK tutorial.
- Defining a one-user-to-one-Space rule, Space enumeration API, file format, or
  other business semantics that UniCAS deliberately leaves to each App.

## Acceptance criteria

- [ ] `docs/app-user-api/` contains a clear entry page and an organized set of
      pages for scenarios and sequences, HTTP operations, and authorization.
- [ ] The guide defines its audience, actors, trust boundaries, App-owned
      responsibilities, and the distinction between App users, App
      administrators, Principals, Apps, Spaces, and Root Ref domains.
- [ ] Mermaid sequence diagrams cover capability acquisition, read, upload and
      lease, atomic Root Ref commit and release, usage, GC, and representative
      retry or failure branches without placing an administrator credential in
      an App-user flow.
- [ ] Every operation in the generated v2 Space OpenAPI is accounted for with
      its HTTP method and path, inputs, outputs, errors, transport semantics,
      retry or concurrency behavior, and required permission; no undocumented
      implementation-only route is presented as public.
- [ ] A capability claim reference and endpoint permission matrix accurately
      explain issuer, audience, App, Space, `refDomain`, expiry, suspension,
      and `cas:read`/`cas:write`/`cas:manage` enforcement and include explicit
      denied cross-App, cross-Space, and insufficient-authority examples.
- [ ] The scenario steps and examples are verified against the v2 protocol,
      generated OpenAPI, public clients, and service authorization tests, and
      any source discrepancy is reported rather than silently normalized in
      prose.
- [ ] Repository-local links and documentation validation pass, examples use
      non-secret placeholders, and no capability, token, private key,
      production identity, or customer data is committed.
- [ ] The user explicitly accepts the published documentation set as the
      canonical App-user API guide for the reviewed revision.

## Constraints

- Use only the public App/Space v2 vocabulary. Physical Stack/Tenant storage
  names and frozen v1 wire names must not leak into v2 examples.
- Treat `packages/tenant-protocol/src/space-v2-contract.ts`, its generated
  `openapi/space-v2.openapi.json`, and `capability.ts` as the machine-readable
  contract sources. Explain them without creating a competing schema that can
  drift.
- Preserve the administrator/data-plane credential separation and document
  server-enforced authorization rather than client-side visibility as the
  security boundary.
- Do not equate a Space with a user. The App owns user authentication,
  Principal-to-Space mapping, sharing rules, and business lifecycle.
- Keep examples deterministic, least-privileged, and safe to publish. Never
  include live endpoints with bearer material or instructions to commit
  generated credentials.

## Human review checkpoints

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | Requesting user | Goal, audience, included scenarios, API boundary, exclusions, constraints, acceptance criteria, and relationship to the reference App task. | Substantive documentation work. |
| Interface | Required | Requesting user | Draft `docs/app-user-api/` scenario catalog, sequence diagrams, HTTP operation reference, permission matrix, errors, examples, and compatibility statement. | Publishing the guide as canonical public API guidance. |
| Business and data model | Not applicable: the task documents existing App, Space, Principal, capability, and Root Ref concepts without changing business rules, schemas, ownership, lifecycle, or migration. | Not applicable | Not applicable | Not applicable |
| Architecture | Not applicable: the task explains accepted trust and package boundaries without changing modules, responsibilities, dependencies, or deployment topology. | Not applicable | Not applicable | Not applicable |
| Delivery acceptance | Required | Requesting user | Published documentation, contract inventory evidence, link and docs validation, and recorded limitations or discrepancies. | Running `task complete` for the exact approved primary commit. |

## References

- [Space v2 contract](/packages/tenant-protocol/src/space-v2-contract.ts)
- [Space v2 OpenAPI](/packages/tenant-protocol/openapi/space-v2.openapi.json)
- [Capability vocabulary](/packages/tenant-protocol/src/capability.ts)
- [Package and access-plane boundaries](/packages/README.md)
- [UniCAS architecture](/docs/cas-architecture.md)
- [State protection and garbage collection](/docs/cas-state-protection-and-gc.md)
- [Public domain topology](/docs/domain-topology.md)
- [Reference file App task](/tasks/replace-playground-with-reference-app/Task.md)
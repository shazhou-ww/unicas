# Documentation tracker

Updated: 2026-09-15

This tracker covers public, developer, and operator documentation for the
App/Space migration. It is not a request for global replacement. Every retained
Stack/Tenant occurrence must be classified as frozen v1, physical/internal,
package identity, downstream terminology, or unrelated prose.

## Rules

- Current `unicas.work` examples use App, Space, Principal, and Profile.
- Frozen `unicas.shazhou.work` routes, fields, tokens, and artifacts remain v1.
- Physical `stack_id`, `tenant_id`, table names, object keys, and telemetry names
  remain documented while they are operational facts behind the v2 adapter.
- `tenant-*` package names remain identifiers until package ownership is decided.
- A Playground file root is Principal-owned control data, not a Space.
- “Space” never means available storage; use capacity, stored bytes, reserved
  bytes, remaining quota, or another precise measurement.
- Generated OpenAPI and Worker UI assets are regenerated from source, never edited.

## Normative baseline

- [x] Define App, Space, Principal, Profile, and capacity wording in `docs/terminology.md`.
- [x] Define the target public origins and frozen legacy topology in `docs/domain-topology.md`.
- [x] Update `GLOSSARY.md` and add an explicit v1 identifier subsection.
- [x] Update the root `README.md` product description and access-plane vocabulary.
- [x] Clarify App/Space data and environment wording in `SECURITY.md`.

## Architecture and protocol guides

- [x] Update `docs/cas-architecture.md` with current v2 routes and an explicit v1 section.
- [x] Review `docs/cas-binary-format.md`; preserve canonical bytes and classify any identifiers.
- [x] Update `docs/cas-state-protection-and-gc.md` to App/Space isolation terminology.
- [x] Update `docs/cas-oauth-discovery-and-issuer-migration.md`; preserve labeled legacy values.
- [x] Classify `docs/cas-tenant-debug-tools.md` as a frozen, unimplemented v1 design.

Dependencies: implemented v2 protocol and authorization contracts. These items
can proceed before physical storage renames if the adapter mapping is explicit.

## Operator and deployment guides

- [x] Update `docs/cas-operations.md` for App/Space probes, smoke, alerts, and reset gates.
- [x] Update `docs/deployment-and-local-configuration.md` for current origins and routes.
- [x] Update `docs/observability.md` for App/Space events while labeling retained telemetry keys.
- [x] Update `stacks/unicas/README.md` for the current public model and physical compatibility.
- [x] Update `stacks/unicas/site/public/index.html` product wording.

Dependencies: v2 smoke and the approved domain/physical cutover. Draft current
contract sections now; finalize commands, reset steps, and production examples
with the owning implementation slice.

## CLI, MCP, and client documentation

- [x] Update `docs/cas-control-plane-cli.md` after the App CLI family lands.
- [x] Update `docs/cas-control-plane-mcp.md` after remote/stdio App catalog parity lands.
- [x] Update `packages/admin-cli/README.md` with App commands and explicit legacy commands.
- [x] Update `.agents/skills/unicas-cli/SKILL.md` with App commands and tool vocabulary.
- [x] Update WebUI connection examples after the CLI/MCP command cutover.

Dependencies: `RemainingWork.md` sections 2-4. Help text, examples, and JSON
shapes must describe shipped commands rather than planned names.

Current status: the App CLI command family is implemented. CLI documentation
can now use `principal`, `apps`, `app-members`, `app-oauth-issuer`,
`app-ref-domains`, and `app-audit`. The shared remote/stdio App MCP catalog is
also implemented, so CLI and MCP reference documentation can now be updated
against shipped names and schemas.

## Package documentation and metadata

- [x] Update `packages/README.md` to distinguish App/Space resources from package names.
- [x] Update `packages/tenant-protocol/README.md` to document frozen v1 and separate Space v2.
- [x] Update `packages/tenant-browser-cache/README.md` after the v2 cache namespace lands.
- [x] Review `packages/admin-protocol/README.md` for App v2 and frozen admin v1 wording.
- [x] Review package descriptions exposed to developers without renaming package identifiers.

## Generated and frozen artifacts

- [x] Generate `packages/admin-protocol/openapi/admin-v2.openapi.json` separately.
- [x] Generate `packages/tenant-protocol/openapi/space-v2.openapi.json` separately.
- [x] Recheck v2 OpenAPI descriptions after all public operation names settle.
- [x] Regenerate Worker WebUI assets after each public UI documentation change.
- [x] Keep `admin-v1.openapi.json` and `tenant-v1.openapi.json` frozen and drift-tested.

## Explicitly retained vocabulary

Do not rename these merely to satisfy a scan:

- v1 routes, JSON fields, claims, permissions, OpenAPI artifacts, tests, and examples;
- the frozen `unicas.shazhou.work` environment;
- deployed physical schema, Durable Object, R2, KV, reset, and telemetry identifiers;
- `tenant-*` package and access-plane identifiers;
- downstream UniDocs/Gateway tenant concepts;
- canonical CAS bytes, hashes, media types, Root Ref semantics, and unrelated terms.

## Validation

- [x] Run the final classified Stack/Tenant scan across all tracked public documentation.
- [x] Verify every retained match is frozen v1, physical/internal, package identity, downstream terminology, or unrelated prose.
- [x] Pass docs build, link checks, OpenAPI drift, and task-link validation.

After each documentation slice:

```text
rg -n -i "\b(stack|stacks|tenant|tenants|stackId|tenantId)\b" docs README.md GLOSSARY.md SECURITY.md packages/*/README.md stacks/unicas .agents/skills/unicas-cli/SKILL.md
pnpm docs:check
pnpm docs:build
pnpm check:tasks
```

Classify every scan result rather than requiring zero results. For contract or
implementation-owned documentation, also run the relevant package tests,
OpenAPI drift checks, WebUI build, and full typecheck.

## Completion rule

All new-environment public text and examples must use the shipped App/Space
contract. Every retained Stack/Tenant occurrence must have a clear reason, and
the documentation site, links, generated contracts, and code examples must pass
their executable checks.
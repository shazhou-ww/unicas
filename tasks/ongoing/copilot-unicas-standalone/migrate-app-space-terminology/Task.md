# Migrate public terminology to App and Space

Created: 2026-09-14

## Goal

Replace the new environment's public Stack/Tenant model with App/Space while
keeping Principal identity and Profile metadata separate and preserving all CAS
isolation, authorization, accounting, and lifecycle invariants.

## Context

The current Tenant is a logical data ownership and usage-accounting unit. It
does not inherently represent a user. The v2 public model names that unit Space
and names the top-level application/trust boundary App.

## Scope

- Freeze a v1/v2 compatibility matrix.
- Define App, Space, Principal, and Profile schemas and invariants.
- Introduce versioned App/Space routes, claims, and permission strings.
- Rename cloud-neutral domain concepts and new-environment physical schema and
  object keys in controlled phases.
- Update OpenAPI, clients, CLI, MCP, WebUI, audit output, smoke, tests, and docs.
- Coordinate the final clean cutover with the public domain topology task.

## Out of scope

- Reinterpreting legacy Stack/Tenant data or tokens as App/Space.
- Modifying `unicas.shazhou.work`.
- Renaming canonical CAS bytes, hashes, Root Ref semantics, media types, or
  unrelated deployment resources.
- Treating Space as a user, organization, profile, physical shard, or capacity
  measurement.

## Acceptance criteria

- [ ] New public routes and JSON use `appId` and `spaceId` consistently.
- [ ] Capability v2 uses `spaceId` and `spaces:` permissions.
- [ ] V1 and v2 routes/tokens cannot cross-authorize.
- [ ] Principal is keyed only by issuer and subject; Profile is non-authoritative.
- [ ] Every data-plane operation remains scoped by both App and Space.
- [ ] CLI, MCP, WebUI, OpenAPI, audit, and docs use the same vocabulary.
- [ ] “Space” is never used to mean free or available storage capacity.
- [ ] Cross-App and cross-Space isolation tests pass.
- [ ] Legacy v1 remains unchanged and operational.
- [ ] Full build, typecheck, tests, smoke, dry-run, gitleaks, and CI pass.

## Constraints

- Do not implement this as a global text replacement.
- Classify public wire, internal, physical storage, and legacy occurrences
  before renaming.
- The new environment may be rebuilt only after backups and verification that
  it remains smoke-only.
- If real data or consumers exist at the cutover checkpoint, stop and use
  side-by-side adapters instead of destructive schema replacement.
- Keep issuer-derived App authority; do not trust a caller-provided App claim.

## References

- [Task execution plan](Plan.md)
- [Migration inventory](Inventory.md)
- [V1/v2 compatibility matrix](CompatibilityMatrix.md)
- [Finalized terminology](../../../../docs/terminology.md)
- [Finalized domain topology](../../../../docs/domain-topology.md)
- [UniCAS architecture](../../../../docs/cas-architecture.md)
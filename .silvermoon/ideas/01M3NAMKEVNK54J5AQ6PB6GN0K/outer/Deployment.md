# Deployment

## Steps

### D-S01: Publish and verify the SDK set

Run the protected npm workflow for the approved exact revision, then verify
package names, immutable versions, dist-tags, provenance, exports, dependency
ranges, and clean installation from the public registry.

### D-S02: Promote the exact production revision

Push the reviewed primary revision through the protected release workflow and
verify the public API origin, generated contract, documentation, and production
health.

### D-S03: Run public end-to-end probes

Exercise authorization denials, direct upload, directional Root Ref lifecycle,
readback, isolation, bounded cleanup, and the independently deployed file
upload smoke App using public packages and routes only.

### D-S04: Reconcile legacy surfaces and collect acceptance evidence

Confirm every retained historical storage or compatibility name has an owner,
reason, isolation boundary, and removal condition, and assemble non-secret
evidence for user acceptance of the exact release.

## Acceptance criteria

### D-AC01: Registry state matches the reviewed release

Every public package exposes the approved immutable version, dist-tag,
provenance, exports, dependency ranges, and install behavior. Prove it with
registry and clean-consumer verification.

### D-AC02: Production serves the exact beta contract

The protected deployment serves the reviewed App/Space v1 API and documentation
revision, and production health and contract checks pass. Prove it with release
workflow and public-origin evidence.

### D-AC03: Public smoke and isolation checks pass

Public-package and public-route probes prove authorization, upload, Root Ref,
readback, isolation, and bounded cleanup behavior without privileged shortcuts.
Prove it with retained non-secret smoke output.

### D-AC04: Retired surfaces do not leak

No retired Stack/Tenant or prototype v2 name leaks into released wire, SDK, or
current documentation surfaces; any historical storage name is explicitly
owned and isolated. Prove it with repository guards and the reviewed inventory.

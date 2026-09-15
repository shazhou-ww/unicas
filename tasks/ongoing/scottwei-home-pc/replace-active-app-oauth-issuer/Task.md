# Replace an active App OAuth issuer

Created: 2026-09-15

## Goal

Let an App administrator inspect, prove ownership of, and atomically activate a
replacement custom OAuth issuer while the current verified issuer remains
active until the replacement commit succeeds.

## Context

The existing v2 flow supports discovery inspection and signed ownership proof
for initial custom issuer activation. Once an issuer is active, the Console
disables further inspection and the repository only activates a pending issuer
row. Administrators therefore have no supported way to migrate an active App to
a new issuer without an unclear disable-or-overwrite sequence.

Issuer migration is security-sensitive and should not introduce an outage or
make unverified metadata authoritative. The Console redesign needs a visible
Change issuer workflow alongside the independently managed built-in issuer.

## Scope

- Permit creation of a replacement inspection while a custom issuer is active,
  without changing current authority resolution.
- Verify fresh discovery metadata, JWKS, global issuer uniqueness, signed
  ownership challenge, expiry, and optimistic concurrency before replacement.
- Atomically replace the active external issuer only after all checks pass,
  preserving the old issuer on failed, stale, expired, or abandoned attempts.
- Ensure old authority stops resolving within the documented hard stale bound
  after successful replacement and the new authority resolves consistently.
- Preserve independent managed issuer enable/disable behavior and issuer
  ordering in protected-resource metadata.
- Add audit/observability, protocol/OpenAPI, client, CLI/MCP, Console workflow,
  tests, and stable migration/operations documentation.

## Out of scope

- Uploading JWKs or private keys to UniCAS.
- Allowing multiple simultaneously active external issuers for one App.
- Changing the built-in managed issuer key lifecycle or endpoint shape.
- App suspension, Platform Principal authorization, or App member invitation
  management.
- Automatic migration of downstream tokens or application configuration.

## Acceptance criteria

- [x] An App administrator can inspect a replacement issuer while the current
      external issuer remains active and authoritative.
- [x] A candidate inspection never changes discovery output, capability
      verification, or current issuer state before successful activation.
- [x] Activation requires an unexpired inspection, a valid compact-JWS ownership
      proof from captured eligible JWKS, global issuer uniqueness, and exact
      current issuer revision.
- [x] Successful activation atomically selects the replacement, advances the
      resource revision, records audit evidence, and leaves no authority gap.
- [x] Failed, stale, conflicting, expired, or abandoned replacement attempts
      leave the prior issuer unchanged and usable.
- [x] The old issuer stops authorizing within the defined hard stale bound after
      replacement; cache refresh failure does not preserve it indefinitely.
- [x] The Console presents active and candidate issuer states separately and
      retains managed issuer status and enable/disable controls.
- [x] Focused discovery, proof, concurrency, uniqueness, authority-cache,
      protocol, client, CLI/MCP, WebUI, and migration tests pass with relevant
      repository validation.

## Constraints

- UniCAS derives verification keys only from verified public discovery and JWKS;
  private keys and manual JWK uploads are never accepted.
- Use staged verification plus one atomic authority transition, not disable then
  create and not in-place mutation before proof.
- Preserve `(issuer, subject)` Principal semantics and the App/Space data-plane
  audience boundary.
- Keep replacement compatible with the current single active external issuer
  model and independent optional managed issuer.

## References

- [Platform access API discussion](/tasks/backlog/add-platform-access-management/ApiDesign.md)
- [Console UI discussion](/tasks/backlog/add-platform-access-management/UiDesign.md)
- [OAuth discovery and issuer migration](/docs/cas-oauth-discovery-and-issuer-migration.md)
- [App v2 contract](/packages/admin-protocol/src/app-v2-contract.ts)
- [Current issuer UI](/packages/admin-webui/src/ui/views/issuer.tsx)
- [Control repository](/packages/service-cloudflare/src/control-admin-repository.ts)

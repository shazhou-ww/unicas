# Pre-launch replacement decision

Status: Approved principle; implementation pending

## Decision

Requesting user, 2026-09-17: the service is not publicly launched; no legacy
should be retained, and existing data can be cleared whenever needed.

This replaces both the original four-stage compatibility rollout and the
subsequent pinned-revision rehearsal proposal. Deliver one current Account-based
system, not an old/new transition framework.

## Consequences

- Remove legacy identity-keyed contracts, adapters, aliases, tables/columns,
  dual writes, permanent migration maps, migration-only journals, and old
  session/grant upgrade paths in this task's affected surfaces.
- Do not implement legacy/shadow runtime modes, a compatibility window, staged
  Google-only migration gates, or an irreversible migration cutover marker.
- Initialize the current schema and explicitly provision initial Account access.
  Recreate disposable pre-launch data as needed instead of preserving it through
  compatibility migrations. Old sessions and grants need fresh authentication.
- Update repository consumers, tests, generated contracts, and documentation to
  the current model rather than maintaining fallback behavior for old clients.
- Keep provider availability configuration-driven. Normal authorization,
  credential-version revocation, fresh-auth linking, and failure handling remain.

## Boundaries

The Account model, provider set, no-email-linking rule, and prohibition on
automatic Account merge are unchanged. Current-model audit and identity-link
history remain security records during normal operation; disposable pre-launch
data does not mean normal commands may rewrite security history.

This principle permits data replacement but is not an instruction to clear any
specific database now. A reset must target an explicitly identified environment
and resource set. The frozen `unicas.shazhou.work` environment and unrelated
App/Space data-plane work remain outside this task.

## Completion checks

Verify fresh initialization/bootstrap, Account-only authorization and ownership,
configured provider flows, email challenges, link/unlink and revocation, and
rejection of retired credentials/contracts. Validate updated consumers and
generated artifacts. Real provider/email acceptance and human delivery approval
are still required. Historical checkpoint code that implemented compatibility
is now cleanup work, not a reason to retain it.
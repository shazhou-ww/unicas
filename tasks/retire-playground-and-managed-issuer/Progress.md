# Progress

Updated: 2026-09-20

## Current state

Revision A is implemented and locally verified. It stops managed issuer
provisioning, mutation, and capability issuance while retaining only the
verification material needed to drain already-issued one-hour tokens. The next
action is to publish Revision A as an immutable commit, then implement the final
removal revision.

## Decisions

- Use two immutable code revisions: an issuance freeze followed by final
  verification-path removal after the production drain boundary.
- Keep the external OAuth issuer inspect/prove/activate and verifier paths
  unchanged.
- Do not perform production deployment, D1 mutation, signing-key
  revocation/deletion, or garbage collection from this task implementation.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user approved primary commit `6c831d7` on 2026-09-20 and authorized implementation. |
| Interface | Approved | Requesting user reviewed [InterfaceRetirement.md](./InterfaceRetirement.md) and [UiReview.html](./UiReview.html), requested visual alignment and removal of one explanatory callout, then approved primary commit `6c831d7` on 2026-09-20. |
| Business and data model | Approved | Requesting user approved [BusinessDataModel.md](./BusinessDataModel.md) in primary commit `6c831d7` on 2026-09-20. |
| Architecture | Approved | Requesting user approved [Architecture.md](./Architecture.md) in primary commit `6c831d7` on 2026-09-20. |
| Delivery acceptance | Pending | Requires the final integrated primary commit, complete validation evidence, and production runbook. |

## Validation

- `@unicas/admin-protocol`: 57 tests and typecheck passed.
- `@unicas/admin-client`: 13 tests and typecheck passed.
- `@unicas/admin-cli`: 49 tests and typecheck passed.
- `@unicas/admin-webui`: 67 tests and typecheck passed.
- `@unicas/service`: focused Account tests (24) and typecheck passed.
- `@unicas/service-cloudflare`: complete package suite (260 tests) passed.
- Admin OpenAPI was regenerated and the repository drift test passed.

## Blockers

- None.

## Outcome

Revision A removes managed issuer operations from the Admin API, admin client,
CLI/MCP catalog and handlers, BFF, and Console. New App creation no longer
provisions a managed issuer row, and the implicit Account-derived personal
Space capability path is gone. Legacy managed issuer rows, public
metadata/JWKS, authority lookup, and verification-only key loading remain
temporarily for token drain. Retired Playground WebUI tests and CSS are removed.

Revision B, final residue cleanup, complete validation, and delivery acceptance
remain outstanding.

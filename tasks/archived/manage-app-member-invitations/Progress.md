# Progress

Updated: 2026-09-15

## Checklist

- [x] Add snapshot-bound invitation reads and atomic conditional revocation.
- [x] Reconcile expiry and preserve immutable audit without bearer disclosure.
- [x] Expose protocol, client, BFF, CLI, and MCP operations with minimal writes.
- [x] Integrate the existing Console invitation view and verify responsive behavior.
- [x] Run acceptance gates and publish implementation before archival.

## Current state

Claim `80d87f6caf37baa3e078ad7f9f91b25f77dc2576` is verified on `origin/main`.
The service, D1 adapter, protocol, BFF, clients, CLI/MCP, and Console now expose
invitation history and conditional revocation. All local acceptance gates
passed. Implementation `0b64041275941533711e45337a1cac00e2bd5855` is verified
on `origin/main`. Next publish the archive move and claim active issuer replacement.

## Decisions

- This is the second independently executed prerequisite authorized by the user.
- Keep lifecycle statuses and minimal write responses aligned with the reviewed
  Console API proposal while preserving explicit legacy compatibility.
- Use the existing D1 atomic mutation and control-snapshot conventions.

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | `origin/main` commit `80d87f6caf37baa3e078ad7f9f91b25f77dc2576`. | Published |
| Implementation complete | `origin/main` commit `0b64041275941533711e45337a1cac00e2bd5855`. | Published |
| Archive | `origin/main` archive commit containing this record. | Published |

## Validation

- `pnpm exec repoledger doctor` passed before claiming.
- Suspension prerequisite is completed and published in the archive.
- Six focused memory/D1 invitation tests pass, including App/filter/snapshot
  cursor binding, durable expiry, current/stale ETags, and acceptance races.
- Protocol/adapter tests pass with required ETags and no revocation body.
- Client/CLI/remote MCP receipt migration passed 41 tests; dedicated ingress
  checks passed for CSRF, query validation, confirmation, and security scopes.
- Members and acceptance UI tests pass for filtering, paging, revoke, keyboard
  tabs, and clearing one-time links on App changes.
- Playwright with synthetic BFF fixtures at 1440x1000 and 375x812 verified
  no page-level horizontal overflow, scroll-contained tables, long-email
  wrapping, confirmation, DELETE with invitation ETag and no body, and revoked
  state without a revoke action. Desktop/mobile screenshots were inspected.
- Cloudflare and WebUI typechecks passed before final validation.
- Final `pnpm typecheck` passed for all workspace packages.
- Non-UI affected package tests passed 43 files and 445 tests.
- `pnpm --filter @unicas/admin-webui test` passed 9 files and 51 tests; UI
  tests require the package setup and must not run in the root configuration.
- `pnpm --filter @unicas/admin-webui build` passed.
- `pnpm check:repo` passed ledger validation, 6 policy tests, and 114 repository
  tests including generated OpenAPI drift.
- Relevant editor diagnostics are clear and `git diff --check` passed.

## Blockers

- None.

## Outcome

Completed. App invitation history, revocation, expiry, minimal receipts, and
Console/CLI/MCP workflows satisfy the acceptance criteria. No production
deployment was performed.

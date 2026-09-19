# Progress

Updated: 2026-09-15

## Checklist

- [x] Enforce App status in authority resolution and bounded-cache verification.
- [x] Expose conditional status mutations with audit and minimal responses.
- [x] Apply suspension to metadata and managed issuer surfaces while preserving recovery.
- [x] Update protocol, clients, CLI/MCP, and operations documentation.
- [x] Validate acceptance criteria and publish implementation.

## Current state

Claim commit `7f7a9e16cb01ed4be3360db3acb32802a31422c3` is verified on
`origin/main`. Suspension is implemented through versioned App mutations,
authority resolution, the Space verifier, discovery, managed issuance, CLI,
and both MCP transports. Implementation commit
`9501150605ac75b0d94bda465e2f13007d38d998` is verified on `origin/main`.
The next concrete action is to publish the archive move and claim member
invitation management as the next authorized prerequisite.

## Decisions

- The user authorized executing all three prerequisite tasks independently,
  followed by platform access management and the Console rebuild.
- Use the reviewed API proposal's minimal write responses and shared wire
  conventions; suspension stays in this task rather than the Console task.
- Preserve App control-plane recovery access and fail closed on data-plane
  authority once cached state exceeds its allowed bound.

## Publication milestones

| Milestone | Evidence | Status |
| --- | --- | --- |
| Claim | `origin/main` commit `7f7a9e16cb01ed4be3360db3acb32802a31422c3`. | Published |
| Implementation complete | `origin/main` commit `9501150605ac75b0d94bda465e2f13007d38d998`. | Published |
| Archive | `origin/main` archive commit containing this record. | Published |

## Validation

- `pnpm exec repoledger doctor` passed with the registered worktree-scoped
  `scottwei-home-pc` identity before claiming.
- Nearby contract inspection confirms status mutation and invitation
  list/revoke are not implemented; the tasks remain separate prerequisites.
- `git rev-parse HEAD origin/main` confirmed the same immutable claim hash
  locally and on the shared primary branch.
- Resolver and Space verifier: 16 tests passed, including managed/external
  status changes, all Space operations, restoration, and the 60-second bound.
- Client and compatibility adapter: 22 tests passed with no-content writes.
- CLI and both MCP transports: 30 tests passed, including remote suspension,
  no-op, stale revision, restoration, and audit evidence.
- Service and public Worker routing: 29 tests passed; focused authenticated BFF
  patch and legacy lifecycle tests passed.
- Source OpenAPI tests passed with a required ETag and no 204 response body.
- Cloudflare integration and CLI typechecks passed before final validation.
- Final `pnpm typecheck` passed for all workspace packages.
- Complete affected package test run passed 46 files and 474 tests.
- Strengthened existing D1 and stdio tests then passed: a previously issued
  managed capability is denied after suspension and accepted after restoration;
  immutable-actor transition audit is persisted and stdio returns only an ETag.
- `pnpm check:repo` passed the ledger check, 6 policy tests, and 114 repository
  tests including generated OpenAPI drift and deployment/workspace boundaries.
- `git diff --check` passed. Existing Markdown table-style diagnostics in
  architecture/operations and AGENTS newline formatting were left untouched.

## Blockers

- None.

## Outcome

Completed. App suspension enforces the bounded data-plane stop across issuer
modes while preserving control-plane recovery; all required local gates pass.
No production deployment was performed.

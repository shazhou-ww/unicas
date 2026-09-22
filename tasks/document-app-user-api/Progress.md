# Progress

Updated: 2026-09-20

## Current state

The reviewed App-user API guide is implemented under
[`packages/docs-site/content/app-user-api/`](../../packages/docs-site/content/app-user-api/) and integrated into the
documentation site. It covers the App-owned integration boundary, end-to-end
request sequences, every public v2 Space operation, capability authorization,
and the implemented retry, concurrency, streaming, range, retention, and
garbage-collection semantics. The next action is to publish the validated
implementation to primary for delivery acceptance.

## Decisions

- Keep App-user authentication, Principal-to-Space mapping, sharing, business
  root catalogs, data formats, capability delivery, and workflow retries
  explicitly App-owned.
- Present administrator setup only as a prerequisite boundary; no administrator
  session or credential appears in an App-user request flow.
- Treat the generated OpenAPI as the public operation inventory while reporting
  its current binary-response, byte-range, and permission-modeling gaps.
- Document runtime-only validation and stable error behavior as service-tested
  behavior rather than silently treating it as generated OpenAPI.
- Integrate the nested guide through explicit documentation source paths so the
  canonical repository layout remains `packages/docs-site/content/app-user-api/`.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user approved the goal, audience, included scenarios, API boundary, exclusions, constraints, and acceptance criteria in primary commit `d3a4d74552c7e699696ca50820d16788636b8aab` on 2026-09-20. |
| Interface | Approved | Requesting user reviewed [InterfaceReview.md](./InterfaceReview.md) and its complete draft pages, then approved primary commit `b6eb183bc18d546020f1de52725eca5de2d1073f` on 2026-09-20 for canonical publication. |
| Business and data model | Not applicable | The guide documents existing App, Space, Principal, capability, and Root Ref concepts without changing business rules, schemas, ownership, lifecycle, or migration. |
| Architecture | Not applicable | The guide explains accepted trust and package boundaries without changing modules, responsibilities, dependencies, or deployment topology. |
| Delivery acceptance | Pending | Requires the final integrated primary commit, contract inventory evidence, documentation/link validation, and recorded limitations. |

## Validation

- `pnpm docs:check`: documentation site build, nested page routing, repository
  Markdown link rewriting, generated-link report, and three docs-site tests
  passed.
- Focused OpenAPI and service verification: 52 tests passed across OpenAPI
  drift, Space authorization, actor dispatch, node lease/upload, node range
  reads, Root Ref commits, and garbage collection.
- `pnpm --filter @unicas/tenant-client test`: 10 public client cache and
  functional tests passed.
- `pnpm check:repo`: task, docs-site, OpenAPI drift, deployment-plan, and
  workspace-boundary checks passed (117 tests); the unrelated
  `repoledger-patch` test exceeded its fixed 5-second timeout.
- `pnpm exec vitest run tests/repoledger-patch.test.mjs --testTimeout=15000`:
  the timed-out test passed in 9.5 seconds.
- Source review accounted for all seven generated v2 Space operations and
  checked their claims, permissions, fields, errors, and transport behavior
  against protocol, OpenAPI, public client, service implementation, and tests.

## Blockers

- None.

## Outcome

The canonical guide now provides:

- a navigable entry page with actors, trust boundaries, setup separation, and
  App-owned responsibilities;
- Mermaid sequences for capability acquisition, reads, upload and lease,
  atomic Root Ref commit/release, usage, GC, and representative failures;
- a seven-operation HTTP reference with inputs, outputs, errors, range and
  streaming behavior, retries, idempotency, and concurrency;
- a capability claim reference, permission matrix, least-privilege examples,
  and explicit cross-App, cross-Space, insufficient-authority, missing-domain,
  and suspension denials; and
- an explicit compatibility statement and source discrepancy record.

No API, capability, client, service, or storage behavior changed. Delivery
acceptance remains required for the exact published primary commit before task
completion.

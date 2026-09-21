# Progress

Updated: 2026-09-21

## Current state

The reviewed App-level usage contract is implemented and validated across the
Admin protocol and client, cloud-neutral service kernel, Cloudflare D1/R2
accounting adapter, migration and scheduled repair, Admin BFF, Console, reset
workflow, generated OpenAPI, tests, and stable documentation. The next action
is to publish and integrate the validated implementation, then request delivery
acceptance for the exact primary commit.

## Decisions

- Add `GET /admin/apps/{appId}/usage` with the six existing Space usage fields
  summed across all Spaces. App membership authorizes the read; suspended Apps
  remain inspectable and no Space capability or identifier is exposed.
- Persist each node's latest completed canonical R2 size observation and keep
  one `cas_space_usage` row per usage-bearing Space. App reads aggregate only
  those rows, making read work proportional to Space count rather than node
  count and requiring no R2 calls.
- Maintain Space summaries with D1 triggers in the same transaction as node,
  lease, observation, and reservation mutations. Guard missing summaries so
  mutations fail visibly instead of silently drifting.
- Backfill legacy node and reservation state idempotently, return `503
  SERVICE_UNAVAILABLE` while an App has unobserved nodes, reconcile at most 100
  R2 observations per scheduled pass, and fully repair one oldest Space summary
  per pass.
- Keep unrelated Admin routes independent of CAS_DB initialization; only the
  membership-approved usage read initializes the App/Space schema lazily.
- Replace the Console placeholder with the approved responsive six-metric
  grid, stable loading/zero/refresh/error states, manual refresh, IEC byte
  formatting, exact accessible byte labels, and request-completion time.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user confirmed the scope and directed the task to start on 2026-09-21 against the canonical [Task.md](./Task.md) at primary revision `41eba5e4960178ace8752a3432de51cb8398f0b9`. |
| Interface | Approved | Requesting user reviewed [UiReview.html](./UiReview.html), approved the UI on 2026-09-21, and then approved implementation of the API/metric contract in [InterfaceDesign.md](./InterfaceDesign.md) after the performance revision at primary revision `0bbfc1bd9a7cf8e108e3180b6eaf04b1ad81f533`. |
| Business and data model | Approved | Requesting user questioned node-scan performance, approved the revised per-Space summary model in [BusinessDataModel.md](./BusinessDataModel.md), and directed implementation on 2026-09-21 at primary revision `0bbfc1bd9a7cf8e108e3180b6eaf04b1ad81f533`. |
| Architecture | Approved | The same 2026-09-21 decision approved [Architecture.md](./Architecture.md): node observations, transactional per-Space summaries, App aggregation over summary rows, bounded reconciliation/repair, and fail-closed rollout at primary revision `0bbfc1bd9a7cf8e108e3180b6eaf04b1ad81f533`. |
| Delivery acceptance | Pending | Requires the exact final integrated primary commit and the validation evidence below. |

## Validation

- Complete affected core package suites passed: 59 Admin protocol tests, 14
  Admin client tests, 147 cloud-neutral service tests, and 79 Admin WebUI tests.
- The complete Cloudflare suite passed all 277 tests with a 30-second per-test
  budget, covering Miniflare D1/R2, Durable Object upload and GC, BFF, Worker
  routing, concurrent legacy migration, projection triggers, query plans,
  reconciliation, summary repair, authorization, and cross-App isolation.
- `pnpm build` passed all 14 workspace build targets. Vite emitted only the
  existing third-party sourcemap warnings.
- `pnpm typecheck` passed all 14 workspace typecheck targets, including test
  sources.
- Admin OpenAPI generation completed and `pnpm check:openapi` passed all three
  drift checks.
- `pnpm docs:check` passed all three documentation build and link checks.
- Repository task, deployment-plan, documentation, workspace-boundary, and
  OpenAPI checks passed 129 tests. The unrelated repoledger temporary-Git test
  exceeded its default 5-second budget and passed alone in 10.57 seconds with
  `--testTimeout=15000`.
- `pnpm deploy:plan` passed without publishing and includes service build,
  Wrangler deployment, package builds, and App/Space smoke.
- The business model Mermaid diagram rendered successfully with Mermaid CLI.
- The real local Console at `http://localhost:4070/admin/` completed the mock
  Google login, created a local App, read zero usage through the new endpoint,
  refreshed while retaining values, and rendered without horizontal overflow
  at 1280px and 390px. Desktop and mobile screenshots were visually inspected.

## Blockers

- None for source publication or primary integration. Delivery acceptance
  remains pending for the exact integrated primary commit.
- A production deployment and live production smoke were not run; this task
  does not authorize deployment and those operations require protected
  environment credentials.

## Outcome

An App member can now inspect current aggregate CAS usage from App Overview
without a Space credential. Reads scale with the number of usage-bearing
Spaces, while transactional summaries, fail-closed backfill, bounded R2
observation, and rotating Space repair keep the result auditable and
recoverable without putting a contended mutable counter on the App.
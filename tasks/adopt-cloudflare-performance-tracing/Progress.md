# Progress

Updated: 2026-09-22

## Current state

The reviewed bounded observability implementation is complete. The `unicas`
and `unicas-spaces` Workers explicitly persist 5% sampled custom logs with
generated invocation logs disabled. Both explicitly disable trace sampling,
persistence, and destinations, while the assets-only product and documentation
Workers remain excluded.

Raw exception, provider-message, caller-correlation, smoke-run, and
identifier-bearing failure logs were replaced with typed bounded events.
Canary tests cover credentials, cookies, CSRF values, OAuth values, private
keys, presigned URLs, object identity, SQL, request content, callback details,
and caller correlation values.

The four approved business spans are implemented at their owning boundaries:
`unicas.capability.verify`, `unicas.node.validate`,
`unicas.root_refs.commit`, and `unicas.cleanup.run`. Their attributes are
bounded enums or numeric counts. A small portable node-validation hook keeps
Cloudflare tracing out of `@unicas/service`; the runtime import remains in the
Cloudflare adapter. Production sampling is zero, so these spans are currently
available only during a deliberate synthetic local tracing run.

Stable observability, operations, and deployment guidance now distinguishes
aggregate metrics, sampled logs, synthetic traces, `Server-Timing`, and durable
audit. The repository-local `unicas-observability` skill contains the same
investigation, instrumentation, validation, and data-safety workflow and is
intentionally absent from `skills-lock.json`.

After the implementation was first published, primary revision
`56cae80a6a63ad5ef21b67b59822e2bba6abd73e` completed the separate
Stack/Tenant data-plane retirement. That primary revision was merged into this
source branch. The observability implementation now targets only the current
App/Space v1 verifier and event; no legacy authorization callback, span plane,
or current-documentation event was reintroduced.

The task remains ongoing and provider-blocked. Cloudflare automatic tracing
retains full URLs, storage keys/metadata, Durable Object SQL bindings and IDs,
KV keys/metadata, and D1 SQL text, but exposes no verified pre-persistence
redaction or suppression control. Production trace waterfalls and a deployed
trace canary cannot be accepted without violating the approved telemetry data
boundary.

## Decisions

- Use built-in Worker metrics for request/error trends, CPU/wall-time
  quantiles, SLOs, and deployment comparison.
- Persist only explicitly emitted custom logs at a 5% head sample. Treat their
  counts as diagnostic samples, not authoritative totals.
- Keep generated invocation logs disabled because they include full request
  URLs, including OAuth callback query values.
- Keep production traces explicitly disabled with zero sampling, no native
  persistence, and no export destination until the data-safety gate can be
  proven.
- Preserve the existing Space `Server-Timing` names and response-construction
  semantics. Do not describe them as retained or final-byte timing.
- Add only the four reviewed business spans. Rely on Cloudflare's automatic
  handler, fetch, D1, R2, Durable Object, and RPC spans rather than duplicating
  platform operations.
- Keep static Workers excluded and keep the new skill repository-owned rather
  than externally installed or served through the administrator CLI.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | The requesting user explicitly approved [Task.md](./Task.md) on 2026-09-22 at primary revision `ff7a00ad13c1a061cb455f5f0bffd88814b72b14`. |
| Interface | Approved | The requesting user explicitly approved [InterfaceReview.md](./InterfaceReview.md) and its four-span contract on 2026-09-22 at published source revision `eceee4ab3c6afcdbb80e100a86dfd2234ec4963a`. |
| Architecture | Approved | The requesting user explicitly approved [Architecture.md](./Architecture.md) on 2026-09-22 at published source revision `eceee4ab3c6afcdbb80e100a86dfd2234ec4963a`. |
| Business and data model | Not applicable | The implementation changes no domain entity, ownership, persisted business schema, key, migration, retention, or lifecycle. |
| Delivery acceptance | Pending | Requires an exact integrated primary commit and completion of or an explicitly reviewed change to the provider-blocked production tracing criteria. |

## Validation

- `pnpm exec vitest run tests/deploy-plan.test.mjs`: 37 deployment,
  observability-policy, static-exclusion, generated-config, and skill-discovery
  tests passed.
- `pnpm --filter @unicas/service --filter @unicas/service-cloudflare --filter
  @unicas/spaces test`: every touched package suite passed; the cloud-neutral
  service contributed 135 tests and the Cloudflare adapter contributed 258
  after the legacy surface was removed.
- Focused custom-span, canary, Worker, Durable Object, audit RPC, Admin OIDC,
  and Spaces scheduled-worker tests passed, including the Workers-runtime
  module shim used only by Node-based Vitest.
- `pnpm check:workspace`: all 133 deployment-plan, workspace-boundary, and
  Stack/Tenant retirement guard tests passed.
- `pnpm docs:check`: all 7 content, link, artifact, determinism, and
  provenance tests passed.
- `pnpm typecheck`: all 15 workspace package typechecks passed.
- `pnpm deploy:plan`: the protected service deployment sequence rendered
  without executing production commands.
- `pnpm --filter @unicas/service-cloudflare build` followed by direct Wrangler
  `deploy --dry-run`: the reconciled App/Space-only service bundle and TOML
  observability schema passed non-publishing validation.
- `pnpm deploy:spaces:plan`: the Spaces UI/Worker build and Wrangler dry run
  passed with the checked-in observability policy.

## Blockers

- Cloudflare Workers Tracing has no verified control that removes unsafe
  automatic attributes before native persistence or OpenTelemetry export.
- Therefore representative retained production Space, Admin, MCP, OAuth, and
  Spaces App waterfalls, production D1/R2/Durable Object contribution queries,
  and deployed trace secret-absence evidence remain incomplete by design.
- Opening the gate requires a provider capability or a separately reviewed
  isolation/export outcome, refreshed interface and architecture approval, a
  nonzero sample decision, and synthetic retained-field canary evidence.

## Outcome

UniCAS now has an explicit, cost-bounded, tested observability baseline that
improves metrics, event, caller-timing, and synthetic-tracing investigations
without persisting known credential or private-identifier surfaces. The
repository records the native tracing gap honestly and fails closed until the
platform can meet the accepted telemetry boundary.
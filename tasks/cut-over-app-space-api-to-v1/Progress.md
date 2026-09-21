# Progress

Updated: 2026-09-21

## Current state

The reviewed App/Space v1 cutover is implemented across protocol routes,
capability verification, generated OpenAPI, service dispatch, Cloudflare
integration, public clients, the Spaces App, smoke tooling, and current
documentation. Prototype HTTP v2 routes now fall through to 404, Space claim
versions 2 and 3 are rejected, broad permissions are invalid, and the frozen
Stack/Tenant v1 implementation remains isolated behind explicit `./v1`
entrypoints.

Focused package validation, OpenAPI drift, documentation generation,
workspace-boundary checks, full typechecking, exhaustive tests, a clean build,
and deployment-plan validation pass. Deployed smoke, source publication,
primary integration, and delivery acceptance remain.

## Decisions

- Release `/v1/apps/{appId}/spaces/{spaceId}` as the only App/Space route
  family, with no redirect, alias, cutoff, or compatibility mode.
- Reset the Space capability claim to family-local `ver: 1`, require only the
  six exact operation permissions, and reject prototype versions and broad
  permission strings during claim validation.
- Use neutral operation IDs matching client methods and publish generated
  OpenAPI through `./openapi.json`; retain frozen Stack/Tenant OpenAPI through
  `./v1/openapi.json`.
- Replace the version-valued trusted dispatch header with
  `X-CAS-Route-Family: app-space` while preserving physical storage keys,
  Durable Object identities, and browser-cache persistence names.
- Keep one atomic mixed-sign Root Ref update with the existing runtime
  idempotency and retry semantics; expose its accepted limits in OpenAPI.
- For the one-time production cutover, gate a two-stage protected release with
  `APP_SPACE_V1_CUTOVER_ENABLED`: deploy the v1 API first, replace both active
  production App issuer audiences through normal inspect/proof/activate calls,
  then run the ordinary full deployment and smoke. The cutover step is
  idempotent and remains disabled for later releases.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | The requesting user reviewed [Task.md](./Task.md) and explicitly approved continued implementation on 2026-09-21 at primary revision `ec190836c12795525feaa09537d5ee09c072b4fa`. |
| Interface | Approved | The requesting user explicitly approved [InterfaceDesign.md](./InterfaceDesign.md) on 2026-09-21 at primary revision `ec190836c12795525feaa09537d5ee09c072b4fa`, covering the seven-operation v1 contract, claim version 1, exact permissions, and no-alias removal. |
| Business and data model | Not applicable | The cutover changes wire and authorization contracts without changing entities, ownership, persistence schemas, keys, or lifecycle semantics. |
| Architecture | Approved | The requesting user explicitly approved [Architecture.md](./Architecture.md) on 2026-09-21 at primary revision `ec190836c12795525feaa09537d5ee09c072b4fa`, including coordinated rollout, unchanged persistence identity, and rollback. |
| Delivery acceptance | Pending | Requires the final integrated primary commit and complete validation evidence. |

## Validation

- `pnpm --filter @unicas/space-protocol test`: 42 protocol, route,
  capability, contract, and generated-document tests passed.
- `pnpm --filter @unicas/space-protocol typecheck`: passed.
- `pnpm --filter @unicas/admin-protocol test`: 59 tests passed.
- `pnpm --filter @unicas/service test`: 148 tests passed, including prototype
  claim rejection and cross-family denial.
- Focused `@unicas/service-cloudflare` Worker, Durable Object, and Root Ref
  validation passed 61 tests.
- `pnpm --filter @unicas/space-client test`: 10 tests passed.
- `pnpm --filter @unicas/space-browser-cache test`: 12 tests passed.
- `pnpm --filter @unicas/spaces test`: 59 tests passed.
- `pnpm check:api-version`: the maintained-surface prototype guard passed.
- `pnpm check:openapi`: all three generated OpenAPI documents matched source.
- `pnpm docs:check`: all three documentation build and link checks passed.
- `pnpm check:workspace`: all 123 boundary and deployment-plan tests passed.
- `pnpm typecheck`: all 14 workspace package targets passed.
- `pnpm test:exhaustive`: all repository checks and all 14 workspace package
  test targets passed.
- `pnpm clean && pnpm build`: all 14 workspace package build targets passed;
  the generated current protocol and service output contains no prototype
  App/Space route, contract, operation, cutoff, or dispatch-header identifier.
- `pnpm deploy:plan`: produced the expected non-deploying Worker, protocol,
  client, and smoke command plan.
- `pnpm exec vitest run tests/app-space-v1-issuer-cutover.test.mjs
  tests/deploy-plan.test.mjs`: 38 issuer proof, activation, workflow gate,
  deployment ordering, secret handling, and deployment-plan tests passed.
- Production run `35609491714` validated and predeployed the v1 API at release
  revision `c88b19e2cb0a58ef91087dae0cb0f5f483bfbc91`, then stopped before any
  issuer activation because the cutover script expected a top-level audience
  that the formal inspection response does not expose. Both active audiences
  remained unchanged. The follow-up reuses the service's structured challenge
  parser to validate the embedded App, issuer, and v1 audience before signing;
  its focused 38-test validation passes.
- Production retry `35612354560` also stopped before any issuer activation
  because the root workspace does not expose a `tsx` executable. Both active
  audiences again remained unchanged. The script now has no TypeScript runtime
  dependency: plain Node imports it successfully, its strict local parser is
  tested equal to the service parser for the formal 10-line challenge grammar,
  and the focused suite passes 39 tests.

## Blockers

- The protected production retry must complete both issuer activations and all
  deployed smoke steps; follow [UserAcceptance.md](./UserAcceptance.md) for the
  remaining manual probes after that run.
- Delivery acceptance remains the final human checkpoint after primary
  integration.

## Outcome

The repository implementation and all agent-verifiable acceptance checks are
complete. Pending source publication, primary integration, deployed smoke, and
delivery acceptance.

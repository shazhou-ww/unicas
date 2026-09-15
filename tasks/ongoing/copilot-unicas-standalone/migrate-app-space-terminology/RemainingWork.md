# Remaining work

Updated: 2026-09-15

This breakdown turns the accepted phases in `Plan.md` into independently
testable slices. Public App/Space work may continue over the explicit physical
Stack/Tenant compatibility adapter. Destructive storage work remains blocked
until the inventory and backup gate is satisfied.

## Dependency order

1. Complete the App administrator transport in `@unicas/admin-client`.
2. Build the App CLI and matching remote/stdio MCP operations on that transport.
3. Migrate the WebUI control views, then its Playground to the Space data plane.
4. Add an App/Space browser-cache namespace and v2 smoke coverage.
5. Complete the documentation tracker alongside the owning implementation slices.
6. Clear the physical inventory gate, perform the approved storage cutover, and
   coordinate the final domain deployment.

Slices 1-5 are non-destructive and can proceed with the current adapter. Slices
6-7 must not begin destructive execution until their explicit gates pass.

## 1. App administrator client

- [x] Add App CRUD methods with App schemas, pagination, ETags, and idempotency.
- [x] Add App membership and invitation methods using Principal/Profile shapes.
- [x] Add App OAuth and managed issuer methods.
- [x] Add App Playground control-record methods without relabeling file roots as Spaces.
- [x] Add App/Space audit methods using `appId` and `spaceId`.
- [x] Test App paths, response shapes, CSRF, ETags, pagination, and query fields.
- [x] Keep v1 Stack methods unchanged for explicit legacy callers.

Validation:

```text
pnpm --filter @unicas/admin-client test
pnpm --filter @unicas/admin-client typecheck
```

## 2. CLI App commands

- [x] Add `unicas apps list|get|create|update`.
- [x] Add App member and invitation commands using `appId` and Principal fields.
- [x] Add App issuer and ref-domain commands.
- [x] Add App audit commands and replace v2 `--tenant-id` with `--space-id`.
- [x] Keep `whoami`, `stacks`, and other retained v1 commands explicitly labeled legacy.
- [x] Update help, JSON fixtures, ETag behavior, and command tests.

Validation:

```text
pnpm --filter @unicas/admin-cli test
pnpm --filter @unicas/admin-cli typecheck
```

## 3. MCP App catalog

- [x] Add version-distinct App CRUD, membership, issuer, Playground, and audit tools.
- [x] Use only `appId`, `spaceId`, Principal, and Profile in v2 schemas and output.
- [x] Mirror every App tool in remote and stdio MCP with identical metadata and inputs.
- [x] Add exact remote/stdio catalog parity coverage.
- [x] Keep existing v1 tools structurally unchanged until final transition removal.

Validation:

```text
pnpm --filter @unicas/admin-cli test
pnpm --filter @unicas/service-cloudflare exec vitest run tests/control-plane-mcp-server.test.ts
```

## 4. WebUI App control surface

- [x] Change browser routes from `#/stacks/{stackId}` to `#/apps/{appId}`.
- [x] Migrate App list, create, overview, navigation, and mutation state.
- [x] Migrate members to AppMembership with separate Principal and Profile.
- [x] Migrate issuer and control-audit views to App operations.
- [x] Migrate Playground Root Ref and data views to Space operations in section 5.
- [x] Use “My Apps”, “App administrators”, “App issuer”, and accepted Space labels.
- [x] Update focused UI tests and regenerate Worker UI assets from the WebUI build.

Validation:

```text
pnpm --filter @unicas/admin-webui test
pnpm --filter @unicas/admin-webui typecheck
pnpm --filter @unicas/service-cloudflare build
```

## 5. Playground Space transport and cache

- [x] Add or expose a typed v2 App/Space data-plane client.
- [x] Consume `ManagedSpaceCapability` and call `/v2/apps/{appId}/spaces/{spaceId}`.
- [x] Keep Playground file roots as Principal-owned control records.
- [x] Present the generated personal Space without treating it as a user or file root.
- [x] Add a versioned browser-cache namespace keyed by Principal, App, and Space.
- [x] Prove v1 Stack/Tenant and v2 App/Space cache entries cannot collide.
- [x] Cover cross-App, cross-Space, and cross-version request denial.

Validation:

```text
pnpm --filter @unicas/tenant-client test
pnpm --filter @unicas/tenant-browser-cache test
pnpm --filter @unicas/admin-webui test
```

## 6. Audit, smoke, and documentation

- [x] Make CLI, MCP, and WebUI audit output consistently App/Space-shaped.
- [x] Add a new-environment v2 App/Space middleware smoke path.
- [x] Retain separate frozen v1 smoke coverage for the legacy environment.
- [x] Complete every applicable item in `Documentation.md`.
- [x] Run the final classified Stack/Tenant scan; zero matches is not the goal.

## 7. Physical and deployment cutover

Gate before any destructive operation:

- [x] Export both D1 databases and verify the backups.
- [x] Inventory control/data D1, R2, OAuth KV, and relevant Durable Object state.
- [x] Repeat the control-plane query and verify the environment remains smoke-only.
- [x] Decide clean App/Space rebuild versus continued side-by-side adapters.

After the gate is reviewed and passed:

- [x] Replace control D1 Stack tables and `stack_id` columns with App tables and `app_id`.
- [x] Replace data D1 `stack_id`/`tenant_id` dimensions with `app_id`/`space_id`.
- [x] Replace Durable Object names and R2 keys with App/Space scopes.
- [x] Update reset guards to the approved physical model.
- [x] Require verified D1 and R2 backups before any destructive reset command.
- [x] Coordinate `api.unicas.work`, `console.unicas.work`, the product site, and docs.
- [x] Register and verify the required Google OAuth callbacks.
- [x] Run Wrangler dry-runs, deploy, recreate Production Smoke, and run v2 smoke.
- [x] Verify rollback before removing transitional aliases from the new environment.
- [ ] Run build, typecheck, tests, smoke, dry-run, gitleaks, and CI.

## Completion rule

The migration is complete only when all public new-environment surfaces use
App/Space, all remaining Stack/Tenant occurrences are classified as frozen v1,
physical compatibility, package identifiers, or unrelated language, and the
physical/domain cutover gates have passed. The legacy deployment remains
unchanged throughout.
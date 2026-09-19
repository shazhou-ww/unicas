# Progress

Updated: 2026-09-15

## Checklist

- [x] Verify the worktree identity and check for overlapping active work.
- [x] Add the protected production deployment path and regression coverage.
- [x] Document production setup, release, recovery, rotation, and rollback.
- [x] Run the full acceptance validation and archive the completed task.

## Current state

GitHub Actions run `34939626249` validated commit `2770def`, deployed all three
production Workers in order, passed canonical App/Space smoke, removed the
ephemeral signing key, and passed all four public-origin checks. The task is
complete and has moved to the repository archive. The remaining publication
check is the CI run triggered by the archive commit itself.

## Decisions

- Use the repository-owned deployment commands and keep `pnpm deploy` as a
  refusal path, as required by the task.
- Keep production configuration out of the validation job and map it only on
  the deployment steps inside the protected environment.
- Materialize `UNICAS_SMOKE_PRIVATE_KEY_PKCS8` under the existing gitignored
  `.wrangler/cas-deploy/` boundary and remove it immediately after service
  smoke with an `always()` step.
- Start from Cloudflare's **Edit Cloudflare Workers** token template and scope
  it to the one production account and `unicas.work` zone without unrelated
  data-management permissions.
- Use `queue: max` with `cancel-in-progress: false` so the production
  concurrency group retains pending validated revisions instead of replacing
  them while another release is running.
- Verify explicit status, same-origin redirect, and identifying response
  content instead of following arbitrary redirects during post-deploy checks.
- Use a dedicated external issuer whose tracked product-site assets contain
  only public metadata/JWKS; keep its PKCS#8 private key separate from every
  Worker runtime secret and stream it directly into the GitHub environment.
- Verify the current run's leased nodes after whole-Space GC instead of
  requiring zero stale-node deletions, and release acquired smoke Root Refs in
  a `finally` path.

## Validation

- `git fetch origin main`: identity lane exists and no overlapping active task
  is present on `origin/main`.
- `pnpm check:tasks`: 10 tests passed after publishing the task claim.
- `pnpm exec vitest run tests/deploy-plan.test.mjs`: 20 tests passed, including
  production gating, credential isolation, deploy order, key cleanup, all
  Worker dry-runs, and public-origin checks.
- `pnpm docs:check`: 3 tests passed for the updated operator documentation.
- `pnpm check:repo`: 118 tests passed before the final queue and probe
  hardening; 118 tests passed again after the final changes.
- `pnpm build` and `pnpm typecheck`: all workspace packages passed.
- `pnpm -r test`: all package suites passed.
- Service Wrangler dry-run: 2,186.14 KiB upload plan with the expected Durable
  Object, KV, D1, R2, and production-variable bindings.
- Product-site Wrangler dry-run: 5 assets and no bindings.
- Documentation Wrangler dry-run: 18 pages built, 42 assets, and no bindings.
- Live read-only origin probes: API `200` with UniCAS health JSON, console
  same-origin `302` to `/admin/`, and product/docs `200` with identifying HTML.
- VS Code diagnostics and `git diff --check`: no errors.
- GitHub's current concurrency documentation confirms that `queue: max` keeps
  up to 100 pending runs and is valid with `cancel-in-progress: false`.
- GitHub Actions run `34937857808` stopped in validation because claiming the
  only backlog task left no tracked file under `tasks/backlog/`; the production
  job was skipped before it could read environment values or contact
  Cloudflare. Adding `tasks/backlog/.gitkeep` restored the canonical directory,
  and the exact task-ledger check passed 10/10 locally.
- GitHub Actions run `34938025424` passed validation and entered the protected
  `Production` environment, then failed closed before any Wrangler command
  because `UNICAS_SMOKE_PRIVATE_KEY_PKCS8` was unset. Environment inspection
  confirmed only the Cloudflare token and account ID were present. The current
  `Production Smoke` App has no external issuer, so its managed runtime key
  cannot be reused without violating credential separation.
- A dedicated ES256 smoke key was generated under the gitignored credential
  boundary. Its public-only metadata/JWKS assets pass 21 deployment tests and
  local Wrangler serves both discovery paths as direct `200 application/json`
  responses.
- Product-site bootstrap version `5769764e-3e4b-4d93-ada9-f07507fb5336`
  published the public issuer assets. Live metadata, JWKS, and product-root
  checks returned direct 200 responses with the expected content types.
- The production control plane activated `https://unicas.work/deploy-smoke`
  for the sole `Production Smoke` App using its discovered ES256 public key.
  All five smoke variables and the dedicated PKCS#8 secret were then written
  to the GitHub `Production` environment without printing the private key.
- The first external-issuer smoke reached GC but exposed an over-strict
  zero-deletion assertion and left one Root Ref after aborting. The revised
  smoke passed every canonical assertion, including one legitimate stale-node
  collection and `finally` cleanup. The one audited failed-run Root Ref was
  explicitly released; a follow-up control-plane read returned no refs.
- GitHub Actions run `34939626249` passed. Validation completed in 1m51s and
  production deployment in 1m13s. It deployed service version
  `9cbb663a-750c-4b9e-b632-f18b5f3990f0`, product-site version
  `633a381d-d1e4-4bf8-8564-eede2658ce26`, and documentation version
  `e469eb72-8745-4c49-b48d-3180d886bd9b`. The log masked the signing key,
  canonical smoke passed, the cleanup step succeeded, and every HTTPS probe
  passed.
- The first archive commit staged only the directory move because its command
  also named the now-absent ongoing path. The follow-up stages the completed
  Task and Progress content from their actual archived path; task validation
  prevents the incomplete intermediate archive from deploying.

## Blockers

- None.

## Outcome

Completed. Validated `main` revisions now deploy through the protected,
serialized `Production` environment and verify the service, product site, and
documentation site without a developer machine.
# Progress

Updated: 2026-09-15

## Checklist

- [x] Verify the worktree identity and check for overlapping active work.
- [x] Add the protected production deployment path and regression coverage.
- [x] Document production setup, release, recovery, rotation, and rollback.
- [ ] Run the full acceptance validation and archive the completed task.

## Current state

The task is claimed by `copilot-unicas-standalone`. CI now has a serialized
`Production` environment job for validated `main` pushes and manual `main`
dispatches. It deploys service, product site, and documentation in order,
cleans up the ephemeral smoke key, and checks all public origins. The next
action is to push the locally validated implementation, monitor the first
protected production run, and address any live-only failures before archiving.

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

## Blockers

- A real GitHub Actions deployment is still required to prove environment
  protection, Cloudflare token permissions, smoke credentials, secret
  preservation, and post-deploy behavior together. The operator reports that
  the GitHub `Production` environment, required values, and main-only
  deployment branch policy are configured.

## Outcome

In progress.
# Validation and release workflows

UniCAS keeps validation ownership in reproducible package and root scripts.
GitHub Actions owns triggers, permissions, protected environments, concurrency,
and exact revision checks; it does not maintain a second test command list.

## Supported matrix

| Path | Command or trigger | Added guarantee | External writes |
| --- | --- | --- | --- |
| Focused local work | package `test`, `build`, or `typecheck`; `pnpm test:quick`; `pnpm test:packages` | Fast affected-scope feedback | None |
| Local delivery, branch, PR, `main` | `pnpm validate` | Repository policy, package tests except the slow Cloudflare adapter suite, one workspace build, and one workspace typecheck | None |
| `main` push | `pnpm validate`, then separate `repoledger check --remote` | Canonical shared task coordination | None |
| Release preflight | `pnpm validate:release` or manual **CI** dispatch | Strict superset: Cloudflare adapter and release-policy suites, deterministic SDK artifacts, docs browser test, all deployment dry-runs | None |
| Production promotion | Push of a reviewed `main` revision to protected `release` | Exact SHA and `main` ancestry, protected rebuild, serial deploy/smoke/origin checks, immutable production tag | Cloudflare and Git tag, after `Production` approval |
| npm release | `npm/app-user-sdk/v<version>` tag | Exact tag SHA and `main` ancestry, deterministic six-package rebuild, full registry preflight, ordered OIDC publication, provenance and external verification | npm, after `npm` approval |
| Spaces recovery | Manual **Recover Spaces production** dispatch with a full `main` SHA and operation | Exact revision, isolated bootstrap/recovery, shared production serialization | Cloudflare, after `Production` approval |

`pnpm validate:release` starts by running `pnpm validate`; it is therefore a
strict superset, not an alternative assertion set. A normal release rebuilds
inside the protected job. An npm release likewise builds inside its protected
job. Executable artifacts from branch, pull-request, or ordinary `main`
validation never cross into an external-write trust boundary.

## Ownership rules

- Put checks required for every delivery in `pnpm validate`.
- Put the slow Cloudflare adapter suite, historical release-policy guards,
  browser tests, deterministic release artifacts, deployment plans, or other
  promotion-only checks in `pnpm validate:release`.
- Keep package-specific fast selectors available; do not duplicate their
  assertions in workflow YAML.
- Keep exact revision, ancestry, environment, permission, concurrency, smoke,
  cleanup, provenance, registry-state, and immutable-tag checks at the
  external-write boundary.
- Add bootstrap or repair operations only to an explicit protected recovery
  workflow. Completed cutovers do not remain executable in normal production.
- Never pass deployment bundles or package archives from an untrusted
  validation run into `Production` or `npm`.

The retained protected rebuild is intentional: it adds exact-revision and
environment-approval guarantees. npm performs one complete registry preflight
before writes and rechecks only the next package immediately before its write,
so a partial successful run can be resumed without overwriting immutable state.

## 2026-09-23 optimization evidence

GitHub runner time is measured from each `validate` job's `startedAt` to
`completedAt`. Functional steps exclude GitHub setup, completion, generated
post steps, and skipped steps.

| Sample | Runner time | Functional steps |
| --- | ---: | ---: |
| Pre-change runs [35826820817](https://github.com/shazhou-ww/unicas/actions/runs/35826820817), [35825378786](https://github.com/shazhou-ww/unicas/actions/runs/35825378786), and [35805431702](https://github.com/shazhou-ww/unicas/actions/runs/35805431702) | 4m20s median (4m20s, 4m31s, 3m08s) | 19 in the latest baseline |
| Post-change run [35838240396](https://github.com/shazhou-ww/unicas/actions/runs/35838240396), attempts 1-3 | 2m16s median (2m24s, 2m12s, 2m16s) | 6 |

The standard gate therefore reduced median runner time by 48% and latest
functional-step count by 68%. A manual, non-writing release-superset run
[35838538367](https://github.com/shazhou-ww/unicas/actions/runs/35838538367)
passed in 4m03s with production deployment and tagging unreachable on the task
branch. npm and production write workflows were not executed as measurement
probes; their reductions are structural, while their protected write behavior
is covered by workflow and script regression tests.

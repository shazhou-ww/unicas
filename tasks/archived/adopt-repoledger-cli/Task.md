# Adopt the repoledger CLI

Created: 2026-09-15

## Goal

Keep `pnpm check:tasks` as UniCAS's stable validation entry point while using a
pinned public `repoledger` release for reusable task-ledger checks and retaining
UniCAS-specific policy tests locally.

## Context

The current `tests/task-workflow.test.mjs` suite passes ten tests but combines
generic task layout, naming, state, and link checks with UniCAS-specific checks
for agent instructions, installed-skill provenance, identity documentation,
and finalized-documentation boundaries. It also checks that identity commands
are documented rather than validating the actual local worktree binding.

The shared skills repository has published the reusable checks as
`repoledger@0.1.0` on npm. Adopting that package removes duplicated protocol
logic without making the public tool responsible for UniCAS policy.

## Scope

- Add a pinned published `repoledger` development dependency and commit the
  resulting pnpm lockfile update.
- Add UniCAS's language-neutral `repoledger.json` configuration for its task
  directory and `origin/main` collaboration branch. Reference the pinned
  package's schema; its GitHub `$id` is the versioned contract.
- Keep `pnpm check:tasks` as the package-script and CI entry point, delegating
  reusable validation to `repoledger check` before running focused
  UniCAS-specific Vitest coverage.
- Remove duplicated generic validator code from
  `tests/task-workflow.test.mjs`, renaming or splitting the test when that
  makes its remaining policy ownership clearer.
- Preserve local checks for required agent instructions, installed skill and
  lock provenance, identity-setup documentation, finalized-documentation
  boundaries, and any UniCAS-specific documentation links.
- Update UniCAS instructions and task profile to explain the pinned CLI check
  and the separate local `repoledger doctor` readiness command.
- Keep CI identity-independent; do not run `doctor` in GitHub Actions.

## Out of scope

- Implementing or publishing the `repoledger` package.
- Adding mutating task-lifecycle commands or moving admission and ownership
  decisions out of the repository-task-ledger skill.
- Rewriting archived task artifacts solely to adopt the new validation schema
  or publication-milestone format.
- Changing UniCAS product, deployment, authentication, or generated smoke
  artifacts.

## Acceptance criteria

- [x] UniCAS pins a published `repoledger` version in `package.json` and the
      pnpm lockfile rather than executing an unversioned latest package in CI.
- [x] `pnpm check:tasks` runs `repoledger check` plus focused UniCAS policy
      tests and remains the command used by `check:repo`, `test`, and CI.
- [x] Generic task layout, naming, uniqueness, state, task-link, acceptance,
      publication, and history validation is owned by `repoledger` rather than
      duplicated in UniCAS test helpers.
- [x] UniCAS-specific instruction, skill-lock, identity-documentation,
      documentation-boundary, and documentation-link assertions remain
      covered and fail for representative regressions.
- [x] Existing archived tasks with legacy publication formats pass under the
  CLI's documented compatibility behavior without content-only migration
  commits.
- [x] `repoledger doctor` succeeds in a correctly initialized UniCAS worktree
      and is documented for local use without becoming a CI prerequisite.
- [x] `pnpm check:tasks`, `pnpm check:repo`, and the narrow package/configuration
      checks all pass with actionable output on Windows and CI's Linux runner.
- [x] No unrelated UniCAS files or task history are changed by the adoption.

## Constraints

- Use the published `repoledger@0.1.0` contract rather than an unpublished
  local source build.
- Preserve UniCAS's Node.js and pnpm version policy and deterministic frozen
  lockfile installs.
- Keep the public validator free of UniCAS-specific behavior; retain local
  tests rather than adding project-policy switches to the shared package.
- Preserve unrelated worktree changes, including deployment smoke artifacts
  and any incomplete local task cleanup.

## References

- [UniCAS task policy test](/tests/task-policy.test.mjs)
- [UniCAS task profile](/tasks/README.md)
- [Source repoledger task](https://github.com/shazhou-ww/skills/blob/main/tasks/archived/build-repoledger-cli/Task.md)

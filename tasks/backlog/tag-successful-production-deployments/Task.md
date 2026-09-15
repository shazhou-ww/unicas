# Tag successful production deployments

Created: 2026-09-15

## Goal

Create one immutable, traceable Git tag for every successful production
deployment triggered by a push to `release`, without granting repository write
access to the deployment job itself.

## Context

Production now deploys only from the protected `release` branch. The workflow
validates the exact revision, deploys the service, product site, and
documentation site, runs canonical smoke, and checks all public origins, but
it does not record the verified production revision as a Git tag.

The repository has no existing release-tag convention and its package versions
do not provide one authoritative SemVer. The accepted deployment tag format is
`production-YYYYMMDD-<workflow-run-number>`, for example
`production-20260915-42`. The tag itself points to the deployed commit, so its
name does not repeat the commit hash.

## Scope

- Add a separate post-deployment job that runs only after the protected
  production job succeeds for a `release` push.
- Grant `contents: write` only to the tagging job; retain `contents: read` on
  validation and deployment jobs.
- Derive `YYYYMMDD` from the workflow run's original `created_at` timestamp in
  UTC so rerunning the same workflow across midnight produces the same tag.
- Create `production-YYYYMMDD-<workflow-run-number>` at the exact
  `github.sha` deployed and verified by that workflow run.
- Make tag creation idempotent: an existing tag targeting the same commit is a
  success, while the same name targeting another object fails closed.
- Record the workflow run URL in tag metadata or another durable tag-adjacent
  field without adding secrets or mutable deployment state.
- Protect the `production-*` tag namespace against update and deletion while
  still permitting the workflow to create a new tag.
- Add regression checks and operator documentation for naming, trigger
  boundaries, idempotent reruns, permissions, and recovery from a tag failure.

## Out of scope

- Automatically calculating or publishing SemVer tags such as `v1.2.3`.
- Creating GitHub Releases, release notes, changelogs, or package registry
  releases.
- Backfilling tags for deployments that completed before this workflow exists.
- Creating a new production tag for `workflow_dispatch` recovery runs, pull
  requests, `main` pushes, failed deployments, or failed post-deploy probes.
- Changing Cloudflare deployment order, credentials, runtime secrets, routes,
  bindings, smoke behavior, or rollback behavior.

## Acceptance criteria

- [ ] A successful `release` push creates exactly one tag named
      `production-YYYYMMDD-<workflow-run-number>` after deployment, smoke, and
      every public-origin check pass.
- [ ] The tag targets the exact deployed `github.sha`; its date is the UTC date
      of the workflow run's original creation time, and its run-number segment
      is `github.run_number` without a commit hash in the name.
- [ ] Rerunning the same workflow is idempotent when the tag already targets
      the deployed commit and fails without moving the tag if it does not.
- [ ] Validation failures, deployment failures, pull requests, non-`release`
      pushes, and manual recovery runs create no production tag.
- [ ] Validation and deployment retain `contents: read`; only the post-success
      tagging job receives `contents: write`, using the workflow's GitHub token
      rather than a PAT or new long-lived secret.
- [ ] Creating the tag does not trigger a recursive deployment or validation
      loop.
- [ ] Repository policy prevents updates and deletions in the `production-*`
      tag namespace without preventing creation by the successful workflow.
- [ ] Workflow regression tests, repository checks, documentation checks, and
      GitHub CI pass, including one observed successful automatic tag.

## Constraints

- A tag means the revision reached production and passed all post-deploy
  verification; never create it before those checks complete.
- Keep the deployment job unable to mutate repository contents.
- Treat production tags as immutable audit markers. Never force-update or
  silently replace a conflicting tag.
- Keep tag names deterministic for a workflow run, including reruns on a later
  UTC date.
- Do not place Cloudflare credentials, smoke credentials, private keys, or
  other secrets in tag names, messages, logs, or repository configuration.

## References

- [GitHub Actions workflow](../../../.github/workflows/ci.yml)
- [Deployment and local configuration](../../../docs/deployment-and-local-configuration.md)
- [Operations guide](../../../docs/cas-operations.md)
- [Deployment regression tests](../../../tests/deploy-plan.test.mjs)
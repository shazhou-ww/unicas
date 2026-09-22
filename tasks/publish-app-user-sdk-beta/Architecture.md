# App-user SDK beta publication activation review

Status: Pending requesting-user approval.

## Decision requested

Approve the external activation and first-package bootstrap boundary below.
Approval permits configuration of GitHub and npm trusted-publishing state but
does not authorize creation of the immutable release tag. Tag creation remains
a separate exact-commit authorization after every preflight passes.

## Prepared publication path

The repository already contains one inert release path:

1. A push of `npm/app-user-sdk/v0.1.0-beta.1` starts only
   `.github/workflows/publish-npm.yml`.
2. Its unprivileged `validate` job rebuilds deterministic tarballs, runs packed
   external consumers, checks the exact primary/tag/version contract, and
   performs read-only npm conflict checks.
3. Only a successful validation makes the protected GitHub `npm` environment
   eligible to run.
4. The `publish` job receives `contents: read` and `id-token: write`, repeats
   build and registry preflight, and invokes the sole `npm publish` command in
   dependency order with public access, `beta`, and provenance.
5. No developer machine or repository secret supplies an npm write token.

## External state required before tagging

### GitHub

Create an environment named exactly `npm` and require the requesting release
owner as reviewer before deployment. Store no npm token in the repository or
environment. The workflow filename, environment claim, permissions, and
GitHub-hosted runner remain unchanged.

The environment is currently absent. It may be created only after this review
is approved, then re-read through the GitHub API to prove its protection rules.

### npm

Every package must trust this exact publisher:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `shazhou-ww` |
| Repository | `unicas` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm` |
| Allowed action | Direct `npm publish` |

npm CLI must be at least 11.5.1 on Node 22.14 or newer. The prepared workflow
uses Node 24 and enforces the CLI floor. The public repository and package
repository metadata match `https://github.com/shazhou-ww/unicas` for
provenance.

## First-package bootstrap blocker

Read-only registry checks return `E404` for all six package names. npm's
published setup flow adds a trusted publisher from an existing package's
Settings page; no package Settings surface exists yet. The current browser is
also stopped at npm's human security verification, and the local npm CLI is not
authenticated.

Therefore no release tag may be created until the release owner completes npm
human authentication and one of these statements is proven through the npm UI:

1. npm permits configuring the reviewed trusted publisher before the first
   version of each package exists; or
2. npm requires an owner bootstrap publication to create each package record.

If statement 1 is true, configure all six publishers and continue with the
prepared token-free workflow. If statement 2 is true, stop and separately
review a one-time owner bootstrap procedure. This task will not improvise a
local publish, request a token through chat, add `NPM_TOKEN`, publish placeholder
contents, or consume `0.1.0-beta.1` before the procedure is approved.

## Exact-commit authorization gate

After GitHub environment protection and all six npm publisher records are
verified, rerun artifact checks and the read-only planner on refreshed
`origin/main`. Present the exact commit, version, tag, dist-tag, package order,
integrities, absent registry versions, and successful CI run. Only an explicit
release-owner authorization naming those values permits pushing the tag.

## Observation and recovery

Follow the workflow by immutable run ID and require `success`. If it pauses for
the GitHub environment reviewer, wait for that human decision. Never bypass the
gate.

A failure before registry writes may rerun the same workflow after external
configuration is corrected. If any package version becomes public, first read
and verify the exact registry state. A partial set is not retried or overwritten:
prepare a new reviewed unified beta version, publish the complete new set, and
deliberately deprecate the partial version as the release owner directs.

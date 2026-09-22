# App-user SDK npm releases

UniCAS publishes the public App-user SDK as one versioned release unit through
GitHub Actions trusted publishing. Local `npm publish`, long-lived npm write
tokens, and independently versioned SDK packages are not supported.

## Release unit

The release key is `app-user-sdk`. It always contains exactly:

- `@unicas/codec`
- `@unicas/space-protocol`
- `@unicas/space-client`
- `@unicas/space-blob-client`
- `@unicas/space-browser-cache`
- `@unicas/space-file-client`

All six packages use the same exact version in one release. Their internal
`@unicas/*` dependencies use that exact version after `pnpm pack` transforms
the maintained `workspace:*` source ranges.

The first reviewed release candidate is `0.1.0-beta.1` with npm dist-tag
`beta`. Package semver is independent from the App/Space HTTP path version,
Space capability claim version, and product maturity.

## Maintained release evidence

[`sdk/package-matrix.json`](../sdk/package-matrix.json) is the package identity,
runtime, dependency, order, version, dist-tag, and tag-prefix contract.
[`sdk/release-manifest.json`](../sdk/release-manifest.json) records deterministic
archive filenames, SRI SHA-512 integrity, byte sizes, exact file inventories,
packed exports, transformed dependencies, and publication order.

Prepare or refresh evidence with:

```text
pnpm sdk:prepare
```

Validate without retaining tarballs with:

```text
pnpm check:sdk-release
pnpm check:npm-release
```

The artifact check cleans and rebuilds only the public packages, regenerates
and checks App/Space OpenAPI, packs twice, compares archives, validates each
packed manifest and file allowlist, installs only those archives outside the
workspace, compiles against shipped declarations, runs Node blob/file checks,
and runs a real-Chrome IndexedDB consumer check.

Tarballs are temporary. Never commit or manually patch them.

## Release instruction

One immutable tag instructs publication of the complete set:

```text
npm/app-user-sdk/v<version>
```

For example:

```text
npm/app-user-sdk/v0.1.0-beta.1
```

Only [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml)
handles that tag family. It has no branch, pull-request, or manual publication
trigger.

The workflow first runs an unprivileged validation job. Only after that job
proves primary reachability, deterministic artifacts, exact unified versions,
and an empty immutable-version registry preflight does the protected `npm`
environment become eligible for approval. The publication job repeats all
checks, then publishes in dependency order with public access, the reviewed
`beta` tag, npm trusted publishing, and provenance.

## Preparing a tag

Release operations require an explicit `/publish app-user-sdk <version>`
invocation. Before creating a tag:

1. Fetch `origin/main` and tags and require a clean worktree with `HEAD` equal
   to `origin/main`.
2. Update all six package versions, the package matrix, exact examples, and
   generated release manifest together.
3. Run the full artifact, workflow, repository, build, and typecheck checks.
4. Run the read-only pre-tag planner:

   ```text
   node scripts/prepare-npm-release.mjs \
     --candidate \
     --tag npm/app-user-sdk/v<version> \
     --commit <full-origin-main-commit> \
     --output .artifacts/npm-release-plan.json
   ```

5. Obtain the release owner's explicit authorization for that exact commit,
   unified version, tag, dist-tag, and plan.
6. Create the tag at refreshed `origin/main` and push only that tag. Do not run
   a second publication command.

The first publication additionally requires trusted-publisher entries for all
six package names that match repository `shazhou-ww/unicas`, workflow filename
`publish-npm.yml`, and GitHub environment `npm`, with direct `npm publish`
explicitly allowed rather than the default stage-only permission. Configure
the environment with required reviewers. Do not add `NPM_TOKEN` or
`NODE_AUTH_TOKEN` secrets.

The activation task must verify npm permits those trusted-publisher records
before the first package version exists. If package settings are unavailable
until an owner creates the package record, stop and review a one-time owner
bootstrap procedure. Do not solve that bootstrap by adding a long-lived token
to this workflow or routing a credential through repository state or chat.

## Failure and recovery

Versions and pushed release tags are immutable.

- A validation or authentication failure before any registry write may be
  retried by rerunning the same GitHub Actions run after correcting external
  environment or trusted-publisher configuration.
- If any package version exists unexpectedly, stop. Do not overwrite,
  unpublish, or move the tag.
- npm trusted publishing authorizes `npm publish` but not independent
  `npm dist-tag` repair. Because six registry writes cannot be atomic, a
  mid-set failure requires inspection of the exact published subset followed
  by a new reviewed unified version. Publish that complete new version to move
  every `beta` tag coherently, and deliberately deprecate any partial version
  as directed by the release owner.
- Never repair source, generated output, tarballs, or manifests inside the
  workflow. Fix source on `main`, choose a new version, regenerate evidence,
  and create a new immutable tag.

Package publication rollback is version and dist-tag management; it is not a
service deployment rollback and never deletes UniCAS customer data.

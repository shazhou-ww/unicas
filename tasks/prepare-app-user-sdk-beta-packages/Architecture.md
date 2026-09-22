# App-user SDK beta artifact architecture

Status: Approved by the requesting user on 2026-09-22.

## Decision requested

Approve a deterministic package-preparation pipeline that builds the six
reviewed SDK packages from maintained source, packs them twice with pnpm,
validates their transformed manifests and exact archive contents, installs
only those archives into an external consumer, runs Node and real-browser
checks, records a tracked release manifest, and supplies one tag-triggered
trusted-publishing GitHub Action for the complete package set.

The preparation command cannot publish, authenticate to npm, reserve versions,
mutate dist-tags, or deploy UniCAS. The Action contains publication behavior
but remains inert until the separate protected publication task configures
external trusted identity and pushes an approved immutable tag.

## Maintained inputs and outputs

The implementation adds these repository-owned surfaces:

```text
sdk/
|-- package-matrix.json          # reviewed package/runtime/order contract
`-- release-manifest.json        # deterministic generated artifact evidence
scripts/
|-- prepare-sdk-release.mjs      # clean/build/pack/install/verify orchestrator
`-- prepare-npm-release.mjs      # tag/version/primary release planner
.github/workflows/
`-- publish-npm.yml              # tag-triggered complete-set publisher
tests/
|-- sdk-release.test.mjs         # metadata, drift, and negative guards
`-- fixtures/sdk-consumer/
    |-- node-smoke.ts
    `-- browser-smoke.ts
```

Tarballs, temporary package manifests, external-consumer lockfiles,
`node_modules`, browser bundles, and browser profiles are created below the
operating-system temporary directory and are never committed.

`package-matrix.json` is maintained input. It names exactly six packages and
records one accepted package-set version, runtime class, exports, direct
internal edges, and publication order. The script rejects any extra public
package, mixed version, independently versioned package, or mismatch between
this matrix and a package manifest.

`release-manifest.json` is generated evidence. It records sorted package
names, versions, archive filenames, SRI SHA-512 integrity, byte sizes, exact
file inventories, transformed exports, transformed dependency ranges, and
publication-order edges. It excludes timestamps, absolute paths, usernames,
environment dumps, credentials, and source revision to avoid self-referential
commit content. Git binds the deterministic manifest to the exact reviewed
revision.

## Pipeline

### 1. Clean and generate

The script removes ignored build output for only the six approved packages,
regenerates the maintained App/Space OpenAPI document, verifies OpenAPI drift,
and builds JavaScript and declarations through existing TypeScript project
references. It never edits generated output by hand.

### 2. Pack twice

Each package is packed with `pnpm pack --json` into two independent temporary
directories. The structured pnpm result supplies the archive filename and
file inventory. The pipeline compares corresponding SHA-512 values and fails
when archives from the same source are not byte-identical.

pnpm's gzip payload is deterministic, but its advisory OS header byte follows
the host platform. The pipeline normalizes that byte to the Linux publication
runner value before comparing, hashing, installing, or retaining an archive,
without changing the compressed tar payload.

The packed `package/package.json` is extracted as JSON for structured
validation. No ad hoc manifest rewriting is allowed. The pipeline proves that
pnpm applied `publishConfig`, replaced every internal `workspace:*` range with
the accepted exact prerelease, and left only valid reviewed dependencies.

### 3. Validate archive contents

For each archive, the validator checks:

- every `main`, `types`, and export target exists;
- every file matches the reviewed allowlist;
- README and exact MIT license bytes are present;
- no source, test, fixture, script, map, build cache, local path, credential,
  or unexpected generated artifact is present;
- the protocol archive contains the exact maintained OpenAPI bytes; and
- the archive and transformed manifest agree with the generated release
  manifest.

The validator also rejects duplicate package names, versions, files, export
targets, or publication-order positions.

### 4. Install outside the workspace

The consumer fixture is copied to a new OS-temporary directory that is not
inside any pnpm workspace. Its generated package manifest names all six local
tarballs as file dependencies. A normal frozen consumer install must resolve
third-party packages and all exact internal edges without registry access to
an unpublished `@unicas/*` package and without a link back to `packages/**`.

After installation, the pipeline checks that resolved package roots live
under the consumer's package store and contain no source checkout symlink.
TypeScript compiles the fixture against shipped declarations only.

### 5. Node consumer checks

The Node fixture imports only documented package names and subpaths. It
exercises:

- canonical-node encoding, hashing, and parsing;
- App/Space route and schema construction;
- client URL, authorization, JSON lease, and error behavior through an
  injected fetcher;
- direct-upload and blob-index helpers plus bounded random access; and
- file manifest and working-tree behavior through injected public ports.

Node execution uses the accepted Node 24+ runtime and ESM. No production
network, credentials, or private service package is used.

### 6. Browser consumer checks

The installed fixture is bundled with the repository's existing esbuild
tooling, served from a loopback HTTP server, and opened with the same pinned
headless Chrome/Playwright baseline used by the documentation package. The
test imports every browser-supported package, constructs the public clients,
and performs a real IndexedDB write/read/clear cycle through
`@unicas/space-browser-cache`.

The browser check fails on console errors, failed module loads, unresolved
package paths, unavailable advertised APIs, or cache scope leakage. It does
not call production or persist credentials.

### 7. Manifest drift and CI

`pnpm sdk:prepare` regenerates the deterministic release manifest and leaves
tarballs temporary. `pnpm check:sdk-release` regenerates into a temporary
candidate, compares it with the tracked manifest, runs all archive and
external-consumer checks, and fails on drift.

The focused check is added to CI after the normal build and before deployment
dry runs. Fast package unit tests remain unchanged; release-like packing and
browser installation stay in the focused SDK check so failures identify the
artifact boundary directly.

### 8. Tag-triggered GitHub publication

`.github/workflows/publish-npm.yml` listens only to:

```yaml
on:
  push:
    tags:
      - npm/app-user-sdk/v*
```

It has no `workflow_dispatch` and no branch or pull-request publication path.
The job uses the protected `npm` environment, `contents: read`, and
`id-token: write`; it receives no `NPM_TOKEN` or `NODE_AUTH_TOKEN`. Concurrency
is keyed by the immutable tag and never cancels an in-progress publication.

The job checks out the tag commit with history, proves the commit is reachable
from fetched `origin/main`, parses one canonical SemVer from the tag, and runs
`prepare-npm-release.mjs` to require exact agreement among the tag, all six
manifests, the package matrix, and the tracked release manifest. It installs
with the frozen lockfile, runs the full focused SDK preparation check, queries
npm for immutable-version conflicts, and only then publishes in the matrix's
dependency order using public access, `beta`, provenance, and trusted OIDC.

Workflow tests parse the YAML and planner outputs and use injected registry
responses plus a no-write publisher port. They cover wrong events and refs,
unreachable commits, malformed tags, mixed versions, stale manifests,
existing versions, incomplete dependencies, interrupted ordering, unsafe
permissions, secret environment variables, and accidental local publication.
No test or preparation command invokes a live registry write.

## Package-manager and registry boundary

pnpm is the only manifest transformer. The local preparation and planner
scripts invoke no `publish`, `unpublish`, `deprecate`, `dist-tag`, login, token,
provenance, or registry write command. Only the tag-triggered Action may invoke
`npm publish`. Official registry visibility may be read for diagnostics, but
name ownership and trusted-publisher configuration remain unresolved until
the protected publication task.

The later publication task consumes this Action, matrix, and release manifest
rather than rebuilding package identity policy independently. It configures
the external trust relationship, authorizes one exact tag, observes the run,
and verifies npm.

## Failure behavior

- Build, generation, nondeterminism, archive, dependency, install, typecheck,
  Node, or browser failure aborts the preparation check before any retained
  artifact is accepted.
- A transformed manifest containing `workspace:`, a wrong prerelease, or an
  unreviewed dependency fails closed.
- A tag or Action candidate with mixed public-package versions, a version that
  differs from its tag, or a tag target outside primary fails before registry
  preflight.
- An unavailable public registry or absent package name does not mutate the
  reviewed tarballs and cannot be treated as publication authorization.
- Temporary directories are removed after success and retained only on an
  explicitly requested local diagnostic run; CI never uploads them by
  default.

## Rollback and ownership

Before npm publication, rollback is an ordinary source revert of manifests,
scripts, tests, documentation, matrix, and generated manifest. There is no
registry or service rollback because this task performs neither write.

Each package owns its public source, README, manifest, and build output. The
root SDK preparation script owns cross-package order and artifact evidence.
This task owns the inert tag-triggered Action and release planner. The
publication task owns npm trusted-publisher identity, protected environment
configuration, explicit tag creation, first registry execution, dist-tag and
provenance verification, and partial-publication recovery decisions.

## Review question

Approve the reviewed unified-version matrix plus deterministic
clean/build/double-pack pipeline, exact archive validation, tracked release
manifest, external temporary consumer, Node and real-Chrome checks, CI
integration, `npm/app-user-sdk/v<version>` release planner and protected
trusted-publishing Action, fail-closed behavior, and no-tag/no-live-write
implementation boundary?
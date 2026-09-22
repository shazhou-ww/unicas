# App-user SDK beta artifact architecture

Status: Pending review.

## Decision requested

Approve a deterministic package-preparation pipeline that builds the six
reviewed SDK packages from maintained source, packs them twice with pnpm,
validates their transformed manifests and exact archive contents, installs
only those archives into an external consumer, runs Node and real-browser
checks, and records a tracked release manifest for the later protected npm
publication task.

The pipeline cannot publish, authenticate to npm, reserve versions, mutate
dist-tags, or deploy UniCAS.

## Maintained inputs and outputs

The implementation adds these repository-owned surfaces:

```text
sdk/
|-- package-matrix.json          # reviewed package/runtime/order contract
`-- release-manifest.json        # deterministic generated artifact evidence
scripts/
`-- prepare-sdk-release.mjs      # clean/build/pack/install/verify orchestrator
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
records the accepted version, runtime class, exports, direct internal edges,
and publication order. The script rejects any extra public package or mismatch
between this matrix and a package manifest.

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

## Package-manager and registry boundary

pnpm is the only manifest transformer. The script invokes no `publish`,
`unpublish`, `deprecate`, `dist-tag`, login, token, provenance, or registry
write command. Official registry visibility may be read for diagnostics, but
name ownership and trusted publishing remain unresolved until the protected
publication task.

The later publication workflow consumes the exact matrix and release manifest
rather than rebuilding package identity policy independently.

## Failure behavior

- Build, generation, nondeterminism, archive, dependency, install, typecheck,
  Node, or browser failure aborts the preparation check before any retained
  artifact is accepted.
- A transformed manifest containing `workspace:`, a wrong prerelease, or an
  unreviewed dependency fails closed.
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
The publication task owns npm identity, provenance, protected environment,
registry writes, dist-tags, and partial-publication recovery.

## Review question

Approve the reviewed matrix plus deterministic clean/build/double-pack
pipeline, exact archive validation, tracked release manifest, external
temporary consumer, Node and real-Chrome checks, CI integration, fail-closed
behavior, and strict no-registry-write boundary?
# App-user SDK changelog

This changelog covers the unified release set: `@unicas/codec`,
`@unicas/space-protocol`, `@unicas/space-client`,
`@unicas/space-blob-client`, `@unicas/space-browser-cache`, and
`@unicas/space-file-client`. All six packages use the same version.

## 0.2.0 - Unreleased

### Changed

- Replaced the Space-bound client with one App-level `AppCasClient`; every CAS
  operation now receives `spaceId` first and one instance can serve multiple
  Spaces.
- Replaced `getToken` with a metadata-aware capability provider, fixed
  credential classes, concurrent acquisition coalescing, expiry replacement,
  Root Ref domain pinning, and bounded safe-read refresh after
  `401 invalid_token`.
- Updated blob and file factories to receive a shared App client and explicit
  Space while preserving workflow and browser-cache isolation.
- Migrated first-party Spaces consumers, packed Node/browser consumers,
  examples, API references, and migration guidance to the new surface.

### Removed

- Removed `SpaceCasClient`, `SpaceCasClientConfig`,
  `SpaceCasNodeCacheKey`, and `createSpaceCasClient` without compatibility
  aliases.

This entry describes an unreleased candidate. It does not authorize an npm tag,
dist-tag change, GitHub Release, or publication.

## 0.1.2 - Unreleased (superseded)

### Added

- Package-selection guidance and complete basic workflows for the transport,
  blob, file, and browser-cache clients.
- Executable packed-artifact Node and browser quickstarts, host-responsibility
  references, compatibility and versioning policies, a reviewed TypeScript API
  baseline, and an open-source readiness gate.
- Community contribution, support, security, ownership, issue, and pull-request
  entry points.

### Changed

- Space capability `ver: 2` replaces the single-Space claim with selector-bound
  grants, canonical slash-based Space IDs, unified `/v1/cas` routes with query
  App/Space scope, and one shared CAS v1 OAuth audience.
- Stable installation replaces prerelease installation guidance in every
  package.
- Browser compatibility is defined by Chromium, Firefox, and WebKit consumer
  smoke rather than the phrase "modern browsers".
- Security and workflow automation now reflects published `0.1.x` packages and
  uses immutable Action and container references.

This candidate was not published and is superseded by the breaking `0.2.0`
candidate.

## 0.1.1 - 2026-10-08

### Added

- First coherent stable App-user SDK release on npm's `latest` dist-tag.
- Unified six-package release evidence, deterministic tarballs, external
  declaration consumers, Node and Chrome smoke tests, trusted publishing,
  provenance, and registry verification.

### Changed

- Adopted the App/Space v1 API and exact unified package versions.
- Replaced retired Stack/Tenant client surfaces with the `space-*` packages.

## 0.1.0-beta.1 - 2026-09-23

### Added

- First reviewed beta of the unified App-user SDK package set.

The authoritative release process and immutable evidence are documented in
[docs/npm-package-releases.md](docs/npm-package-releases.md).

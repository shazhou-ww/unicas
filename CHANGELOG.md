# App-user SDK changelog

This changelog covers the unified release set: `@unicas/codec`,
`@unicas/space-protocol`, `@unicas/space-client`,
`@unicas/space-blob-client`, `@unicas/space-browser-cache`, and
`@unicas/space-file-client`. All six packages use the same version.

## 0.1.2 - Unreleased

### Added

- Package-selection guidance and complete basic workflows for the transport,
  blob, file, and browser-cache clients.
- Executable packed-artifact Node and browser quickstarts, host-responsibility
  references, compatibility and versioning policies, a reviewed TypeScript API
  baseline, and an open-source readiness gate.
- Community contribution, support, security, ownership, issue, and pull-request
  entry points.

### Changed

- Stable installation replaces prerelease installation guidance in every
  package.
- Browser compatibility is defined by Chromium, Firefox, and WebKit consumer
  smoke rather than the phrase "modern browsers".
- Security and workflow automation now reflects published `0.1.x` packages and
  uses immutable Action and container references.

This entry describes an unreleased candidate. It does not authorize an npm tag,
dist-tag change, GitHub Release, legacy package deprecation, or publication.

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

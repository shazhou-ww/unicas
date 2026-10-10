# App-user SDK changelog

All six public App-user SDK packages share each version.

## 0.2.0 - Unreleased

- Replaces the Space-bound client with `AppCasClient` and
  `createAppCasClient`; every CAS operation receives `spaceId` first.
- Replaces `getToken` with a metadata-aware capability provider and bounded
  internal credential lifecycle.
- Reacquires and replays one safe read after `401 invalid_token`; mutations,
  `403` responses, and network failures are not automatically replayed.
- Migrates blob/file workflows, browser cache composition, first-party Spaces,
  examples, packed consumers, and documentation to a shared App client plus
  explicit Space.
- Removes `SpaceCasClient`, `SpaceCasClientConfig`,
  `SpaceCasNodeCacheKey`, and `createSpaceCasClient` without compatibility
  aliases.

This is a breaking candidate entry, not a publication record.

## 0.1.2 - Unreleased (superseded)

- Replaces single-Space capability claims with `ver: 2` selector-bound grants,
  canonical slash-based Space IDs, unified `/v1/cas` routes with query
  App/Space scope, and one shared CAS v1 OAuth audience.
- Adds complete client usage guides, package selection, compatibility,
  versioning, TypeScript API, troubleshooting, and support entry points.
- Adds packed-artifact Node and Chromium/Firefox/WebKit quickstarts, tested
  host-responsibility references, and a reviewed API baseline.
- Adds community health and security automation while retaining immutable npm
  trusted publishing and provenance.
- Replaces beta installation and vague browser wording with stable installation
  and an executable support matrix.

This candidate was not published and is superseded by `0.2.0`.

## 0.1.1 - 2026-10-08

- First coherent stable six-package release on npm's `latest` dist-tag.
- Added deterministic packed artifacts, external declaration consumers, Node
  and Chrome smoke, trusted publishing, provenance, and registry verification.
- Adopted the App/Space v1 names and package set.

## 0.1.0-beta.1 - 2026-09-23

- First reviewed beta of the unified App-user SDK release set.

The repository
[changelog](https://github.com/shazhou-ww/unicas/blob/main/CHANGELOG.md) and
[release process](https://github.com/shazhou-ww/unicas/blob/main/docs/npm-package-releases.md)
provide the review and immutable publication context.

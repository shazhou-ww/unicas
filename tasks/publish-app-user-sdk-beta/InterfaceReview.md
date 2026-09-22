# App-user SDK beta publication interface review

Status: Pending requesting-user approval.

## Decision requested

Approve the exact first registry release contract below. Approval freezes the
public package identities and release instruction for publication; it does not
by itself authorize creation of the immutable tag or a registry write.

## Release identity

| Property | Reviewed value |
| --- | --- |
| Release key | `app-user-sdk` |
| Unified version | `0.1.0-beta.1` |
| npm dist-tag | `beta` |
| Visibility | Public |
| Immutable tag | `npm/app-user-sdk/v0.1.0-beta.1` |
| Candidate commit | `a6a9450a617b75c39cb50e91100cee9289b8a37e` |
| Workflow | `.github/workflows/publish-npm.yml` |
| GitHub environment | `npm` |
| Registry | `https://registry.npmjs.org` |

The tag and all six npm versions are immutable. A partial publication cannot be
repaired by moving the tag, overwriting a version, or publishing one package at
a different version. Recovery uses a newly reviewed unified beta version.

## Package order

| Order | Package | Required exact internal dependencies |
| --- | --- | --- |
| 1 | `@unicas/codec` | None |
| 2 | `@unicas/space-protocol` | None |
| 3 | `@unicas/space-client` | `@unicas/space-protocol@0.1.0-beta.1` |
| 4 | `@unicas/space-blob-client` | `@unicas/codec@0.1.0-beta.1`, `@unicas/space-client@0.1.0-beta.1` |
| 5 | `@unicas/space-browser-cache` | `@unicas/space-client@0.1.0-beta.1` |
| 6 | `@unicas/space-file-client` | `@unicas/space-blob-client@0.1.0-beta.1`, `@unicas/space-client@0.1.0-beta.1` |

Package exports, runtime support, file inventories, tarball SHA-512 values, and
third-party dependencies remain exactly those in `sdk/package-matrix.json` and
`sdk/release-manifest.json` at the candidate commit. This task does not redesign
or patch them.

## Verified preflight

On 2026-09-22, read-only checks established:

- the candidate is the exact clean `origin/main` revision;
- the release planner accepts the canonical tag and complete package set;
- `npm/app-user-sdk/v0.1.0-beta.1` is absent locally and on `origin`;
- all six package names return npm `E404`, so no target version or dist-tag
  currently exists;
- exact-candidate main and task-source CI runs succeeded; and
- local deterministic double-pack, external Node/Chrome consumers, planner
  policy tests, package build, and declarations pass for the public SDK set.

## Consumer result required after publication

Completion requires registry reads proving all six exact versions are public,
each `beta` dist-tag points to `0.1.0-beta.1`, registry manifests preserve the
reviewed exports and exact internal dependencies, provenance is attached, and
a clean external consumer installs and exercises the packages from npm rather
than workspace or local tarball paths.

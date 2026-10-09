# App-user SDK versioning and API changes

The six App-user SDK packages are one release unit and always use the same
version. Internal `@unicas/*` dependencies are transformed to that exact
version in packed artifacts.

## Before 1.0

- A patch release is backward compatible for documented public exports and
  supported behavior.
- An intentional breaking TypeScript API or compatibility change requires a
  new minor version and migration guidance.
- Features and compatible additions may use a minor release when their scope
  warrants it.
- A security fix follows the same compatibility rules unless protecting users
  requires an explicitly documented exception.

Every candidate compares generated declarations with the committed public API
baseline. A baseline change must be visible in review and agree with the
candidate version, changelog, and any migration document.

## Independent version axes

Package SemVer does not change or reinterpret:

- the App/Space HTTP path version (`v1`);
- the Space capability claim version (`ver: 1`);
- the canonical node wire-format version; or
- product deployment maturity.

A change to one axis must name that axis explicitly.

## Deprecation

Supported exports are deprecated in documentation and types before removal
when a safe transition exists. A removal before `1.0.0` still requires a minor
release and migration guidance.

The retired `@unicas/tenant-client`, `@unicas/tenant-blob-client`, and
`@unicas/tenant-protocol` packages are replaced by the corresponding
`space-*` packages. Their registry deprecation is an audited deployment action;
published package bytes are never overwritten or unpublished.

## Release traceability

One immutable `npm/app-user-sdk/v<version>` tag identifies the source commit.
The package matrix, deterministic release manifest, changelog, GitHub Release,
npm provenance, and registry verification must all identify that same version
and commit. Passing repository checks establishes release eligibility only;
publication still requires explicit authorization.

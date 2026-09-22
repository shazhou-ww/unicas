# App-user SDK npm first-package bootstrap review

Status: Approved by the requesting user on 2026-09-22.

## Decision requested

Approve or reject one explicit exception to the repository's normal publishing
boundary. npm requires a package record before trusted publishing can be
configured, but all six reviewed package names are new.

The recommended exception publishes one unified bootstrap version from a
separately reviewed source commit with interactive owner authentication. It
must not consume `0.1.0-beta.1`, create the release tag, add a registry token,
or replace the protected workflow for any subsequent version.

## Proven blocker

On 2026-09-22:

- `shazhou.ww` authenticated against `https://registry.npmjs.org` and is an
  owner of the `unicas` organization;
- all six package names and scope package access are absent;
- the npm organization UI exposed a Create package control, but both leaf and
  fully scoped names returned `forbidden` and created no record;
- npm 11.19.1 `npm trust list @unicas/codec` completed human authentication,
  then returned registry `E404`; and
- npm's official `npm trust` prerequisites state that the package must already
  exist on the registry.

The GitHub `npm` environment is now configured with `shazhou-ww` as required
reviewer and contains no secrets or variables. It cannot establish npm trust
until package records exist.

## Recommended bootstrap

Prepare a new reviewed source revision that changes the same six packages from
`0.1.0-beta.1` to one exact bootstrap version:

```text
0.0.0-bootstrap.0
```

Regenerate the package matrix, exact internal dependency versions, lockfile,
and deterministic release evidence through the maintained preparation script.
Do not hand-edit tarballs or substitute placeholder contents. The bootstrap
artifacts must contain the same reviewed package code, exports, declarations,
README, LICENSE, and OpenAPI surface as the beta candidate.

After clean build, double-pack, external Node/Chrome consumer validation, and
an exact read-only registry preflight, the npm organization owner may publish
the six generated tarballs in dependency order from the release worktree:

```text
@unicas/codec
@unicas/space-protocol
@unicas/space-client
@unicas/space-blob-client
@unicas/space-browser-cache
@unicas/space-file-client
```

Each command must use:

- the exact generated `.tgz`, never a package directory;
- `--registry=https://registry.npmjs.org`;
- `--access public`;
- a non-user-facing `bootstrap` dist-tag; and
- interactive npm owner authentication and security-key/2FA handling outside
  chat.

No npm token, GitHub secret, placeholder package, intentional `latest` tag,
`beta` tag, or release Git tag is permitted. Before each write, query the
package/version and stop on any unexpected existing state. After each write,
verify registry integrity, manifest, exports, and dependencies before
continuing. The registry-forced first-version `latest` behavior is handled
below.

## npm-forced latest tag

The first `@unicas/codec` publication proved that npm creates `latest` for a
brand-new package even when the publish command explicitly uses
`--tag bootstrap`. Both npm 11.6.2 and 11.19.1 authenticated successfully but
received registry `E400` when removing that initial `latest` tag. The artifact,
`bootstrap` tag, package access, and trusted publisher remained correct.

On 2026-09-22, the requesting user approved continuing with this unavoidable
registry behavior. During package-record bootstrap, each new package may
temporarily have both `bootstrap` and `latest` pointing to
`0.0.0-bootstrap.0`. After the protected OIDC workflow publishes the complete
`0.1.0-beta.1` set, move both `beta` and `latest` to that supported version and
verify all six packages. Do not leave any package's `latest` tag on the
bootstrap version.

## Restore and activate the reviewed beta

After all six bootstrap versions are verified:

1. Configure each package's trusted publisher for repository
   `shazhou-ww/unicas`, workflow `publish-npm.yml`, environment `npm`, with
   direct `npm publish` allowed.
2. Verify each trust relationship through npm 11.19.1 `npm trust list`.
3. Restore the maintained unified version to `0.1.0-beta.1`, regenerate release
   evidence, and publish that source through the normal non-force primary path.
4. Re-run exact-primary CI, deterministic artifacts, planner, registry
   preflight, and package-record trust checks.
5. Obtain a new exact-commit authorization before creating
   `npm/app-user-sdk/v0.1.0-beta.1`.
6. Let only the protected workflow publish `0.1.0-beta.1` with OIDC and
   provenance under the `beta` dist-tag.
7. Move each npm-forced `latest` tag from `0.0.0-bootstrap.0` to the verified
  `0.1.0-beta.1` version.
8. Deliberately deprecate `0.0.0-bootstrap.0` after the beta release is verified;
  do not unpublish it.

## Why not publish beta.1 manually

Publishing `0.1.0-beta.1` directly would consume the reviewed immutable version
without GitHub OIDC provenance. The prepared workflow would then fail its
existing-version preflight and could not prove the release path it was built to
establish. A lower bootstrap version isolates npm's package-creation limitation
while preserving beta.1 as the first supported release.

## Non-atomic failure rule

The six bootstrap writes are not atomic. If any write fails after a package is
created, stop immediately and inspect the exact registry subset. Do not retry an
existing version blindly, overwrite it, move a user-facing dist-tag, or
unpublish it. Resume only after verifying every existing bootstrap artifact is
byte-for-byte the reviewed tarball and obtaining release-owner direction for
any mismatch.

## Alternatives rejected

- Publishing `0.1.0-beta.1` manually: loses the intended trusted-publishing
  provenance and makes the protected workflow fail closed.
- Publishing placeholder or empty packages: creates unreviewed permanent
  artifacts and can reserve the right name with the wrong contents.
- Adding `NPM_TOKEN` or `NODE_AUTH_TOKEN` to GitHub: introduces a long-lived
  write credential contrary to the approved boundary.
- Moving, deleting, or recreating tags or versions: npm versions and release
  instructions are immutable.

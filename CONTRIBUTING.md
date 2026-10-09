# Contributing to UniCAS

Thank you for improving UniCAS. Contributions are accepted through GitHub
issues and pull requests on a best-effort basis.

## Before you start

- Use an issue to report a bug, request a feature, or ask for integration
  support. Search existing issues first.
- Report suspected vulnerabilities privately according to
  [SECURITY.md](SECURITY.md). Do not put credentials, private data, or exploit
  details in an issue.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in every project space.
- For a substantial behavior or architecture change, open an issue before
  investing in an implementation.

## Development setup

UniCAS requires Node.js 24 or newer and pnpm 11.

```powershell
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm hooks:status
pnpm validate
```

The repository-managed pre-push hook runs `pnpm validate` only when a push
updates remote `main`. It validates the exact checked-out commit and refuses a
dirty worktree or a different local SHA. Installation is explicit and will not
overwrite an existing local or inherited `core.hooksPath`; resolve any reported
conflict yourself. `pnpm hooks:uninstall` removes only the repository-owned
local setting. `git push --no-verify` is an emergency bypass, not validation
evidence, and the release workflow always rebuilds and validates independently.

Use the narrowest relevant package test while iterating. Before opening a pull
request, run `pnpm validate`. Changes to release policy, public SDK artifacts,
or release workflows must also pass:

```powershell
pnpm validate:release
```

The repository test matrix and trust boundaries are documented in
[docs/validation-and-release-workflows.md](docs/validation-and-release-workflows.md).
Package ownership and dependency direction are documented in
[packages/README.md](packages/README.md).

## Pull requests

Keep each pull request focused and:

1. explain the user or maintainer problem being solved;
2. include tests or executable evidence for behavior changes;
3. update directly affected public documentation;
4. preserve package boundaries and avoid unrelated formatting or refactors;
5. call out public API, compatibility, security, migration, or release effects;
6. allow the configured checks to complete without bypassing them.

App-user SDK packages are one unified release unit. Public API changes must
update the reviewed API baseline and changelog. Before `1.0.0`, patches remain
backward compatible; an intentional breaking change requires a minor release
and migration guidance.

## Contribution license

By submitting a contribution, you agree that it is licensed under the
repository's [MIT License](LICENSE). UniCAS does not currently require a
Contributor License Agreement or Developer Certificate of Origin sign-off.

## Review and support

Maintainers may request changes for correctness, tests, documentation,
security, portability, or long-term maintenance cost. Review and support are
best-effort; the project does not promise a response or resolution SLA. See
[SUPPORT.md](SUPPORT.md) for the supported channels and scope.

# App-user SDK public API baseline

The declaration snapshots in this directory are generated from the six packed
SDK package roots. They are review artifacts, not alternate source files and
must not be imported.

`pnpm sdk:prepare` rebuilds the packages, refreshes these snapshots and
`manifest.json`, and then refreshes deterministic release evidence.
`pnpm sdk:artifacts` and `pnpm check:sdk-release` compare generated declarations
with the committed baseline and fail on any unreviewed public surface change.

Before `1.0.0`, a patch must preserve backward compatibility. An intentional
breaking declaration change requires a unified minor version, changelog entry,
and migration guidance.

# Progress

Updated: 2026-09-22

## Current state

The six reviewed App-user SDK packages now form one deterministic
`0.1.0-beta.1` release set with the `beta` dist-tag contract. Their manifests
have public MIT/repository metadata, ESM-only packed exports, Node 24 engine
requirements, side-effect declarations, package-specific READMEs, exact
internal prerelease dependencies after packing, and no source or declaration
maps.

`sdk/package-matrix.json` is the maintained identity, runtime, dependency, and
order contract. `sdk/release-manifest.json` records deterministic tarball
integrity, sizes, exact file inventories, exports, dependencies, and order.
The preparation command builds and packs twice, validates exact archive
contents, installs only those archives outside the workspace, typechecks
shipped declarations, exercises Node codec/protocol/transport/blob/file
behavior, and runs a real-Chrome IndexedDB cache check.

The tag-only `.github/workflows/publish-npm.yml` has an unprivileged validation
job followed by a protected `npm` environment job with only `contents: read`
and `id-token: write`. It repeats primary, artifact, and registry preflight
checks before the sole `npm publish` command. No tag was created and no npm,
dist-tag, GitHub environment, or external trusted-publisher state was changed.

## Decisions

- Release exactly `@unicas/codec`, `@unicas/space-protocol`,
  `@unicas/space-client`, `@unicas/space-blob-client`,
  `@unicas/space-browser-cache`, and `@unicas/space-file-client`.
- Version the six packages permanently as one set; the first candidate is
  `0.1.0-beta.1` under `beta`.
- Use only `npm/app-user-sdk/v<version>` as the automatic publication
  instruction. Branch pushes, pull requests, production tags, and manual
  dispatch cannot publish.
- Keep public package roots as the only JavaScript/type exports, with
  `@unicas/space-protocol/openapi.json` as the sole extra subpath. Preserve no
  Stack/Tenant or source compatibility aliases.
- Ship JavaScript, declarations, README, LICENSE, manifest, and protocol
  OpenAPI only. Explicit LF and TypeScript newline policy makes archive hashes
  cross-platform reproducible.
- Keep `@orpc/openapi` development-only. Add `@opentelemetry/api` as a protocol
  runtime dependency because ORPC's shipped declarations import its public
  types even though ORPC marks it optional.
- Run release validation outside the source workspace and force every internal
  dependency to its local tarball, preventing registry or source-link fallback.
- Forward `blobOptions.uploadFetcher` when storing file manifests; packed
  consumer validation exposed the missing transport injection.
- Use direct trusted `npm publish` for the first package versions. npm staged
  publishing cannot create a new package, and OIDC does not authorize
  independent dist-tag repair. A partial multi-package write therefore stops
  and requires a new reviewed unified version in the publication task.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | On 2026-09-22, with primary at `9fee072f58f61e48d27e5a8d25c05df9805ad97b`, the requesting user stated that the revised scope had no remaining issue and explicitly authorized implementation of [Task.md](./Task.md), including the tag-triggered Action and unified package version. |
| Interface | Approved | On 2026-09-22, the requesting user authorized implementation after review of [InterfaceReview.md](./InterfaceReview.md), including the six-package set, `0.1.0-beta.1`, `beta`, ESM/runtime/exports, exact dependencies, and `npm/app-user-sdk/v<version>` trigger. |
| Architecture | Approved | On 2026-09-22, the requesting user authorized implementation after review of [Architecture.md](./Architecture.md), including deterministic double-pack evidence, external Node/Chrome consumers, release planner, CI integration, and the protected two-job workflow. |
| Business and data model | Not applicable | Package distribution, artifact metadata, and release automation change no domain entity, ownership, persistent customer data, schema, key, retention, or lifecycle state. |
| Delivery acceptance | Pending | Requires an exact integrated primary commit, final release-manifest inventory, clean workspace validation, and explicit user acceptance. |

## Validation

- `pnpm check:sdk-release`: matrix tests pass; repeated package archives match
  by SHA-512; manifests contain no `workspace:` ranges or source exports;
  tarball allowlists and exact LICENSE/OpenAPI bytes pass; external installation
  and strict declaration typecheck pass; Node and real-Chrome consumers pass.
- `pnpm check:npm-release`: canonical/mismatched tag, unified/mixed version,
  incomplete evidence, immutable-version conflict, exact primary, absent tag,
  tag target, trigger, permission, token, ordering, preflight, and sole-write
  guards pass.
- `pnpm --filter @unicas/space-file-client test`: all 8 manifest/filesystem
  tests pass, including injected manifest-upload transport coverage.
- `pnpm docs:check`: all 7 public-route, repository-document inventory, link,
  artifact, determinism, and provenance tests pass.
- `pnpm check:tasks` and `git diff --check`: pass.
- `pnpm clean && pnpm build`: all 15 workspace package builds pass from empty
  generated output. Public SDK outputs contain JavaScript and declarations
  without maps.
- `pnpm typecheck`: all 15 workspace package typechecks pass.
- `pnpm test:exhaustive`: all 159 repository tests and every workspace package
  suite pass, including 258 Cloudflare adapter tests and 60 Spaces tests. One
  initial unrelated D1 people test exceeded its 15-second parallel timeout;
  its focused rerun passed in 8.6 seconds and the complete exhaustive rerun
  passed.
- `pnpm deploy:plan`: renders the existing non-publishing service deployment
  and App/Space smoke plan without registry or production writes.

## Blockers

- No implementation blocker remains.
- The six package names have no publicly readable version on npm. The separate
  publication task must verify namespace ownership and whether npm allows
  trusted-publisher configuration before first package creation. If npm
  requires an owner bootstrap, that task must stop for an explicitly reviewed
  one-time owner procedure rather than introducing a long-lived automation
  token.
- The GitHub `npm` environment and npm trusted-publisher records are external
  state and intentionally remain unconfigured by this task.

## Outcome

The source tree now contains a complete, inert, reproducible App-user SDK beta
release path with full local and workspace validation. Publication to the task
source and primary plus delivery acceptance remain. The separate publication
task will activate external trust and push the first immutable release tag.

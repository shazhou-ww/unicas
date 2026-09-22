# App-user SDK beta package contract

Status: Pending review.

## Decision requested

Approve the first public App-user SDK beta as six final `@unicas/*` packages,
all versioned `0.1.0-beta.1`, published later under the `beta` dist-tag, with
the package exports, runtime support, dependency policy, artifact contents,
and compatibility treatment described below.

This task prepares and validates tarballs only. It does not write to npm,
configure registry identity, move a dist-tag, or deploy a service. Those
actions remain protected by `publish-app-user-sdk-beta` and the beta promotion
capstone.

## Current packing evidence

A clean build and two independent `pnpm pack` rounds were run from the task
source without changing maintained files. The current six archives were
byte-for-byte stable by SHA-512. `pnpm pack` correctly applied each package's
`publishConfig`, changed public entry points from `src` to `dist`, rewrote
every internal `workspace:*` dependency to the package's exact current
version, included the repository MIT `LICENSE`, and included no `src/**` file.

The current archives are not accepted release artifacts because four packages
have no README, all six lack reviewed publication metadata and runtime policy,
and each archive contains JavaScript and declaration maps whose source files
are not shipped. No proposed name currently has a publicly readable version
on `https://registry.npmjs.org`; this read-only result does not prove scope
ownership or publication authority.

## Public package set

| Package | Role | Supported execution runtime | Public exports |
| --- | --- | --- | --- |
| `@unicas/codec` | Canonical node bytes, digest, streaming parser, and validation | Node.js 24+ and modern browsers | `.` |
| `@unicas/space-protocol` | App/Space v1 HTTP contract, routes, schemas, and capability vocabulary | Node.js 24+ and modern browsers | `.`, `./openapi.json` |
| `@unicas/space-client` | Thin App/Space HTTP transport | Node.js 24+ and modern browsers | `.` |
| `@unicas/space-blob-client` | Blob chunking, random access, retention, and node upload helpers | Node.js 24+ and modern browsers | `.` |
| `@unicas/space-file-client` | File manifests and App-owned catalog-backed working trees | Node.js 24+ and modern browsers | `.` |
| `@unicas/space-browser-cache` | IndexedDB and bounded-memory immutable node cache | Modern browsers only | `.` |

Service, Cloudflare, administrator, WebUI, documentation-site, and first-party
App packages are private implementation or product surfaces and are not part
of this release set.

## Version and registry policy

- Every package uses `0.1.0-beta.1` for the first reviewed set.
- The six-package set moves in lockstep for the first beta. A changed artifact
  after publication uses a new immutable prerelease such as
  `0.1.0-beta.2`; no published version is overwritten.
- Internal `@unicas/*` dependencies are exact prerelease dependencies. Source
  manifests retain `workspace:*`, and the package manager must transform them
  to exact `0.1.0-beta.1` values during packing.
- The intended npm visibility is public and the intended dist-tag is `beta`.
  No package is placed on `latest` by this task.
- Package semver, HTTP path version `v1`, Space capability claim version `1`,
  and product maturity `beta` are independent version axes.
- Breaking changes remain possible between beta prereleases, but each
  published prerelease is immutable and internally coherent.

## Module and runtime contract

The SDK is ESM-only. Published manifests expose `import` and `types` targets
and do not advertise CommonJS `require` targets. Node-compatible packages set
`engines.node` to `>=24`, matching the release build and runtime validation.

Browser support is feature-based and validated in current headless Chrome.
Consumers need the Web APIs used by their selected layer: Web Crypto,
Fetch/Headers/Response, Web Streams, Blob, URL, TextEncoder/TextDecoder,
AbortSignal, and `crypto.randomUUID` where applicable. The browser cache also
requires IndexedDB; BroadcastChannel enhancement is optional and must retain
the existing fallback behavior.

No package polyfills globals. Applications targeting older runtimes own any
deliberate polyfill and must still satisfy the documented behavior.

## Export and compatibility policy

- Package-root exports are the only JavaScript and declaration entry points.
- `@unicas/space-protocol/openapi.json` is the only non-root public subpath.
- No source path, implementation module, test helper, generated build folder,
  Stack/Tenant subpath, or compatibility alias is exported.
- Existing package-root App/Space APIs remain unchanged; package preparation
  does not alter HTTP operations, claims, permissions, Root Ref semantics, or
  storage behavior.
- This is the first supported public package release. Prototype consumers must
  use the final names above and package-root imports; there is no deprecated
  npm alias or automatic credential/route translation.

## Tarball content policy

Every tarball contains only:

- the packed `package.json`;
- the exact repository MIT `LICENSE` bytes;
- one package-specific `README.md`;
- compiled ESM `.js` files;
- compiled `.d.ts` declarations; and
- for `@unicas/space-protocol`, the generated
  `openapi/app-space-v1.openapi.json` file.

Tarballs exclude source, tests, fixtures, scripts, TypeScript build state,
JavaScript source maps, declaration maps, local paths, credentials, logs, and
unrelated generated output. Maps are excluded because their referenced source
files are intentionally not published.

## Manifest metadata

All six manifests declare:

- `license: "MIT"`;
- the GitHub repository URL and package directory;
- the repository issue tracker and package documentation/homepage;
- `sideEffects: false`;
- ESM package type;
- the accepted files allowlist and public export map; and
- `publishConfig.access: "public"` plus the accepted `beta` tag.

The four packages currently missing README files receive package-specific
installation, runtime, entry-point, and minimal-usage guidance. Existing
protocol and browser-cache READMEs are reconciled to the same beta contract.

## Dependency contract

Publication order follows this graph:

```text
@unicas/codec                 @unicas/space-protocol
        |                              |
        |                              v
        +--------------------> @unicas/space-client
                                       |          |
                                       v          v
                         @unicas/space-blob-client @unicas/space-browser-cache
                                       |
                                       v
                         @unicas/space-file-client
```

`@unicas/space-file-client` also directly depends on
`@unicas/space-client` for its public `SpaceCasClient` type. The direct edge is
retained rather than relying on a transitive type dependency.

`@orpc/openapi` moves from the protocol runtime dependency set to
development dependencies because only the maintained generator imports it.
`@orpc/contract`, `@orpc/zod`, Zod, and type-bearing JOSE remain protocol
dependencies. Other current third-party runtime dependencies remain unchanged
unless packed-consumer evidence disproves their need.

Packed manifests must contain no `workspace:` range and no dependency on an
administrator package, service implementation, private application,
`@unidocs/*`, or a package outside the approved set except the reviewed
third-party dependencies.

## Consumer behavior

The accepted artifacts must install together in a new directory outside the
repository and compile without workspace links. Node checks exercise public
imports, codec and protocol round trips, client request construction, direct
upload helpers, blob reads, and file working-tree operations. Browser checks
bundle only installed tarballs and exercise package loading plus real
IndexedDB cache behavior in Chrome.

Importing an unexported subpath, using CommonJS `require`, installing an
incomplete internal dependency set, or running on an unsupported runtime is
not a supported compatibility path.

## Review question

Approve the six-package set, `0.1.0-beta.1` lockstep version, `beta` dist-tag,
public ESM-only exports, Node/browser support boundary, exact internal
dependencies, tarball content policy, metadata, dependency graph, and no-alias
compatibility policy, with no registry write in this task?
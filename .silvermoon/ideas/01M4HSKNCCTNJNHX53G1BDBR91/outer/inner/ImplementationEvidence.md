# Implementation evidence

## Candidate scope

本候选实现经批准的 App-level multi-Space client contract：

- `@unicas/space-client` 只公开 `AppCasClient` 与
  `createAppCasClient`，所有 CAS 操作以 `spaceId` 为第一个参数；
- capability provider 返回 opaque bearer token 与可信 metadata，client
  只维护 `content`、`root-refs`、`management` 三个固定 credential class；
- blob、file、browser cache 与第一方 Spaces consumer 共享 App client，同时保留
  显式 Space 隔离；
- 六个 App-user SDK packages、API baseline 与 release manifest 统一为
  `0.2.0`；
- 未创建 npm tag、GitHub Release、dist-tag 写入或 package publication。

## Behavior evidence

### I-S01 / I-AC01 / I-AC02

`packages/space-client/tests/functional-client.test.ts` 的 8 个测试证明：

- 一个 client 使用 exact 与 `/shared/**` grant 连续访问多个 Space，并生成含
  `appId + spaceId + hash + version` 的 cache key；
- 同 credential class 的并发 acquisition 合并，metadata 的版本、时间窗口、
  selector 与 permission 在 HTTP 前 fail closed；
- Root Ref domain 在 client session 内固定；
- 只有安全读操作会在 `401 invalid_token` 后 acquire 并重试一次；
- 写操作、`403` 与网络失败不自动重放；
- range、single-request node read、lease JSON、稳定 HTTP error 与 provider cause
  均保持原有语义。

生成的 `sdk/api/space-client.d.ts` 只导出 `AppCasClient`、
`AppCasClientConfig`、`AppCasNodeCacheKey`、provider/metadata 类型与
`createAppCasClient`。可执行源码和 declaration 搜索不再包含
`SpaceCasClient`、`SpaceCasClientConfig`、`SpaceCasNodeCacheKey` 或
`createSpaceCasClient`。

### I-S02 / I-AC03

blob、file 与 browser cache tests 证明：

- blob store/read、retain/release 与 raw-node helpers 始终把绑定的 `spaceId`
  传给共享 App client；
- file root、manifest、commit/discard 与 upload transport 保持原有 workflow；
- browser cache 仍按 endpoint、Principal、App、Space、hash 与 version 隔离；
- 相同 App client 可供多个 Space-specific workflow 复用，不把 capability
  lifecycle 下沉到 blob/file client。

### I-S03 / I-AC04

Spaces 全套 68 个测试在单 worker 下通过，包括 capability adapter、
file service、worker、bootstrap、D1 repository 与 file root catalog。first-party
provider 由签发时已知 claims 生成 metadata，并在
`packages/spaces/src/capability.ts` 拒绝超出 Principal App、Space 或 permission
的 requirement。

packed Node/browser consumers、Node quickstart 以及 Chromium、Firefox、WebKit
browser quickstart 均从临时目录安装六个 tarball 后通过。live metadata example
要求调用方提供 token 的真实 Unix-second expiry，并只声明
`readMetadata` 的 canonical permission。

### I-S04 / I-S05 / I-AC05

package README、package inventory、docs quickstart/reference/architecture、
troubleshooting、migration guide、example README、根与公开 changelog 已迁移。
旧名称只在 `0.2.0` breaking-change 记录与 migration replacement instruction 中
作为被移除 surface 出现。

以下文件均标识 `0.2.0`：

- 六个 public package manifests；
- `sdk/package-matrix.json`；
- `sdk/api/manifest.json`；
- `sdk/release-manifest.json`。

`pnpm sdk:prepare` 重新生成 API declarations、tarball metadata 与 integrity；
紧随其后的 `pnpm check:sdk-release` 从当前源码重新构建并得到相同结果。

## Validation commands

| Command | Result |
| --- | --- |
| `pnpm install` | 通过；17 个 workspace project，lockfile 已是最新。 |
| `pnpm --filter @unicas/space-client typecheck` | 通过。 |
| `pnpm --filter @unicas/space-client test` | 通过；1 file，8 tests。 |
| `pnpm --filter @unicas/space-blob-client test` | 通过；2 files，8 tests。 |
| `pnpm --filter @unicas/space-file-client test` | 通过；2 files，9 tests。 |
| `pnpm --filter @unicas/space-browser-cache test` | 通过；1 file，11 tests。 |
| `pnpm --filter @unicas/spaces exec vitest run --root . --maxWorkers=1 --minWorkers=1` | 通过；14 files，68 tests。 |
| `pnpm docs:check` | 通过；1 file，7 tests，包含 deterministic docs build。 |
| `pnpm check:repo` | 通过；Silvermoon worktree check、166 repository tests 与 7 release-gated CI tests。 |
| `pnpm check:release` | 通过；5 files，40 tests。 |
| `pnpm build` | 通过；16 个非 root workspace projects。Vite 报告既有 source-map location warning，但所有 build 均成功。 |
| `pnpm typecheck` | 通过；16 个非 root workspace projects。 |
| `pnpm sdk:prepare` | 通过；生成 `0.2.0` API/release artifacts，packed declarations、Node consumer、Node quickstart 与三浏览器 quickstart 全部通过。 |
| `pnpm check:sdk-release` | 通过；22 release/readiness tests、2 OpenAPI drift tests、packed declarations、Node consumer、Node quickstart、Chromium、Firefox 与 WebKit。 |
| `node --check scripts/cas-app-space-smoke.mjs` | 通过。 |
| `node --check packages/spaces/scripts/bootstrap.mjs` | 通过。 |
| `node --check packages/spaces/scripts/preflight.mjs` | 通过。 |
| `git diff --check` | 通过；仅报告三个既有 CRLF-to-LF normalization warning。 |
| executable source/declaration `git grep` for removed Space-client symbols | 无匹配。 |

## Validation iterations

- 首次并行 package check 触发多个 pnpm process 同时修复 workspace links，产生
  `node_modules/.pnpm/lock.yaml` 的 Windows `EPERM` 竞争；单进程
  `pnpm install` 后所有受影响检查通过。
- 首次手工 Spaces `vitest` 调用遗漏 package script 的 `--root .`，因此只搜索
  `ui/` 并报告无测试；使用上表命令后 68 tests 全部通过，先前两个 D1 timeout
  在单 worker 下也通过。
- 首次 final release check 发现 live example 使用的 branded permission 类型宽于
  provider metadata finite union；改用
  `SpaceOperationPolicies.readMetadata.permission` 后重新生成并重复验证成功。

这些迭代没有放宽 timeout、加入 compatibility alias、隐藏错误或修改无关业务
行为。

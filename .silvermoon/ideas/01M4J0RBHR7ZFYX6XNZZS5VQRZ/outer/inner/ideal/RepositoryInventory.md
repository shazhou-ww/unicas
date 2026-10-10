# Repository cleanup 盘点

## 快照

- Repository baseline commit：`d81253cdba2a1c6bc49370881e173b7858854329`
- 盘点与讨论日期：`2026-10-10`
- 方法：只读检查 tracked paths、workspace manifests、package scripts、workflow、
  deployment config、tests、docs references 和相关 Git history，并逐项确认目标
  ownership。

本盘点只对所检查快照及当前达成的目录共识负责，不是对保留资产永远不会过时的
永久判断。

## 历史观察

- `stacks/unicas/` 由 commit `a0e7eecaa3a755628568d2cb5e9acdd05afa5ede`
  在 `2026-08-27` 以 “standardize dev and deploy workflows” 引入。
- Standalone repository extraction 发生在 commit
  `e82d372915ce83b868625457a22647f26941cca7`（`2026-09-14`）。
- 抽取前后 `stacks/` 都只有 `unicas` 一个 child。该层级曾是刻意设计，但在
  standalone repository 中不再区分 sibling stack。
- 当前 maintained repository 中有 25 个文件直接引用 `stacks/unicas`；路径迁移
  必须同步 package scripts、workflow、tests、docs、configs 与 Agent guidance。

## 当前目录职责与结论

| 当前路径 | 实际职责 | 结论 |
| --- | --- | --- |
| `sdk/` | App-user SDK unified release matrix、release manifest、reviewed API baseline | 内容保留并迁入 `release/app-user-sdk/`；删除空旧 root |
| `stacks/unicas/deploy/*.mjs` | Service production plan/deploy/smoke/cutover/secret/tracing orchestration | 迁入 `release/service/` 或 `release/shared/` |
| `stacks/unicas/deploy/migrations/tenant/` | App-scoped Space storage schema baseline | SQL 原样迁入 `packages/service-cloudflare/migrations/app-space/` |
| `stacks/unicas/spaces/*.mjs` | Spaces deployment orchestration 与 generated config | 迁入 `release/spaces/` |
| `stacks/unicas/spaces/{wrangler.jsonc,migrations/}` | `@unicas/spaces` deployment config 与 schema | 迁入 `packages/spaces/` package root |
| `stacks/unicas/site/` | Product apex assets-only Worker source 与 config | 迁入新的 private `packages/site/` |
| `stacks/unicas/local/` | Local compose、mock OIDC 与 runtime | 连同根 local helpers 迁入 `scripts/local/` |
| 根 `scripts/` release files | SDK/npm/release revision/tagging helpers | 迁入对应 `release/` unit |
| 根 `scripts/` Git files | Hook install/status 与 pre-push gate | 迁入 `scripts/git/` |
| `packages/spaces/scripts/` | Bootstrap、preflight、issuer proof、production smoke | 迁入 `release/spaces/`；package 保留实现与 build tooling |
| `examples/app-user-sdk/` | 用户 quickstarts、docs targets、packed/registry consumer programs | 保留原位 |

## 应删除的旧资产

### `stacks/unicas/README.md`

该文件只解释旧 stack container 的职责和 commands。目标结构不再存在
`stacks/unicas/`；仍有效的 package ownership、release entry 和 local workflow
内容将分别进入 root/package docs 与 `release/README.md`。完成内容核对后删除，
不保留历史路径副本。

### 旧 root commands

旧 `dev`、`deploy:*`、`spaces:*`、`sdk:*` 和相关 release aliases 是 repository
interface entries，不是文件。所有 repository-owned callers 原子迁移后移除，
不保留 deprecated wrappers。

### 移动后的空目录

`sdk/`、`stacks/`、`packages/spaces/scripts/` 及移动后为空的旧 script directories
只在内容全部迁移、tracked references 为零后删除。

## 保留

### `examples/app-user-sdk/`

- `prepare-sdk-release.mjs` 与 `verify-npm-release.mjs` 会将其复制到 clean temporary
  consumer，安装 packed/registry packages 后编译并运行 Node/browser quickstarts。
- 当前 public docs 直接链接这些完整 executable sources。
- 结论：面向使用者的 executable examples；不归 docs 或 release 所有。

### SDK release evidence

- `package-matrix.json` 定义六个 packages 的统一版本、发布顺序与兼容 toolchain。
- `release-manifest.json` 固化 packed files、dependencies、integrity 与 order。
- `api/*.d.ts` 与 manifest 是 committed public API review baseline。
- 结论：全部保留并迁入 `release/app-user-sdk/`；不得按“可生成”理由删除。

### Operational cutover 与 retirement assets

Issuer cutover、managed issuer retirement 和 release recovery 内容仍由 workflow、
tests 或 rollback procedures 消费。它们迁移或保留，但不因历史名称而删除。

### `.agents/` 与 `.silvermoon/`

Canonical Agent guidance 与 idea lifecycle history 不进入普通 cleanup 删除。
Path guidance 会随 target layout 更新，但 history 不重写。

## Package ownership 证据

- `@unicas/service-cloudflare` 已拥有 service Worker implementation、Wrangler config
  和 D1/R2 adapters；App-scoped Space migration 属于该 Cloudflare adapter。
- `@unicas/spaces` 是独立部署的 private first-party App；其 Wrangler config、
  migrations 和 Wrangler tool dependency 应由 package 自己拥有。
- Product apex 是独立 assets-only Worker。它具备独立 origin、config、tests 和
  release lifecycle，因此成为 private `@unicas/site` package；不并入
  `@unicas/docs-site`。
- `@unicas/docs-site` 继续只拥有 `docs.unicas.work` 内容、renderer、tests 与
  config。

## Release 与 tooling 边界

- `release/`：发布 contract、evidence、plan/deploy/smoke/cutover/bootstrap scripts。
- `scripts/git/`：repository hook management 与 pre-push validation。
- `scripts/local/`：local runtime orchestration 及其私有 Docker/compose inputs。
- `packages/**`：product/package source、package-root deployment config、
  migrations、build/test tooling。
- `examples/`：面向使用者且可执行的 repository examples。

## 冻结环境

`unicas.shazhou.work` 及其 Cloudflare resources 不属于本 cleanup。本盘点中的
任何观察都不授权修改、部署或删除它们。

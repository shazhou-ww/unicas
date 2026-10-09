# Deployment evidence

## 范围与候选

证据日期：2026-10-09。

本证据执行于已同步的 deployment contract revision
`ec899be447baab347d2a658eba30564b0956a6dd`，其内层边界是已接受的
`implementationRevision`
`4981699cfc370a03df4274c130a4cba4219f52a4`。

formal preflight 开始时：

- clean worktree 的 `HEAD` 与 `origin/main` 均为
  `b8f83375abbb24a0dad76f3af9f25f75521a77cc`；
- 远端只有
  `npm/app-user-sdk/v0.1.0-beta.1` 与
  `npm/app-user-sdk/v0.1.1` 两个 App-user SDK tags；
- GitHub Releases 为空；
- 六个 SDK package 的 npm `latest` 均为 `0.1.1`，version 列表均不含
  `0.1.2`；
- 三个 `tenant-*` package 都只有 `0.1.0`，exact version 的 `deprecated`
  字段均不存在；
- 既有 `0.1.1` trusted-publishing run
  `37751689281` 成功，证明同一 `publish-npm.yml`、GitHub `npm`
  environment、OIDC publication 与外部 registry verification 曾在 exact tag
  上完整运行。

当前会话没有收到精确 `/publish app-user-sdk 0.1.2` 授权。

后续 remediation 已针对新的精确
`implementationRevision`
`f2c8a798a8661757f944982ad3bd78e776c52dc4`
获得明确验收。该候选增加受保护的 docs-only deployment workflow，不改变
六包 npm publication gate。

## D-S01：外部基线与写入门禁

### 公开入口

匿名 HTTP HEAD 结果：

| URL | HTTP |
| --- | ---: |
| `https://docs.unicas.work/app-user-api/sdk/` | 404 |
| `https://docs.unicas.work/app-user-api/compatibility/` | 404 |
| `https://docs.unicas.work/app-user-api/sdk-reference/` | 404 |
| `https://docs.unicas.work/app-user-api/versioning/` | 404 |
| `https://docs.unicas.work/app-user-api/changelog/` | 404 |
| `https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md` | 200 |
| `https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md` | 200 |

源码中的 `CHANGELOG.md` 与文档站 changelog 都仍使用
`0.1.2 - Unreleased`；前者说明该 entry 是 unreleased candidate 且不授权
tag、Release、deprecation 或 publication，后者说明它不是 publication 或
deprecation record。

因此 D-AC01 未通过。按 contract，以下动作保持未执行：

- 三个 `tenant-*` package deprecation；
- read-only npm publication plan；
- `npm/app-user-sdk/v0.1.2` tag；
- GitHub Release；
- 六个 `0.1.2` npm publish 或 dist-tag 写入；
- production service、Spaces、site 或 docs deployment。

要解除 blocker，必须先让 live SDK routes 来自包含已接受实现的受保护
deployment，并把两个 changelog release-finalize 为精确发布日期；任何源码或
workflow 修复都需要新的 Implementation revision、完整验证与明确验收。

## D-S02：GitHub metadata 与 community health

写入前公开状态：

- description：
  `Independent content-addressed storage service with tenant and administrator access planes`
- homepage：`https://unicas.work`
- topics：空
- community health：100%

使用已知 repository write identity `shazhou-ww` 执行 metadata 写入；没有把
credential、token 或响应中的敏感字段写入仓库。随后恢复只读 identity
`wewei` 并重读：

- description：
  `Independently deployable content-addressed storage service with App/Space and administrator access planes`
- homepage：`https://unicas.work`
- topics：
  `cas`、`cloudflare-workers`、`content-addressed-storage`、`oauth`、
  `sdk`、`serverless`、`storage`、`typescript`
- community health：100%

匿名 HTTP HEAD 对 README、LICENSE、CONTRIBUTING、Code of Conduct、
SUPPORT、SECURITY、Issue forms 目录和 PR template 全部返回 200。

这完成 D-S02 与 D-AC02。该写入没有创建 tag、Release、workflow run 或 npm
状态变化。

## 首次停止点（已解除）

D-S01 与 D-S02 已完成；D-S03 至 D-S07 尚未开始。D-AC02 已满足，其余
acceptance criteria 保持未完成。

下一步需要维护者选择一个能满足 D-AC01 的实施路径：

1. 推荐：回到 Implementation，release-finalize 两个 changelog，并建立只部署
   docs 的受保护路径，避免为 SDK 文档发布重部署 API、Spaces 和产品站；
2. 复用现有 full production release 部署 docs，但仍需先回到 Implementation
   release-finalize changelog，并另行授权完整 production release；
3. 修改 package 文档链接以指向已存在的公开 GitHub 页面；这同样会改变六个
   tarball 和 accepted implementation，且偏离已批准的 docs-site 产品入口。

维护者随后选择推荐路径，并接受包含受保护 docs-only workflow 的新精确
Implementation revision。下节记录该 remediation 的实际 deployment 结果。

## Docs-only remediation deployment

维护者明确验收
`implementationRevision`
`f2c8a798a8661757f944982ad3bd78e776c52dc4`
后，Silvermoon 返回 deploying，deployment revision 为
`9893de920d2b0217ed903dd3c34a6c5e9415d69a`。

### Environment protection 与失败恢复

首次 workflow dispatch `37898593862` 在任何 step 开始前失败。GitHub
annotation 明确说明 `main` 不在 `Production` environment 的 deployment
branch policy；没有 checkout、build、credential exposure 或外部部署。

保持原 `release` policy 的同时新增 `main` policy。`Production` 最终规则仍为：

- custom branch policies：`main`、`release`；
- required reviewer：`shazhou-ww`；
- `prevent_self_review: true`；
- admin bypass 可用；
- secrets 仍只进入受保护 job。

第二个 dispatch `37898791556` 发现 workflow ref 已因并发 primary 更新变为
`52a2088e0c4275f59438feb2e176ba238ced12f7`，而输入还是旧 commit；在审批和任何
step 前主动取消。刷新 primary 后确认并发变化只属于独立
`release-gated-ci` idea，SDK implementation 与 deployment revisions 未改变。

最终 run `37898864985` 由 exact current primary
`52a2088e0c4275f59438feb2e176ba238ced12f7` dispatch。由于唯一配置 reviewer
也是具备 Actions dispatch scope 的触发 identity，GitHub 的
prevent-self-review 阻止普通审批。在维护者已明确确认这个 exact
Implementation 和继续 docs deployment 的前提下，使用 environment 允许的
admin bypass：临时把 `prevent_self_review` 设为 false，批准唯一 pending run，
并在同一操作的 `finally` 中立即恢复为 true。恢复后的 environment 规则已通过
只读 API 重验。

### 成功 run 与公开结果

run `37898864985` 成功完成全部步骤：

1. full lowercase revision validation；
2. exact revision checkout；
3. `HEAD` 与 refreshed `origin/main` 精确相等验证；
4. dependency 与 Chromium 安装；
5. Silvermoon committed check、docs unit/type/browser tests；
6. Wrangler dry-run；
7. docs-only production deployment；
8. public routes 与 exact source revision 验证。

job 没有调用 service、Spaces、product-site、npm、tag 或 GitHub Release write
path。独立匿名验证结果：

| URL | HTTP |
| --- | ---: |
| `https://docs.unicas.work/` | 200 |
| `https://docs.unicas.work/app-user-api/sdk/` | 200 |
| `https://docs.unicas.work/app-user-api/quickstart/` | 200 |
| `https://docs.unicas.work/app-user-api/compatibility/` | 200 |
| `https://docs.unicas.work/app-user-api/sdk-reference/` | 200 |
| `https://docs.unicas.work/app-user-api/versioning/` | 200 |
| `https://docs.unicas.work/app-user-api/changelog/` | 200 |
| `https://docs.unicas.work/app-user-api/troubleshooting/` | 200 |
| `https://github.com/shazhou-ww/unicas/blob/main/SUPPORT.md` | 200 |
| `https://github.com/shazhou-ww/unicas/blob/main/SECURITY.md` | 200 |

公开 `artifact-manifest.json`：

- `sourceRevision`：
  `52a2088e0c4275f59438feb2e176ba238ced12f7`；
- pages：31；
- OpenAPI SHA-256：
  `8c2b46ed9a803b36754068626b76d28a6eeee51138404c5a33dcb2d6ee00958d`。

SDK landing 包含 `App-user SDK`，公开 changelog 包含 `0.1.2` candidate。原
docs 404 blocker 已解除。

## 更新后的停止点

D-S01、D-S02 与 D-AC02 保持完成；受保护 docs remediation deployment 也已
完成并可追溯。D-S03 至 D-S07 以及 D-AC01、D-AC03 至 D-AC07 仍未完成。

D-AC01 当前只剩 release-finalization gate：根 changelog 与公开文档站
changelog 仍正确标记 `0.1.2 - Unreleased`/candidate。当前没有精确
`/publish app-user-sdk 0.1.2` 授权，因此没有修改 changelog，也没有执行：

- 三个 `tenant-*` deprecation；
- npm release plan 或 `0.1.2` tag；
- 六包 npm publication/dist-tag write；
- GitHub Release。

这不是可由 Agent 推断的普通歧义。精确 `/publish` 是已批准 Ideal 与
Deployment contract 的显式 registry-write gate；在收到它之前，保持外部发布
阻断。

## Publication 延期后的 preflight

维护者随后明确决定暂不发布 package，并授权在完成、确认其他 Deployment
验收后接受 Deployment。同步后的 contract revision 是
`dda36c80369223a2837c360f5015f3cc8875799a`。本轮 preflight 开始时，
clean worktree 的 `HEAD` 与 refreshed `origin/main` 均为
`3be06f8dcc06c7de06efdd1a8ebeb1023cabd1fa`。

这项决定不授权 `/publish`。根 changelog 继续使用
`0.1.2 - Unreleased`，公开 changelog 继续把 `0.1.2` 标为 candidate；两处
都没有成功发布声明。

### 公开入口与 provenance

匿名 HTTP HEAD 再次证明 docs root、SDK landing、quickstart、
compatibility、SDK reference、versioning、changelog、troubleshooting、
SUPPORT 和 SECURITY 全部返回 200。SDK landing 包含 `App-user SDK`，公开
changelog 包含 `0.1.2` 与 candidate，并且没有日期化的 `0.1.2` 发布标题。

`https://docs.unicas.work/artifact-manifest.json` 仍报告：

- `sourceRevision`：
  `52a2088e0c4275f59438feb2e176ba238ced12f7`；
- pages：31；
- OpenAPI SHA-256：
  `8c2b46ed9a803b36754068626b76d28a6eeee51138404c5a33dcb2d6ee00958d`。

从该 source commit 直接读取的 Inner World tree OID 是
`f2c8a798a8661757f944982ad3bd78e776c52dc4`，与已接受的
`implementationRevision` 精确相等。

### 未发布状态

匿名 registry 读取证明六个 SDK package 的 `latest` 都仍为 `0.1.1`，version
列表都不含 `0.1.2`。`npm/app-user-sdk/v0.1.2` Git tag 和同名 GitHub Release
都不存在。`publish-npm.yml` 只有两个既有成功 run：

- `37751689281`：`npm/app-user-sdk/v0.1.1`；
- `35800458882`：`npm/app-user-sdk/v0.1.0-beta.1`。

没有 `0.1.2` publish run，也没有本地 publish、dist-tag 写入、占位 tag、
Release 或长期 npm token。GitHub metadata、100% community health 和
`Production` environment 也经只读 API 重验；environment 仍只有 `main` 与
`release` policies、required reviewer `shazhou-ww`、
`prevent_self_review: true`，并允许 admin bypass。

未来 publication 必须从当时 refreshed primary 重新执行完整 preflight，并
重新收到精确 `/publish app-user-sdk 0.1.2`；本次 conditional acceptance
不能复用为未来 registry write 授权。

### Read-only candidate preflight

以下命令在 exact primary 上通过：

`pnpm --workspace-concurrency=1 validate:release`

该命令包含 repository/Idea 检查、构建、typecheck、package tests、
`check:release`、独立 declaration consumers、Node quickstart、
Chromium/Firefox/WebKit smoke、deterministic artifacts、Worker dry-run 和所有
deployment dry-run。随后运行：

`node scripts/prepare-npm-release.mjs --candidate --tag npm/app-user-sdk/v0.1.2 --commit 3be06f8dcc06c7de06efdd1a8ebeb1023cabd1fa --output <session-artifact>/sdk-release-plan.json`

planner 成功生成 read-only plan；临时 `.sdk-release` tarballs 随后删除，
worktree 保持 clean。plan 的 `distTag` 是 `latest`，publication order 与
`sdk/release-manifest.json` 一致：

| Order | Package | Bytes | Integrity |
| ---: | --- | ---: | --- |
| 1 | `@unicas/codec@0.1.2` | 7564 | `sha512-QargAZpixMtmRz3TGqGWwLQJQhJ3OasyGK94awKtSeKxSSsjCn12orTikpibJusLG2PP9XqHvn+AMdRaMnbHuQ==` |
| 2 | `@unicas/space-protocol@0.1.2` | 23247 | `sha512-GomdfT1q6tWtqsQ3JGfYvSYGfd/3YpVnu9zpLuWod8RbQFQWAcdZlx9UQKgpjLwAIm8ERfohDi+gStsdhBGxJg==` |
| 3 | `@unicas/space-client@0.1.2` | 7002 | `sha512-iICeLEEnRi9YaoO5bYWAeoTO6nZPBag79IUitsC5GYr1J3Gk2lBe4EFhbz2x8kZA4pVK7kqOPyGT0mUA2kkXsA==` |
| 4 | `@unicas/space-blob-client@0.1.2` | 9528 | `sha512-7gLB6NiVDoOo/svMN4Mya0BHzjy6ljJ3Pm5GIc0MCNnMyoZ/7qHAV/sP7JGj2mpVJK/Bh44XKNU9Lk7NmCm/7w==` |
| 5 | `@unicas/space-browser-cache@0.1.2` | 7604 | `sha512-OkRFMKLgzuJNb3akGhlsGBDSSbdec95rENd6HafbzFlc0bu3XwozFkjNG7gDgxgYxfd46apXU1IOItgNbafg+A==` |
| 6 | `@unicas/space-file-client@0.1.2` | 8728 | `sha512-Rz04mwO+Hfy9yCdUTrRsox72ZIN1iXvyR7ctVIOrU7du7Pr0kt7E1Kc+SrRreztoC61Vkho0/1CThiUF9annkA==` |

`check:release` 同时证明 file allowlist、exports 和内部依赖；所有内部
dependencies 都是 exact `0.1.2`。由于 D-S03 尚未完成，contract 要求的
D-AC01 至 D-AC03 前置条件还没有全部满足，因此这次执行只记录为可复现
preflight，不提前把 D-S04 或 D-AC04 标记为完成。完成 D-S03 后必须从当时
refreshed primary 重跑 planner。

### Legacy deprecation 停止点

匿名 registry 重验结果：

| Package | Versions | `latest` | `deprecated` |
| --- | --- | --- | --- |
| `@unicas/tenant-client` | `0.1.0` | `0.1.0` | 不存在 |
| `@unicas/tenant-blob-client` | `0.1.0` | `0.1.0` | 不存在 |
| `@unicas/tenant-protocol` | `0.1.0` | `0.1.0` | 不存在 |

迁移 URL 返回 200，三个对应的 `space-*` 替代 package 已公开且
`latest@0.1.1`。但是：

`npm whoami --registry=https://registry.npmjs.org`

返回 `E401 Unauthorized`。npm Web 页面也被 bot-verification challenge
阻断，没有可复用的已登录 owner session。因此没有执行任何
`npm deprecate`，三个 package 均未发生 registry mutation；也没有把 npm
credential 写入仓库、日志、evidence、chat 或 GitHub secret。

当前已完成 D-S01、D-S02、D-S05、D-AC01、D-AC02 与 D-AC05。D-S03 是唯一
需要外部身份能力的剩余动作；它同时阻断 D-S04、D-S06、D-S07 以及
D-AC03、D-AC04、D-AC06、D-AC07。维护者需要在本机建立短期 npm owner
session，之后只能按 D-S03 对三个 exact `@0.1.0` 版本执行并逐个匿名复验。

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

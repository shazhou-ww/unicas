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

## 当前停止点

D-S01 与 D-S02 已完成；D-S03 至 D-S07 尚未开始。D-AC02 已满足，其余
acceptance criteria 保持未完成。

下一步需要维护者选择一个能满足 D-AC01 的实施路径：

1. 推荐：回到 Implementation，release-finalize 两个 changelog，并建立只部署
   docs 的受保护路径，避免为 SDK 文档发布重部署 API、Spaces 和产品站；
2. 复用现有 full production release 部署 docs，但仍需先回到 Implementation
   release-finalize changelog，并另行授权完整 production release；
3. 修改 package 文档链接以指向已存在的公开 GitHub 页面；这同样会改变六个
   tarball 和 accepted implementation，且偏离已批准的 docs-site 产品入口。

在维护者做出选择并接受新的精确 Implementation revision 前，保持外部发布
阻断，不把当前 partial deployment 描述为完成。

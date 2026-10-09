# Deployment

## Steps

### D-S01: 固定 deployment 候选与外部写入门禁

以已接受的 `implementationRevision`
`4981699cfc370a03df4274c130a4cba4219f52a4` 为内层边界，在同步本 contract
后重新读取 refreshed `origin/main`、GitHub repository/community/workflow、
npm registry、公开文档和 release 状态。记录精确 primary commit、已有 tags、
六包版本/dist-tags、三个旧包版本/deprecation、GitHub metadata、community
health、Release 和 live documentation HTTP 状态。

任何外部写入前都要求 clean worktree、`HEAD == origin/main`、候选 commit 可从
refreshed primary 到达且 Silvermoon snapshot 有效。不得把“继续 deployment”
解释为 `/publish` 授权；只有精确文本
`/publish app-user-sdk 0.1.2` 才授权创建
`npm/app-user-sdk/v0.1.2` tag 和由该 tag 触发的 registry 写入。

若 package README 指向的 SDK landing、compatibility、API、versioning、
changelog、support 或 security URL 任一不是 HTTP 200，或根/文档站 changelog
仍把 `0.1.2` 标为 `Unreleased`/candidate，立即阻断 deprecation 与 publication。
这些是已接受 repository deliverable 的缺口；只能回到经过重新验证和验收的
Implementation 候选，或先完成另一个已批准的受保护文档发布路径，不能在
Deployment world 静默改源码。

### D-S02: 更新 GitHub 产品 metadata 并确认 community health

把公开 repository description 精确更新为：

`Independently deployable content-addressed storage service with App/Space and administrator access planes`

保留 homepage `https://unicas.work`，并把 topics 精确设为
`cas`、`cloudflare-workers`、`content-addressed-storage`、`oauth`、
`sdk`、`serverless`、`storage`、`typescript`。使用具有 repository write
权限的已知 GitHub 身份执行；写前记录原值，写后用匿名或只读 API 重读。若
topics 或 description 部分失败，停止后按同一目标幂等重试；只有维护者明确
决定撤销时才恢复记录的原值。

GitHub community profile 必须保持 100%，CONTRIBUTING、Code of Conduct、
SUPPORT、SECURITY、Issue forms、PR template、LICENSE 与 README 均可从
public repository 到达。Metadata 更新不授权 tag、Release 或 npm 写入。

### D-S03: 以精确迁移消息退役三个 Tenant 包

只有 D-AC01 的公开迁移入口通过且匿名 registry 仍证明每个包只有 `0.1.0`、
deprecation 为空时，才以 npm owner 身份逐个执行：

- `@unicas/tenant-client@0.1.0`：
  `Retired Tenant API; use @unicas/space-client. Migration: https://docs.unicas.work/app-user-api/sdk/`
- `@unicas/tenant-blob-client@0.1.0`：
  `Retired Tenant API; use @unicas/space-blob-client. Migration: https://docs.unicas.work/app-user-api/sdk/`
- `@unicas/tenant-protocol@0.1.0`：
  `Retired Tenant API; use @unicas/space-protocol. Migration: https://docs.unicas.work/app-user-api/sdk/`

命令只允许 `npm deprecate <exact-package>@0.1.0 <exact-message>`；不得
unpublish、移动 dist-tag、发布替代空包或扩大到未观察到的 version range。
每次写入后从匿名 registry 读取 exact version 并比对完整消息，再继续下一个。
网络或权限失败时停止并记录已完成子集；重试只处理未匹配的包。错误消息可用
同一 exact version 幂等纠正；清空 deprecation 只在维护者明确要求撤销后执行。

### D-S04: 生成并审查无写入 npm 发布计划

在 D-AC01 至 D-AC03 通过且 candidate version 仍为统一 `0.1.2` 后，重新运行
`pnpm --workspace-concurrency=1 validate:release`，清理临时 tarball，再运行：

`node scripts/prepare-npm-release.mjs --candidate --tag npm/app-user-sdk/v0.1.2 --commit <full-origin-main-commit> --output <session-artifact>`

计划必须证明六包 exact version 均不存在、dist-tag 为 `latest`、publication
order 与 `sdk/release-manifest.json` 一致、内部依赖是 exact `0.1.2`，tag
不存在且 commit 是 refreshed primary。计划和命令输出保存在 session artifact
或 Outer World evidence；不得提交 tarball、凭据或可写 token。

完成 read-only plan 后停止，向 release owner 展示 exact commit、tag、
dist-tag、六包 integrity/bytes、变更说明和恢复边界。没有精确
`/publish app-user-sdk 0.1.2` 授权时，D-S05 不得开始。

### D-S05: 通过 immutable tag 与 protected workflow 发布六包

获得精确授权后再次 fetch primary/tags 并重跑 planner，要求计划与获批 commit
完全一致。只在该 commit 创建并 push
`npm/app-user-sdk/v0.1.2`；不得本地 `npm publish`、注入长期 npm token、
复用 branch artifact 或移动既有 tag。等待 GitHub `npm` protected environment
和 `.github/workflows/publish-npm.yml` 对 exact tag 的唯一 run。

workflow 必须从 tag 重新构建 deterministic artifacts、完成全 registry
preflight、按依赖顺序使用 OIDC trusted publishing 与 provenance 发布，并从
匿名 registry 验证完整 release。失败前无写入时可在修复外部配置后重跑同一
run；部分写入时先读取每包 exact version/integrity/dist-tag，只允许 workflow
对精确匹配项 skip 并补齐缺失项。任何不匹配都停止，不得 overwrite、unpublish、
移动 tag 或手工修 dist-tag。

### D-S06: 创建同 tag GitHub Release 并执行独立外部验证

只有六包 registry 验证全部通过后，才从同一 immutable tag 创建非 draft、
非 prerelease 的 GitHub Release `App-user SDK 0.1.2`。Release notes 使用已
release-finalized 的根 changelog 内容，链接 package guide、compatibility、
versioning、support 和 migration，并说明三个 Tenant 包的替代路径。不得在
registry 部分成功时提前发布成功形态的 GitHub Release。

运行 `pnpm verify:npm-release -- --expect-latest`，并以匿名 npm/GitHub/HTTP
读取证明六包 `latest`、tarball integrity、exports、exact dependencies、
repository/workflow/tag/commit/run provenance、registry signatures/attestations、
GitHub Release、live docs 和旧包 deprecation 全部一致。

### D-S07: 发布 deployment evidence 并请求验收

把所有 read-only 基线、授权边界、实际命令、GitHub run/Release、registry
响应、HTTP 状态、部分失败与恢复动作写入同一 Outer World 的
`DeploymentEvidence.md`。更新 ledger，运行 Silvermoon worktree/staged
checks，提交并以普通非强制方式同步到 refreshed primary，确认 evidence commit
可达后重新观察精确 `deploymentRevision`。只有全部 criteria 通过后才请求该
精确 revision 的人工 Deployment acceptance。

## Acceptance criteria

### D-AC01: 发布前公开入口与 release notes 已就绪

匿名 HTTP 读取证明 package README 的 SDK landing、compatibility、API、
versioning、changelog、support 和 security 入口均返回 200 且内容来自包含已
接受实现的可追溯 revision。根 changelog 与文档站 changelog 精确标记
`0.1.2` release date，不再包含 `Unreleased` 或“不是 publication record”
声明。任何一项失败时，deprecation、tag、GitHub Release 和 npm publish 均为零。

### D-AC02: GitHub metadata 使用当前产品语言

公开 API 读取的 description、homepage 和 topics 与 D-S02 完全一致，description
不含退役 Tenant 命名，community health 为 100%，所需 community/support/
security 入口可匿名访问。证据同时保留修改前值与执行 identity，不包含凭据。

### D-AC03: 旧包展示精确迁移路径

匿名 npm registry 读取证明三个且仅三个 `tenant-*@0.1.0` package version
分别带有 D-S03 的完整 deprecation message，`latest` 未移动且不存在新增
version。对应 `space-*` 替代包在 deprecation 前已公开可安装，迁移 URL 返回
200。

### D-AC04: 六包 0.1.2 registry release 完整且可复现

六个 App-user SDK 包的 `0.1.2` 均存在并同时位于 npm `latest`；公开 tarball
SHA-512、bytes、file allowlist、exports、exact internal dependencies 与
`sdk/release-manifest.json` 一致。独立 no-token consumer 的 declarations、
Node quickstart 和 Chromium/Firefox/WebKit smoke 通过；每包 provenance 指向
同一 repository、`publish-npm.yml`、immutable tag、exact commit 和成功 run。

### D-AC05: GitHub Release 与 registry/tag/changelog 对齐

唯一 tag `npm/app-user-sdk/v0.1.2` 指向获批 primary commit，唯一非 draft、
非 prerelease GitHub Release 标题为 `App-user SDK 0.1.2`，其 notes 与
release-finalized changelog 一致并链接公开文档。tag、Release、六包版本和
provenance 可双向追溯，没有同版本的替代 tag 或成功形态占位 Release。

### D-AC06: 外部写入遵守授权与恢复边界

证据证明 tag/registry 写入发生在精确 `/publish app-user-sdk 0.1.2` 授权之后，
且只由 protected workflow 使用 OIDC 执行；没有本地 publish、长期 token、
unpublish、overwrite、未经授权的 dist-tag 移动或 production service deploy。
任何失败都记录 exact completed subset、停止条件、幂等重试或新版本恢复决定。

### D-AC07: 外部状态与接受的实现可追溯

同步到 primary 的 `DeploymentEvidence.md` 从已接受
`implementationRevision`、deployment contract、release commit、manifest、
tag、workflow run、GitHub Release、npm/provenance、旧包 deprecation 和 live
HTTP 结果形成完整链路。Silvermoon checks 通过，ledger 全部完成，并以重新观察
的精确 `deploymentRevision` 请求人工验收。

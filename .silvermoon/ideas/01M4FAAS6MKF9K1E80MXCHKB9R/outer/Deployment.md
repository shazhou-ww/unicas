# Deployment

## Steps

### D-S01: 固定 deployment 候选与外部写入门禁

以已接受的 `implementationRevision`
`f2c8a798a8661757f944982ad3bd78e776c52dc4` 为内层边界，在同步本 contract
后重新读取 refreshed `origin/main`、GitHub repository/community/workflow、
npm registry、公开文档和 release 状态。记录精确 primary commit、已有 tags、
六包版本/dist-tags、三个旧包版本/deprecation、GitHub metadata、community
health、Release 和 live documentation HTTP 状态。

任何外部写入前都要求 clean worktree、`HEAD == origin/main`、候选 commit 可从
refreshed primary 到达且 Silvermoon snapshot 有效。不得把“继续 deployment”
解释为 `/publish` 授权；只有精确文本
`/publish app-user-sdk 0.1.2` 才授权创建
`npm/app-user-sdk/v0.1.2` tag 和由该 tag 触发的 registry 写入。

维护者决定暂不发布 `0.1.2` package。package README 指向的 SDK landing、
compatibility、API、versioning、changelog、support 或 security URL 任一不是
HTTP 200 时，立即阻断 deprecation 与 publication。公开入口全部可用后，可以
独立 deprecate 已退役 `tenant-*` 包；根/文档站 changelog 必须继续诚实标记
`0.1.2` 为 `Unreleased`/candidate，直到未来收到精确
`/publish app-user-sdk 0.1.2` 授权。当前 Deployment acceptance 不创建 tag、
GitHub Release、npm version 或 dist-tag write。

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

### D-S04: 验证并冻结未发布 0.1.2 候选

在 D-AC01 至 D-AC03 通过且 candidate version 仍为统一 `0.1.2` 后，重新运行
`pnpm --workspace-concurrency=1 validate:release`，清理临时 tarball，再运行：

`node scripts/prepare-npm-release.mjs --candidate --tag npm/app-user-sdk/v0.1.2 --commit <full-origin-main-commit> --output <session-artifact>`

计划必须证明六包 exact version 均不存在、dist-tag 为 `latest`、publication
order 与 `sdk/release-manifest.json` 一致、内部依赖是 exact `0.1.2`，tag
不存在且 commit 是 refreshed primary。计划和命令输出保存在 session artifact
或 Outer World evidence；不得提交 tarball、凭据或可写 token。

完成 read-only plan 后记录 exact commit、拟议 tag、dist-tag、六包
integrity/bytes、变更说明和恢复边界。计划只证明候选可发布，不构成 tag 或
registry write 授权；输出保存在 session artifact，不作为已发布状态。

### D-S05: 记录 package publication 延期并保持 registry 不变

记录维护者“暂时先不做 package 发布”的决定。匿名读取证明六包 `latest` 仍为
`0.1.1`、`0.1.2` 全部不存在，`npm/app-user-sdk/v0.1.2` tag 与同名 GitHub
Release 不存在，且没有 publish workflow run。不得 release-finalize changelog、
创建占位 tag/Release、本地 `npm publish`、移动 dist-tag 或注入长期 npm token。

未来若收到精确 `/publish app-user-sdk 0.1.2`，必须从当时 refreshed primary
重新验证候选并按 `docs/npm-package-releases.md` 执行；本次 Deployment
acceptance 不能复用为未来 registry write 授权。

### D-S06: 独立验证非发布 deployment 结果

以匿名 npm/GitHub/HTTP 读取证明 GitHub metadata、community health、live docs
及 exact source revision、三个旧包 deprecation、六包 `0.1.2` 缺席、
`latest@0.1.1`、tag/Release 缺席和 changelog candidate 状态全部一致。确认
成功 docs workflow 没有 service、Spaces、product-site、npm、tag 或 Release
write path，Production environment 的 reviewer、prevent-self-review 与
main/release policies 已恢复到记录状态。

### D-S07: 发布 deployment evidence 并请求验收

把所有 read-only 基线、授权边界、实际命令、GitHub run/Release、registry
响应、HTTP 状态、部分失败与恢复动作写入同一 Outer World 的
`DeploymentEvidence.md`。更新 ledger，运行 Silvermoon worktree/staged
checks，提交并以普通非强制方式同步到 refreshed primary，确认 evidence commit
可达后重新观察精确 `deploymentRevision`。只有全部 criteria 通过后才请求该
精确 revision 的人工 Deployment acceptance。

## Acceptance criteria

### D-AC01: 公开入口就绪且候选状态诚实

匿名 HTTP 读取证明 package README 的 SDK landing、compatibility、API、
versioning、changelog、support 和 security 入口均返回 200 且内容来自包含已
接受实现的可追溯 revision。根 changelog 与文档站 changelog继续精确标记
`0.1.2 - Unreleased`/candidate，不出现成功发布声明。文档不可用时
deprecation 保持阻断；package publication 延期期间 tag、GitHub Release 和
npm `0.1.2` 均为零。

### D-AC02: GitHub metadata 使用当前产品语言

公开 API 读取的 description、homepage 和 topics 与 D-S02 完全一致，description
不含退役 Tenant 命名，community health 为 100%，所需 community/support/
security 入口可匿名访问。证据同时保留修改前值与执行 identity，不包含凭据。

### D-AC03: 旧包展示精确迁移路径

匿名 npm registry 读取证明三个且仅三个 `tenant-*@0.1.0` package version
分别带有 D-S03 的完整 deprecation message，`latest` 未移动且不存在新增
version。对应 `space-*` 替代包在 deprecation 前已公开可安装，迁移 URL 返回
200。

### D-AC04: 六包 0.1.2 未发布候选完整且可复现

完整 release validation 与 read-only planner 证明六个 `0.1.2` candidate
tarball 的 SHA-512、bytes、file allowlist、exports、exact internal
dependencies 与 `sdk/release-manifest.json` 一致；独立 consumer declarations、
Node quickstart 和 Chromium/Firefox/WebKit smoke 通过。同时匿名 registry
证明六包 `0.1.2` 均不存在、`latest` 仍为 `0.1.1`。

### D-AC05: Publication 延期状态跨 surface 对齐

根/公开 changelog 都把 `0.1.2` 标为未发布候选；Git tag、GitHub Release、
六个 npm versions、dist-tag 和 publish workflow run 都没有 `0.1.2` 成功形态。
Outer evidence 记录延期决定，并明确未来发布需要新的 exact primary preflight
与精确 `/publish app-user-sdk 0.1.2` 授权。

### D-AC06: 外部写入遵守授权与恢复边界

外部写入仅包含已审查的 GitHub metadata、docs-only deployment 与三个 exact
legacy version deprecation。证据证明没有本地 publish、长期 token、tag、
GitHub Release、npm `0.1.2`、dist-tag 移动、unpublish、overwrite 或 production
service/Spaces/site deploy；所有失败、取消、保护规则临时变化与恢复均可追溯。

### D-AC07: 外部状态与接受的实现可追溯

同步到 primary 的 `DeploymentEvidence.md` 从已接受
`implementationRevision`、deployment contract、candidate commit/manifest、
docs workflow run、GitHub metadata、npm 未发布状态、旧包 deprecation 和 live
HTTP 结果形成完整链路。Silvermoon checks 通过，ledger 全部完成，并以重新观察
的精确 `deploymentRevision` 执行维护者已明确授权的 conditional acceptance。

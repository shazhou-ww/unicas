# Deployment

## Steps

### D-S01: 固定 no-write Deployment 边界

以已验收 Implementation revision
`e3de9e727abd40070127055de5b45922fe54b8e7` 为唯一 implementation 输入。
本 idea 的 Deployment 结果是 primary 上可追溯、可重复构建且外部无冲突的
`0.2.0` 候选，不是 npm publication 或 production rollout。

当前没有 `/publish app-user-sdk 0.2.0`、production Spaces、docs 或 UniCAS
deployment 授权。不得创建 Git tag、GitHub Release、npm version、dist-tag 写入，
不得执行 Wrangler production deploy，也不得修改冻结的
`unicas.shazhou.work` 环境。只允许运行 read-only registry/GitHub 查询、
candidate planner 与明确标记的 dry-run。

### D-S02: 证明 accepted candidate 位于 primary

刷新 `origin/main`，证明 accepted status commit、Implementation evidence、
`0.2.0` package matrix、API baseline 与 release manifest 都从 primary 可达。
运行 Silvermoon remote check，并记录 primary commit、accepted Implementation
revision 与当前 Deployment revision，避免用本地未同步状态代替现实世界证据。

### D-S03: 生成只读 npm candidate plan

对 primary commit 运行
`node scripts/prepare-npm-release.mjs --candidate --tag npm/app-user-sdk/v0.2.0
--commit <primary-commit> --output <session-artifact>`。planner 只能读取 registry
并写 session artifact；不得创建 tag 或 publish。

验证 plan 包含六个 package、正确 dependency order、exact internal `0.2.0`
dependencies、与 `sdk/release-manifest.json` 一致的 tarball integrity，以及
registry collision preflight。

### D-S04: 审查第一方与文档 dry-run

运行 `pnpm deploy:spaces:plan` 与 `pnpm deploy:docs:plan`。两项都必须保持
dry-run/no-write，并证明迁移后的 Spaces consumer 与文档 candidate 可以由现有
部署工具解析。任何 credential 缺失、配置错误或非零退出都必须显式记录，不能
改为真实部署来绕过。

### D-S05: 记录外部 no-write 证据

用 read-only npm 与 GitHub 查询证明六个 package 均不存在 `0.2.0`，
`npm/app-user-sdk/v0.2.0` tag 与同名 GitHub Release 不存在，且没有本 session
触发的 publish/deploy write。把精确命令、结果、candidate plan 摘要与
no-write 结论写入同世界 `DeploymentEvidence.md`。

## Acceptance criteria

### D-AC01: Accepted implementation 可从 primary 追溯

Silvermoon remote check 与 Git ancestry 证明 primary 包含
`implementationAcceptedRevision:
e3de9e727abd40070127055de5b45922fe54b8e7`，并包含匹配的 Implementation
evidence、API baseline 与 `0.2.0` release manifest。

### D-AC02: 0.2.0 candidate plan 完整且无 registry 冲突

read-only npm candidate planner 成功，六包顺序、版本、exact internal
dependencies、tarball integrity 与 committed release manifest 一致；registry
preflight 证明不可变 `0.2.0` version 尚未占用。

### D-AC03: Spaces 与 docs deployment plan 可执行

`pnpm deploy:spaces:plan` 和 `pnpm deploy:docs:plan` 都以零退出完成，输出明确
dry-run，不执行 production write。结果证明第一方 consumer 与公开文档的部署
入口能消费 accepted candidate。

### D-AC04: 外部 publication 与 production 保持不变

read-only npm/GitHub evidence 证明六包 `0.2.0`、candidate Git tag 与 GitHub
Release 均不存在；本 Deployment 没有 npm publish、dist-tag 修改、GitHub
Release、Spaces/docs/UniCAS production deployment 或 legacy environment
修改。未来任何 publication 或 rollout 仍需独立、精确授权。

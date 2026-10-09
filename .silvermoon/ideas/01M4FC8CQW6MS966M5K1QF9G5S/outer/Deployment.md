# Deployment

本 Deployment 交付已验收的精确 Implementation revision
`95772046a762bfd8ef3b83d0d99ff19b45f237fd`。它是无外部写入的交付确认：
验证 repository、生成 artifact、SDK consumer 和部署 dry-run 已准备好，并记录
公开状态与未部署边界；不选择 npm version，不创建 tag 或 GitHub Release，不
移动 dist-tag，也不执行 Cloudflare、文档站或其他 production deployment。

## Steps

### D-S01: 固定已验收候选与无写入边界

在本 contract 同步到 primary 后，重新观察稳定 `deploymentRevision`，记录
refreshed `origin/main`、本 contract commit、已验收 Implementation revision
与实现交付 commit。验证 worktree clean、candidate 可从 refreshed primary
到达且 Silvermoon snapshot 有效。

本 idea 只补齐既有 wire 行为的契约表示；生产 runtime、存储和权限语义无需
migration。后续 SDK package publication 由其独立 release owner、版本选择、
受保护 workflow 与显式 `/publish` 授权负责，不能归因于本 Deployment。

### D-S02: 执行只读 artifact 与 deployment preflight

在不注入生产 credential、不创建外部资源的条件下运行：

- `pnpm check:openapi`，证明受版本控制 OpenAPI 与生成器一致；
- `pnpm check:sdk-release`，证明 public API baseline、deterministic package、
  declaration、Node 和 browser consumer 均可交付；
- `pnpm deploy:plan`，使用仓库受支持的 dry-run 审查 service deployment；
- `pnpm deploy:docs:plan`，构建文档并使用 Wrangler dry-run 审查 docs
  deployment。

任一命令尝试真实 deployment、需要未授权外部写入或出现 contract/assertion
失败时立即停止。临时构建输出不得提交；不得用放宽 test、跳过 drift 或手工修改
生成 artifact 的方式取得成功。

### D-S03: 记录公开状态与兼容性结论

以匿名或只读方式确认：

- primary 上的 contract、OpenAPI、文档与证据可由 immutable commit 到达；
- npm registry、Git tags、GitHub Releases 和 live docs 的观测值被记录为
  外部快照，不把其他 idea 的 publication 或 deployment 归因于本 idea；
- live production 未因本会话改变，现有 `/v1` wire、authorization、Root Ref
  与 storage 行为不要求 migration 或 rollback；
- repository 中的新文档是已验收 source candidate；若 live docs 尚未包含它，
  明确记录“未部署”，不得描述为 production 已发布。

只读检查不得保存 token、capability、OAuth material、Cloudflare secret、npm
credential 或客户数据。由于本 Deployment 不执行外部写入，不需要破坏性 rollback；
若候选以后被否决，只能通过普通后续 commit 或独立 release 决策处理。

### D-S04: 发布 Outer World 证据并请求验收

把命令、结果、外部快照、无写入证明、兼容性结论、失败与恢复动作写入同一 Outer
World 的 `DeploymentEvidence.md`。更新 ledger，运行 Silvermoon worktree 和
staged checks，提交并以普通非强制方式同步到 refreshed primary，确认 evidence
commit 可达后重新观察精确 `deploymentRevision`。

只有全部 criteria 通过后才请求该精确 revision 的人工 Deployment acceptance；
acceptance 本身仍不授权 npm publish 或 production deployment。

## Acceptance criteria

### D-AC01: 候选与已验收 Implementation 可追溯

证据引用精确 Implementation revision
`95772046a762bfd8ef3b83d0d99ff19b45f237fd`、稳定 deployment revision、实现
交付 commit 和 refreshed primary commit；所有 candidate commit 均可从 primary
到达，Silvermoon snapshot 有效。

### D-AC02: 生成 artifact 与 dry-run 可交付

OpenAPI drift、SDK release/consumer checks、service deployment plan 和 docs
deployment plan 全部退出 0。生成 OpenAPI、public declarations、packed
artifacts 与文档 build 来自同一 primary candidate；worktree 不遗留临时产物。

### D-AC03: 生产兼容性与公开文档状态准确

证据明确区分 repository 中已接受的 public contract/docs source、live docs
实际观测值和未执行的 deployment。结论证明既有 production wire 与权限语义无需
migration；不得声称未观测或未部署的外部状态已经完成。

### D-AC04: 发布与 deployment authority 未扩大

本会话没有创建或移动 npm version/dist-tag、Git tag、GitHub Release、Cloudflare
deployment 或其他外部写入。任何未来 package release、docs publish 或 production
promotion 仍需要其 owner 的独立 contract、门禁和显式授权。

### D-AC05: Outer World 证据完整且可安全审查

`DeploymentEvidence.md` 记录精确命令、结果、公开 URL/版本快照、无写入边界与
异常处理，不含 secret 或客户数据；ledger 的 Deployment 项与本 contract 稳定
ID 一致，并随候选同步到 primary。

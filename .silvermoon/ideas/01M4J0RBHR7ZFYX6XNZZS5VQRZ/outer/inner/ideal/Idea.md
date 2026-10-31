# 重构 UniCAS repository 的 release、package 与 tooling 边界

## 意图

删除 standalone repository 中已经失去区分作用的 `stacks/unicas/` 层级，并按
稳定所有权重新组织 release orchestration、部署资产、本地工具和跨 package SDK
发布证据，使目录名直接回答“谁拥有这个文件、它服务哪一类 lifecycle”。

本 idea 同时建立分级删除标准。Cleanup 不以删除数量为成功指标；文件只有在
消费者、历史职责、外部调用、rollback 和保留风险全部得到证明后才能删除。

## 背景

`stacks/unicas/` 在 `2026-08-27` 为标准化 dev/deploy workflow 而建立，
repository 在 `2026-09-14` 才抽取为 standalone UniCAS repository。当前
`stacks/` 只有 `unicas` 一个 child，第二层不再区分 sibling stack，且目录内已经
混合 release scripts、local tooling、D1 migrations、Wrangler 配置和静态站点
源码。

根 `sdk/` 也不包含 SDK 实现。它保存六个 App-user SDK packages 的统一 release
matrix、deterministic release manifest 和 public API baseline；真正实现位于
`packages/`。根 `scripts/` 则同时容纳 release、Git hook 和 local-dev 工具。

本 idea 按以下原则重建边界：

- `release/` 只拥有发布编排脚本、发布契约与发布证据；
- deployable package 自己拥有 Wrangler 配置、migrations 和工具依赖；
- `scripts/` 只保留非 release 的 repository tooling；
- 面向使用者的 executable examples 保持独立，不归文档或 release 所有；
- repository command names 与新目录职责同步原子切换，不保留旧 aliases。

现状证据记录在
[`RepositoryInventory.md`](./RepositoryInventory.md)，精确目标树、命令映射和
实施批次记录在 [`TargetLayout.md`](./TargetLayout.md)。

## 期望结果

- 删除顶层 `sdk/` 与 `stacks/`；其仍有效的内容全部通过 Git rename 迁入明确的
  owning directory。
- 新建 `release/`，按 `app-user-sdk`、`service`、`spaces`、`site`、`docs`
  和少量 `shared` helper 组织发布编排、契约与证据。
- 根 `scripts/` 收敛为 `scripts/git/` 与 `scripts/local/`；local scripts 与其
  私有 `Dockerfile`、`compose.yaml` 输入共置。
- `@unicas/service-cloudflare` 在 package root 保留 Wrangler 配置，并在
  `migrations/app-space/` 拥有 App-scoped Space schema baseline。
- `@unicas/spaces` 在 package root 拥有 Wrangler 配置与 `migrations/`，独立
  声明 Wrangler devDependency，不再借用 `@unicas/service-cloudflare` 的 CLI。
- 新建私有 workspace package `@unicas/site`，由它拥有 product apex 的静态源码、
  Wrangler 配置、独立 Wrangler devDependency、package metadata 和 package tests。
- `@unicas/docs-site`、`@unicas/site`、`@unicas/service-cloudflare` 与
  `@unicas/spaces` 只拥有配置、实现、build/test tooling；production/plan
  orchestration 统一从 `release/<unit>/` 进入。
- `examples/app-user-sdk/` 保持顶层位置，继续同时服务用户学习、文档链接和
  packed/registry external-consumer release tests。
- Root commands 统一为 `local:<action>` 与 `release:<unit>:<action>`；旧的
  `dev`、`deploy:*`、`spaces:*`、`sdk:*` 及相关 release aliases 被移除。
- 所有 imports、package scripts、workspace/TypeScript 配置、workflow、CODEOWNERS、
  docs、tests、Agent guidance、release checks 和 deployment dry-runs 同步到新路径。
- 产品行为、公开 API、database schema、migration SQL、线上资源和发布产物保持不变。

## 分级删除标准

### 运行时、部署与公开文档资产

只有同时满足以下条件时才可删除：

1. Imports、配置、workspace graph、CI、scripts、tests、docs 和 release/deploy
   路径中没有消费者；
2. Package scripts、exports、workflow、部署配置或人工运维说明中没有声明入口；
3. Git history 和对应 lifecycle/运维证据证明阶段性职责已经结束；
4. 动态加载、外部调用、rollback、审计和保留风险已经明确关闭。

任一条件无法证明时必须保留或继续调查。

### 生成物、baseline 与 fixture

只有同时证明存在权威来源与确定性重建方式、消费者已迁移或被替代、验证继续
覆盖原用途，并且该资产不是 review baseline、release evidence 或 compatibility
contract 时才可删除。仅有“可以重新生成”不足以证明可删除。

### lifecycle、审计与政策资产

Silvermoon history、批准与验收证据、许可证、安全政策、审计记录和仍受保留规则
约束的资产不进入普通 cleanup 删除候选。

## 范围

### 范围内

- 依照 [`TargetLayout.md`](./TargetLayout.md) 移动现有 release、deployment、
  local、Git hook、SDK evidence 和 site 文件。
- 创建 `release/README.md` 与 `release/app-user-sdk/README.md`，说明稳定所有权、
  入口和禁止放入的资产。
- 创建 `@unicas/site` private workspace package，并更新 package inventory、
  workspace/typecheck/build/test 与 deployment checks。
- 将 service 与 Spaces migrations/configuration 迁入 owning package；保持 SQL、
  binding、database ID、migration filename 和 migration order 不变。
- 将 Spaces bootstrap、preflight、issuer proof 与 production smoke scripts
  迁入 `release/spaces/`，同步测试与调用方。
- 为 site/docs 增加显式 mode 的 `release/<unit>/deploy.mjs` wrappers，并移除
  package-local direct deploy scripts。
- 原子切换 root command namespace，更新全部 repository-owned callers，不保留
  deprecated aliases。
- 更新 `.agents/`、`AGENTS.md` 和相关 guard，使 package/deployment boundary
  routing 指向新的 canonical paths。
- 删除内容已被当前 owner 文档吸收的 `stacks/unicas/README.md`，并删除移动后
  为空的 `sdk/`、`stacks/` 与旧 script directories。

### 范围外

- 改变 App/Space、administrator、service、Spaces、SDK、site 或 docs 的产品行为。
- 改变公开 package exports、HTTP/OAuth contracts、database schema、migration
  SQL、Cloudflare bindings、resource names、resource IDs 或 deployment order。
- 将 `examples/app-user-sdk/` 移入 docs、release 或 package。
- 合并、拆分或重命名现有 middleware/client packages；新增 `@unicas/site`
  是唯一 package-set 变化。
- 生产部署、D1 migration、npm publish、tagging、secret mutation 或其他外部副作用。
- 修改冻结的 `unicas.shazhou.work` legacy environment。
- 删除 Silvermoon history、审计证据、许可证、安全政策或 retention-controlled
  records。

## 约束

- 在 implementation 前必须获得对本 Ideal World 精确 revision 的明确批准。
- 所有 `packages/**` 与 release/deployment boundary 变更必须保持 UniCAS
  package ownership、access-plane separation、依赖方向和单 service deployment
  boundary。
- `release/` 不得吸收 Wrangler 配置、D1 migrations、静态站点源码、local compose
  或 package implementation。
- Deployable packages 独立拥有 Wrangler dependency 与 package-root 配置；
  release scripts 通过 package tooling 执行 plan/production。
- Production commands 必须包含显式 `:production`；不得新增裸 production
  shortcut。
- 旧文件路径和旧 root commands 不保留 copy、symlink、wrapper 或 deprecation
  alias。Repository-owned callers 必须在同一 coherent candidate 内全部切换。
- Migration 文件只能 Git rename；若出现 SQL content 或 order diff，本 idea
  必须返回 preparing 重新评审。
- Unknown external direct-file callers 无法静态证明时，稳定的 root command 与
  documented workflow 是唯一 repository-supported interface；本 idea 不承诺
  internal `.mjs` path compatibility。
- 使用普通 Git rename/delete 和非-force synchronization；不 reset、重写或清理
  unknown work。

## 实施批次

Implementation 在同一 candidate 内使用三个 coherent commits：

1. **Package ownership**：创建 `@unicas/site`；把 service/Spaces deployment
   config 与 migrations 移入 owning packages；建立独立 Wrangler ownership。
2. **Release ownership**：建立 `release/`；移动 SDK evidence 和全部 release
   scripts；切换 root commands、workflow、tests 与 docs consumers。
3. **Tooling cleanup**：建立 `scripts/{git,local}`；移动 local/hook tooling；
   更新 canonical guidance 和 guards；删除已替代的 README 与空旧目录。

每个 commit 完成最窄相关验证；三个 commits 全部完成后再运行 repository-wide
release validation。不得向 primary 同步中间的不完整 candidate。

## 完成边界

本 idea 在以下事实全部可验证后完成 implementation：

- Target tree 与 command mapping 和 [`TargetLayout.md`](./TargetLayout.md) 一致；
- `sdk/`、`stacks/` 和旧 root command names 不再存在于 maintained repository
  surfaces；
- `release/`、`scripts/` 与 deployable packages 各自只包含约定职责；
- `@unicas/site` 与 `@unicas/spaces` 能使用各自 Wrangler dependency 执行 dry-run；
- SDK API baseline、release manifest、packed examples 和 npm verification 保持有效；
- service、Spaces、site 与 docs 的 plan workflows 保持有效，且没有 production
  side effect；
- Migration SQL content 与 schema behavior 不变；
- package boundary、Agent guidance、workspace、release、build、test 和 typecheck
  validation 全部通过；
- repository diff 不包含产品、schema、公开 contract 或线上资源变化。

未来 cleanup 候选必须重新提供精确证据与范围，不自动扩展本 idea。

# Repository cleanup 盘点

## 快照

- Repository commit：`d81253cdba2a1c6bc49370881e173b7858854329`
- 盘点日期：`2026-10-10`
- 方法：只读检查 tracked 顶层路径、workspace manifest、package scripts、
  workflow、部署配置、测试、文档引用和相关 Git 历史，不修改 repository
  deliverable。

本盘点只对所检查的快照进行分类。它是 Ideal World 的证据，不是对保留资产
永远不会过时的永久判断。

## 目录职责

| 路径 | 当前职责 | Cleanup 含义 |
| --- | --- | --- |
| `packages/` | 16 个 workspace package，包括私有第一方 `spaces` App；package ownership 与依赖方向已有 guard | 不能只因表面重叠就合并、拆分、重命名或删除 |
| `stacks/unicas/` | 本地编排、Cloudflare 部署顺序、产品站点资产和 Spaces 部署组合 | 只有同步更新全部部署与测试消费者后才能调整路径 |
| `scripts/` | 跨 package 的本地开发、Git hook、SDK、release、smoke 与验证工具 | 具有 package、CI、测试或部署消费者的活跃工具不是删除候选 |
| `tests/` | Repository 级架构、release、部署与 retirement guard | 历史名称可能代表刻意保留的负向约束，不等于陈旧代码 |
| `sdk/` | App-user SDK package matrix、确定性 release manifest 和已评审 API baseline | 生成或声明式 release 证据；仅凭可重建性不足以删除 |
| `examples/app-user-sdk/` | Packed artifact 外部消费者验证和公开 quickstart | Release 输入与文档目标，不是重复源码 |
| `docs/` | 已接受的 repository 架构、运维、release 和 workflow 共识 | 公开或运维引用必须检查外部、rollback 与保留风险 |
| `.agents/` | Canonical Agent skills 与 repository reusable instructions | 不进入 provider-specific 或便利性 cleanup |
| `.silvermoon/` | Repository-owned idea contract、证据、ledger 与 lifecycle history | 不进入普通 cleanup 删除 |

## 候选分类

### 应迁移

#### `stacks/unicas/deploy/migrations/tenant/`

- 当前消费者：
  `packages/service-cloudflare/wrangler.toml` 将该目录配置为 `CAS_DB`
  migration source。
- 验证消费者：
  `packages/service-cloudflare/tests/schema.test.ts` 读取
  `0001_baseline.sql`，证明空数据库应用、幂等性和 schema 行为。
- 当前所有权：
  `packages/service-cloudflare/src/schema.ts` 将其描述为 App-scoped Space
  storage schema，并导出 `APP_SPACE_SCHEMA_MIGRATIONS`。
- 历史：
  baseline 仍在活跃维护；最近的 commit 修复了 D1 parser 兼容性并支持当前
  Spaces 行为。
- 结论：
  SQL 是活跃资产，不能删除。`tenant` 目录段是 legacy 命名债务，应原子
  重命名为 `app-space`。

## 保留

### `stacks/unicas/deploy/cut-over-app-space-v1-issuers.mjs`

- Release workflow 与 focused tests 仍引用它。
- 它在 `2026-10-09` 为当前 multi-Space capability grants 更新。
- 它同时编码幂等的 current-state handling 与历史 cutover。
- 结论：活跃部署与恢复入口；保留。

### `docs/managed-issuer-retirement.md`

- 部署 README 与 docs-site completeness tests 仍引用它。
- 它保留 approval、rollback、D1 cleanup 与 key revocation 边界。
- 结论：已接受的运维与 rollback 记录；保留。

### 根 `scripts/*.mjs`

- 已按 basename 核查 14 个 tracked scripts 的 repository 消费者。
- 每个 script 都有 package script、workflow、test、部署入口或 maintained
  module 消费者。
- 该目录混合多类职责，但所有文件都仍活跃。
- 结论：本 idea 中原位保留；未来分组方案需要独立的精确路径计划和收益证据。

### `sdk/` 与 `examples/app-user-sdk/`

- SDK API declarations、package matrix 和 release manifest 被 SDK readiness
  与 release checks 消费。
- Examples 会被复制到干净的 packed-artifact consumer tests，并由当前文档链接。
- 结论：release baseline 与验证输入；保留。

## 排除

### `.silvermoon/ideas/**`

`legacy-repoledger` 等历史名称位于保留的 idea history 中。这些文件是 lifecycle
和审计记录，不是过时源码。

### 冻结的 legacy 环境

`unicas.shazhou.work` 及其 Cloudflare 资源不属于本 cleanup。本盘点中的任何
观察都不授权修改或删除它们。

## 当前删除结果

本快照中没有 inspected tracked file 满足已批准的删除标准。这是预期的
证据驱动结果。Implementation 不得为了让 cleanup 包含文件删除而换入未经证明的
删除项。

## 首批候选

Implementation candidate 仅限：

1. 使用 Git rename 将
   `stacks/unicas/deploy/migrations/tenant/0001_baseline.sql` 移到
   `stacks/unicas/deploy/migrations/app-space/0001_baseline.sql`；
2. 更新 Wrangler migration directory 与 schema test 的读取路径；
3. 证明 SQL 内容不变；
4. 运行现有 schema migration 和最窄相关 repository/package checks；
5. 记录旧目录和 maintained references 已不存在。

本批次不包含 compatibility copy、symlink、新的专用回归 guard、production
migration 或 deployment。

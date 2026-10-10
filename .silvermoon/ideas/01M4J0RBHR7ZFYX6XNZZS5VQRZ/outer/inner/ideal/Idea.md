# 清理 UniCAS repository 并修正首批目录命名债务

## 意图

为 repository cleanup 建立可重复、可审查的分级证据标准，并完成当前快照中唯一
已经证实、可以原子修正的目录结构问题：将仍使用退役 Tenant 术语的 App-scoped
Space 数据库迁移目录改为当前 App/Space 词汇。

本 idea 不以删除数量作为成功指标。当前调查没有发现满足删除门槛的 tracked
文件，因此“本批次不删除文件”是证据驱动的有效结果，而不是未完成状态。

## 背景

UniCAS repository 经历了协议演进、包重命名、部署切换、SDK 发布和 Agent
workflow 建设。文件名或历史年龄不能单独证明资产已经过时；运行时、部署、
公开文档、生成 baseline、fixture、审计记录和 lifecycle history 具有不同的
消费者与保留要求。

当前只读盘点确认：

- `packages/` 表达 workspace package 与实现所有权；
- `stacks/unicas/` 表达本地编排、Cloudflare 部署顺序及部署资产；
- 根 `scripts/` 与 `tests/` 表达跨 package 工具和 repository guard；
- `sdk/` 与 `examples/app-user-sdk/` 是发布验证输入，不是无主的历史副本；
- `.agents/` 与 `.silvermoon/` 分别是 canonical Agent guidance 与 lifecycle
  记录。

盘点没有找到可直接删除的文件，但确认
`stacks/unicas/deploy/migrations/tenant/` 仍使用已经退出当前产品词汇的目录名。
该目录保存 App-scoped Space storage schema，源码已经使用
`APP_SPACE_SCHEMA_MIGRATIONS`，因此本地路径应与当前职责一致。

详细证据与候选分类记录在同世界的
[`RepositoryInventory.md`](./RepositoryInventory.md)。

## 期望结果

- repository 具有分级删除标准，能够区分运行时/部署/公开文档与可重建
  baseline/fixture 的不同证明要求。
- 当前候选清单明确记录每个调查对象的消费者、历史状态、不确定性和
  “删除、迁移、保留或排除”结论。
- `stacks/unicas/deploy/migrations/tenant/0001_baseline.sql` 通过 Git rename
  原子迁移为
  `stacks/unicas/deploy/migrations/app-space/0001_baseline.sql`，SQL 内容、
  文件名和迁移编号保持不变。
- Wrangler `migrations_dir` 与现有 schema migration 测试在同一提交切换到
  `app-space`，repository 内不保留旧目录、兼容副本或符号链接。
- cleanup 不改变 App/Space 行为、公开 API、package exports、数据库 schema、
  Cloudflare binding、线上数据库名称或 ID、表名、部署顺序和生产资源。
- 本批次完成后可以独立验收；未来 cleanup 候选必须基于新的精确证据与范围，
  不自动扩展本 idea。

## 分级删除标准

### 运行时、部署与公开文档资产

只有同时满足以下条件时才可删除：

1. 静态 imports、配置、workspace graph、CI、脚本、测试、文档和发布路径中
   没有消费者；
2. package scripts、exports、workflow、部署配置或人工运维说明中没有声明入口；
3. Git 历史和对应 lifecycle/运维证据证明阶段性职责已经结束；
4. 动态加载、外部调用、rollback、审计和保留风险已经被明确关闭。

任一条件无法证明时，结论必须是保留或继续调查。

### 生成物、baseline 与 fixture

只有同时证明存在权威来源与确定性重建方式、现有消费者已迁移或被替代、相关
验证仍能覆盖原用途，并且该资产不是 review baseline、release evidence 或兼容
契约时才可删除。仅有“可以重新生成”不足以证明可删除。

### lifecycle、审计与政策资产

Silvermoon history、批准与验收证据、许可证、安全政策、审计记录及仍受保留
规则约束的资产不进入普通 cleanup 删除候选。

## 范围

### 范围内

- 维护同世界的 repository 职责地图、证据标准和当前候选分类。
- 原子重命名 App-scoped Space migration 目录：
  `tenant` → `app-space`。
- 更新 `packages/service-cloudflare/wrangler.toml` 的 `migrations_dir`。
- 更新 `packages/service-cloudflare/tests/schema.test.ts` 中读取 baseline migration
  的路径。
- 运行现有 schema migration 测试与最窄相关 repository/package 检查，并记录
  旧目录和旧引用零匹配证据。

### 范围外

- 删除任何当前 tracked 文件；当前没有候选达到分级删除门槛。
- 重组根 `scripts/`，或移动其他活跃 package、SDK、example、test、docs、
  Agent guidance 和 Silvermoon history。
- 新增仅用于禁止旧 migration 路径的永久回归测试；现有配置读取与 schema
  migration 测试继续提供行为证明。
- 重命名 `CAS_DB` binding、线上数据库 `unicas-tenant`、数据库 ID、表名、
  migration 文件名或编号。
- 改变产品功能、业务语义、公开协议、package boundary 或依赖方向。
- 修改或部署冻结的 `unicas.shazhou.work` legacy 环境，执行生产部署、D1
  migration、npm 发布或其他外部副作用。

## 约束

- 在实施前必须先获得对本 Ideal World 精确 revision 的明确批准。
- 涉及 `packages/**` 与 `stacks/unicas/**` 的方案和实施必须遵循 UniCAS package
  boundary、access-plane separation、依赖方向和部署边界。
- 路径切换必须在一个 repository candidate 中完成，不保留双写来源、旧目录、
  compatibility copy 或 symlink。
- migration SQL 内容、迁移顺序与运行时行为必须保持不变；若 rename 之外出现
  schema diff，本 idea 必须返回 preparing 重新评审。
- 不确定性默认保留，不通过降低证据门槛来制造删除项。
- 使用普通 Git rename 和非 force 同步，保留并发工作，不 reset、重写或清理
  未知改动。

## 完成边界

本 idea 在以下结果全部可验证后完成 repository implementation：

- 分级删除标准与当前 inventory 成为已批准 Ideal World 的一部分；
- `tenant` migration 目录原子迁移到 `app-space`，全部已知 repository 引用同步；
- baseline SQL 内容不变，现有 schema migration 行为与相关 repository 检查通过；
- 证据确认旧路径不再存在或被当前维护资产引用；
- 没有生产、发布、资源或公开契约变化。

根 `scripts/` 分组、更多目录重组或未来发现的删除候选不阻塞本 idea，也不得在
未修订 Ideal World 的情况下并入本批次。

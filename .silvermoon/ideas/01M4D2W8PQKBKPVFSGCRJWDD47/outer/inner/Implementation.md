# Implementation

## Steps

### I-S01: 将 App/Space schema 迁移移出运行时

为 `CAS_DB` 建立由 Wrangler 管理的版本化 D1 migration 基线，并让服务部署在
Worker 代码发布前显式应用 migration。移除 Space 数据面、审计 RPC、App usage、
App GC 和定时任务对 `migrateAppSpaceSchema()` 的运行时调用；测试和本地开发在
fixture 或本地 runtime 启动阶段显式初始化 schema。保留迁移函数供测试、恢复和
一次性运维使用，不把 DDL 重新放回请求路径。

### I-S02: 合并 manifest metadata 与 content 读取

扩展现有已授权的 node content 响应，以固定 `X-CAS-Refs` header 返回该不可变
node 的有界有序 refs；content type 和 content length 继续使用标准 HTTP header。
`@unicas/space-client` 在同一个响应上构造既有 `CasNode` 类型，file client 使用
该组合读取加载 manifest。现有 metadata、content endpoint 和响应 body 保持兼容，
不引入缓存，也不改变 capability 权限或撤销时限。

### I-S03: 复用 file-root catalog snapshot

让 session lookup 在同一条 `SPACES_DB` 查询中带回 Principal 的 0/1
`SpaceFileRootInfo` snapshot；数据库的 `principal_id` 唯一约束继续保证最多一个
root。Spaces file service 首次打开 root 时直接使用该 snapshot，不再为同一次
目录读取执行独立的 file-root catalog 网络往返。保留无 snapshot 时的
`catalog.list()` fallback、按 `rootId` 打开的现有调用方式和 mutation revision
冲突保护。

### I-S04: 暴露安全的外层分段计时

在 Spaces Worker 中记录固定名称的 `spaces_session`、`spaces_manifest` 和
`spaces_unicas` Server-Timing；只有使用 catalog fallback 时才记录
`spaces_root`。只吸收 UniCAS 响应中
allowlist 内的 `cas_auth`、`cas_do`、`cas_d1_*`、`cas_r2_*`、`cas_edge` 等
固定计时项。解析器忽略 description、未知名称和非有限时长；响应不得包含
标识符、路径、URL、header 值、SQL 值或内容。

### I-S05: 用 Smart Placement 替代固定 IAD

将 `unicas-spaces` 从固定 `aws:us-east-1` 改为 `mode: smart`，作为无需搬迁
`SPACES_DB` 数据且可直接回滚的第一候选。暂不迁移 `SPACES_DB`，因为数据库搬迁
会引入数据复制、停写和一致性切换风险；Deployment 必须用 APAC 合成 canary
验证实际 placement 和端到端阈值，若 Smart Placement 仍选择不合格路径则不接受
部署，并回滚配置后再评估 APAC D1 迁移。

### I-S06: 锁定兼容性、运维和验证证据

补充协议、可观测性、CAS 运维和部署文档，覆盖组合读取 header、migration
顺序、Smart Placement 假设、SLO、合成探测和回滚。增加路由、client、file
service、Worker timing、deployment plan 与 schema migration 测试，并运行相关
package 测试、typecheck、文档检查和两个 Worker dry-run。

## Acceptance criteria

### I-AC01: 普通 Space 请求不执行 schema migration

Space 数据面请求、审计 RPC、App usage、App GC 和定时维护均不调用
`migrateAppSpaceSchema()`；部署计划在 Worker 发布前应用 `CAS_DB` migration。
通过 Worker 单元测试、deployment plan 测试和 migration 在空 D1 上的 schema
测试证明。

### I-AC02: 目录读取只有一个 root lookup 和一个 manifest 边界

一次 authenticated directory read 只用一条 `SPACES_DB` query 完成 session
验证和 0/1 root snapshot 读取；`SpacesFileService.list()` 直接把 snapshot
传给 `openRoot()`，不再调用 `listRoots()`。manifest 加载只调用一次
`readNode()`，该调用只发出一个 content HTTP 请求。通过 repository snapshot、
file-service call-count 和 client 路由测试证明。

### I-AC03: 授权、隔离和 API 兼容性保持不变

组合读取仍使用 `cas:nodes:read`、相同 App/Space actor key 和同一 DO 数据读取；
metadata/content 旧调用继续工作，`/api/entries` JSON、错误映射、CSRF、Root Ref
和不可变内容语义不变。通过 protocol、service、service-cloudflare、space-client、
space-file-client 和 spaces 的相关测试证明。

### I-AC04: Server-Timing 有界且不泄露数据

经过认证的 `/api/entries` 响应包含外层 session/manifest/UniCAS 边界以及
allowlist 内的下游计时；只有 catalog fallback 才出现 `spaces_root`。未知名称、
description、负数、非有限值和动态值不会进入响应。新服务的正常 Space 响应不再
出现 `cas_schema`。通过 timing 与 Worker 单元测试证明。

### I-AC05: 固定 IAD placement 已被可回滚候选替代

Spaces Wrangler 配置为 Smart Placement，配置测试锁定该值；部署文档明确 APAC
canary 门禁、失败回滚到已知配置，以及只有实测不达标后才进入 D1 搬迁设计。
实现验收不声称已经满足生产延迟 SLO，生产 p50/p95/p99/max 由 Deployment 世界
验证。

### I-AC06: 候选通过窄测试和发布前检查

所有直接相关测试和 package typecheck 通过，`pnpm docs:check`、
`pnpm deploy:plan`、`pnpm deploy:spaces:plan` 以及 Silvermoon worktree/staged
检查通过；命令与结果记录在 ledger，失败不得以跳过测试或放宽语义处理。

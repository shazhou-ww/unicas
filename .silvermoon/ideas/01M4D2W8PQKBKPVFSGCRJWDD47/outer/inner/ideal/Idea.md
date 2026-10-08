# 消除 Spaces 目录读取的跨区域延迟

## 意图

让经过认证的 `GET https://spaces.unicas.work/api/entries` 在主要 APAC
访问区域内稳定满足可感知的交互延迟目标，同时保留 UniCAS 的授权、数据隔离、
不可变内容和故障关闭语义。消除会把冷启动或并发突发放大到多秒的跨区域热路径，
并让一次合成请求的主要耗时可以通过安全、受限的信号解释。

## 背景

2026-10-08 的生产调研发现，目录读取活跃分钟内的
`unicas-spaces` Worker wall p95 为 9.52 至 11.12 秒，而 CPU p95 只有
15 至 26.6 毫秒；同一分钟下游 `unicas` Worker wall p95 为 8.69 至
9.49 秒，Durable Object p95 只有 0.21 至 0.95 秒。证据指向 I/O 和协调
等待，而不是 Worker 计算或单条 SQL 执行。

当前 `unicas-spaces` 动态路由固定在 `aws:us-east-1`，其 `SPACES_DB`
主区域为 ENAM；下游 `unicas-control` 和 `unicas-tenant` 主区域则为
APAC，且三者均未启用 read replication。来自 APAC 的浏览器请求因此先远程
放置到 IAD，再由 IAD 的 `unicas` 执行位置访问 APAC control/tenant D1。
未认证长连接请求仅经过外层 Worker 也需要约 370 至 495 毫秒，证明固定远程
放置本身已经形成明显延迟底线。

每个 CAS 数据面请求在正常路由前还会执行整套幂等 schema 初始化。一小时内
tenant D1 记录到 569 次 schema 相关语句，数据库引擎执行时间合计仅 85
毫秒；同期 30 次 node read 的数据库执行时间合计仅 4.65 毫秒。大量串行
D1 binding 往返，而不是 SQL 引擎，是跨区域延迟的主要放大器。一次直接 APAC
合成 CAS 冷请求的 `cas_schema` 为 366 毫秒，同连接热请求为 0 毫秒，说明
isolate 内缓存不能解决冷 isolate 或并发突发。

目录读取路径还会重复读取 file root catalog，并依次发起 manifest metadata
和 content 两个 CAS 请求；每个 CAS 请求都重复 schema 检查、capability
验证和 Durable Object 调度。生产 `unicas` 与 `unicas-spaces` 自
2026-09-22 后没有新部署，因此没有近期部署回归证据；这是低流量真实路径暴露
出的结构性问题。

## 期望结果

- 从 APAC 合成访问点执行经过认证的目录读取时，端到端 TTFB p95 不高于
  1 秒，Worker response-construction wall p95 不高于 500 毫秒，冷态合成
  请求不超过 2 秒。证明使用至少 30 次有界、无真实客户数据的合成调用，并同时
  报告 p50、p95、p99 和最大值。
- 普通目录读取不执行 `CREATE`、`ALTER`、`DROP`、schema `PRAGMA` 或其他
  migration 工作。生产 schema 变更通过显式、可审计、可回滚的部署步骤完成；
  运行时若仍需兼容性门禁，只允许有界的轻量版本检查。
- 已选择并记录 Spaces Worker、Spaces D1、control/tenant D1、Durable
  Object 和 R2 的目标区域拓扑。该拓扑以实际合成数据证明不会为了靠近一个
  backend 而把更多串行 backend 往返置于跨洲路径。
- 一次目录读取至多执行一次 session lookup、一次 file-root lookup 和一次
  manifest 读取边界；不再重复查询同一 root catalog，也不再为同一不可变
  manifest 顺序承担两次完整 capability 验证和 Durable Object 调度。
- 外层 `/api/entries` 返回或关联安全、固定名称的分段计时，能够区分外层
  session/root 工作与下游 schema、authorization、Durable Object、D1 和
  R2 工作。信号不得包含 URL、header、token、App/Space/Principal ID、
  object key、SQL 值、文件路径或内容。
- 登录、授权、CSRF、App/Space 隔离、manifest 校验、不可变内容、Root Ref
  生命周期、错误映射和现有 API 响应形状保持兼容；任何缓存都不得延长授权撤销
  时限或返回跨 Principal/Space 数据。
- 运维文档说明性能 SLO、合成探测、区域假设、migration 操作、发布门禁和
  回滚方式。部署验证能够区分 CPU、Worker wall time、最终 TTFB 和完整响应
  传输时间。

## 范围

### 范围内

- `unicas-spaces` 的 placement 决策及其与三个生产 D1 主区域、Durable
  Object 和 R2 的交互。
- App/Space schema migration 生命周期，以及从请求热路径移除 DDL 的安全
  迁移机制。
- `/api/entries` 的 session、file-root、manifest metadata/content 和
  capability/DO 调用边界。
- 仅以不可变 hash 和完整授权边界为基础的有界缓存或合并读取方案。
- 安全 `Server-Timing`、Worker/D1/DO 指标和合成 canary 证据。
- 直接相关的测试、部署 dry-run、运维文档、回滚和发布验证。

### 范围外

- 新增用户可见的文件管理功能或重做 Spaces UI。
- 为一般管理面、MCP、OAuth 或无关 App 数据面做全面性能重构。
- 未经单独架构、安全、保留期和成本审查而启用 Cloudflare automatic tracing、
  invocation logs 或非零生产 manual trace sampling。
- 修改或部署冻结的 `unicas.shazhou.work` 旧环境。
- 未被本路径证据要求的通用数据库、协议或存储迁移。

## 约束

- 生产调查、合成验证和持久证据只使用合成标识与内容；不得把凭据、token、
  私钥、客户 ID、文件路径、对象 key、SQL binding 或原始遥测 payload 写入
  idea、日志、文档或提交。
- Cloudflare automatic tracing 保持关闭，生产 manual trace sample 保持
  0，除非另一个明确审查批准了具体 destination、访问、保留、删除、驻留、
  成本、事件响应和采样率。
- placement 或 D1 区域变更必须先通过隔离 canary 对照，不得仅依据 broad
  region 标签推断最终延迟。必须同时衡量当前 IAD、候选 Smart Placement 或
  APAC 路径的 authenticated wall time。
- schema migration 必须兼容当前生产数据，可重复执行，并具有失败恢复与回滚
  说明；正常部署仍使用 dry-run/受保护生产发布，不得绕过现有发布门禁。
- 解决方案必须遵守 package ownership 与 access-plane 方向，不得让
  Cloudflare runtime 细节泄漏到 cloud-neutral 业务包。
- 优化不得用宽泛 catch、静默降级、成功形状 fallback 或放宽授权来掩盖失败。

## 待解决问题

- 热路径 DDL 移除后，长期区域拓扑应迁移 `SPACES_DB` 到 APAC、选择经过验证
  的 Smart Placement，还是保留分区并采用其他一致性明确的读取方案？
- manifest 单次读取应由新的组合数据面操作提供，还是由 Spaces Worker 对
  不可变 hash 做严格作用域缓存？Implementation 必须比较协议影响、缓存失效、
  授权撤销和部署兼容性后选择一种。
- APAC 合成测量应固定在哪些 Cloudflare colo/外部探测位置，才能稳定代表主要
  用户而不把探测网络噪声误归因于 Worker wall time？

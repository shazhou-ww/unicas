# 从 Root Ref 协议与数据模型移除 refDomain

## 意图

让 Root Ref 权限、状态、幂等和审计直接以 App 与 Space 为边界，彻底删除
`refDomain` 这一额外命名维度。每个 App 只有一条跨 Space 的 Root Ref 审计
revision 流，业务方不再创建、签发、传递、选择或管理 domain。

## 背景

Root Ref 的权威 retention 状态已经是 `(appId, spaceId, hash)` 上的 aggregate
root count；GC、节点就绪检查和引用安全都不读取 domain projection。
`refDomain` 当前只承担业务审计归属、独立 revision 流和 request idempotency
隔离，却横跨 capability claim、授权上下文、service forwarding、D1 schema、
admin audit API、CLI、MCP、SDK 文档和 issuer。

这种横切概念要求 Root Ref capability 额外携带 token-global claim。一个 App
存在多个 domain 时需要分别签发 token，而一个 token 又不能为不同 grant 表达
不同 domain。它增加了 App-level multi-Space client 的 token 选择复杂度，也让
业务调用方理解一个不参与数据所有权或 GC 正确性的内部审计维度。

新模型选择一个更直接的边界：

- Space 继续拥有节点与 aggregate Root Ref 状态；
- App 继续是授权与审计主体；
- `cas:root-refs:read` 和 `cas:root-refs:update` permission 直接授权所选 Space
  的对应操作；
- 每个 App 使用一条跨 Space 的审计 revision 流；
- request idempotency 以 `(appId, spaceId, requestId)` 隔离。

## 期望结果

- capability 的公开 claim schema、类型、OpenAPI 说明、issuer 示例和验证逻辑中
  不再存在 `refDomain`。Root Ref 操作只要求匹配 App、Space selector 和精确
  operation permission。
- App-user HTTP 与 TypeScript API 不接收、返回或暗示 domain。Root Ref list
  结果只表达目标 Space 的 revision-stable projection 和 items；Root Ref update
  继续使用调用方提供的 `requestId` 与原子 delta。
- 服务端授权上下文、内部 header、actor/DO 调用、repository port 和错误消息
  不再携带 domain。调用方不能通过遗留 query、body 或 header 重新引入该维度。
- 权威 aggregate root count 仍按 `(appId, spaceId, hash)` 保存和验证，节点保护、
  lease、child references、GC 与内容地址语义保持不变。
- Root Ref projection 收敛为 `(appId, spaceId, hash)`；每个 App 只有一个单调递增
  audit revision，事件继续记录受影响的 `spaceId`、`requestId`、payload hash、
  canonical changes 和时间。
- request idempotency 以 `(appId, spaceId, requestId)` 为键。同一键与相同 payload
  重放返回原 revision，不同 payload 稳定冲突；不同 Space 可以安全复用同一
  request ID。
- control-plane audit API、Admin Web UI、CLI 与 MCP 直接按 App 查询 Root Ref
  projection 和 events。删除 domain discovery 与 domain path 参数，不用固定
  default domain 或隐藏 sentinel 模拟旧模型。
- 迁移在切换写入前证明每个 Space 的 domain projections 总和与权威 aggregate
  root count 一致。新 projection 以权威 aggregate 状态为基线，不因历史审计漂移
  改写 retention 状态。
- 旧的 per-domain revision 流没有可证明的跨 domain 总顺序，因此迁移不得伪造
  一条合并历史。切换点以前的 ledger 作为只读 migration archive 保留到明确的
  运维保留期限；新 App-global revision 流从有记录的 cutover checkpoint 开始，
  所有新事件只使用无 domain schema。
- rollout 期间，新服务可以容忍 capability version 2 token 中多余的遗留
  `refDomain` claim，但必须忽略它，且不能据此改变授权、审计或幂等行为。全部
  issuer 停止签发该 claim 后移除兼容测试与遗留存储；最终公开模型中不存在
  domain、default domain 或等价别名。
- 文档、API baseline、changelog、迁移指南、packed consumers 和第一方 Spaces
  App 对新边界保持一致，并明确这是授权与 audit contract 的破坏性变化。

## 范围

### 范围内

- 从 `@unicas/space-protocol` 的 capability claims、operation policy required
  claims、公开类型、schemas、OpenAPI 和测试移除 `refDomain`。
- 更新 App/Space capability verifier、service actor、Cloudflare worker/DO 与
  repository ports，使 Root Ref read/update 仅依赖 permission 和目标 Space。
- 设计并执行 D1 schema 与数据迁移，建立 App-global revision、Space projection、
  App+Space idempotency 和无 domain event 表。
- 替换 Root Ref admin audit routes、BFF adapters、Web UI、CLI 和 MCP catalog，
  删除 domain list/discovery 与 domain-specific reads。
- 更新 capability issuer、SDK、quickstart、examples、文档站、architecture、
  operations、security guidance、API artifacts 和 release notes。
- 为 mixed-version rollout、旧 token 容忍、projection reconciliation、
  idempotent replay、revision contention、跨 Space event ordering、audit reads、
  rollback 与 archive retirement 添加验证。
- 在部署契约中定义生产迁移顺序、观察窗口、回滚边界、archive 保留期限和最终
  cleanup 证据。

### 范围外

- 改变 App 作为授权主体、Space 作为数据所有权边界或 capability selector/grant
  语义。
- 改变 CAS node、lease、Root Ref delta、child reference、blob、file 或 GC 的
  业务语义。
- 把 Root Ref audit ledger 变成内容历史、归档存储或精确 App-global 物理提交
  顺序。
- 从 capability 中移除 Root Ref operation permissions，或让普通 node permission
  隐式获得 Root Ref authority。
- 为旧 per-domain 事件推导一个不存在的全序，或长期暴露 legacy domain API。
- 在未经 Deployment gate 的情况下迁移生产数据、发布 npm 包或修改冻结的
  `unicas.shazhou.work` 环境。

## 约束

- migration 前后任何 Space 的 aggregate root count 必须逐项一致；不得因 domain
  projection 差异增加、释放或删除业务 root。
- cutover 必须保持 Root Ref update 原子性、非负 aggregate 检查、ready-node
  检查和 uncertain-response replay 安全。
- App-global revision 分配必须在线性化冲突下重试且单调无重复；它只为 audit
  ordering 服务，不得进入 GC correctness path。
- 新 idempotency 键固定为 `(appId, spaceId, requestId)`。迁移必须检测不同 legacy
  domain 在同一 App+Space 复用 request ID 的冲突，并以显式、可审计策略解决，
  不能静默覆盖。
- capability version 2 的遗留 claim 容忍只能作为有期限的 rollout bridge。
  新 issuer、公开类型与文档不得继续生成或依赖它，也不得引入 `_default` 等替代
  名称保留同一概念。
- admin audit contract 的破坏性变化必须遵循版本、迁移、API baseline 和 first-party
  consumer 验证要求。旧 endpoint 的 retirement 必须有可观察使用证据。
- legacy archive 不能参与新写入、projection、授权或 GC。其访问与最终删除遵循
  明确的数据保留和审计政策。
- migration、日志、错误、telemetry 和测试 fixture 不得暴露 bearer token、
  私有 customer 数据或完整 capability payload。
- idea-specific 迁移设计与证据保留在本 idea；只有被接受的稳定共识才进入
  `docs/`。

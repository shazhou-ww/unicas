# 从 Root Ref 协议与数据模型移除 refDomain

## 问题

`refDomain` 不参与节点所有权或 GC 正确性，却横跨 capability、审计、幂等、
存储和客户端，使一个 App 的跨 Space 调用需要额外选择 token 与审计命名域。

## 期望结果

Root Ref 直接以 App 为授权和审计主体、Space 为数据边界。每个 App 使用一条
跨 Space 的审计 revision 流，业务调用方不再创建、签发、传递或管理 domain。

## 边界

- 移除协议、授权上下文、存储、管理 API、WebUI、CLI、MCP、SDK、issuer 和
  第一方 Spaces App 中的 domain 维度；不使用 default domain 或隐藏别名替代。
- 保持 aggregate root count、精确 operation permission、Space selector、
  原子 delta、节点就绪校验、lease、child references 和 GC 语义不变。
- 作为破坏性变更提供迁移、短期旧 token 容忍和可回滚边界；不伪造旧审计全序，
  不在本次构想验收中授权生产迁移、npm 发布或修改冻结的旧环境。

## Acceptance criteria

- 最终公开协议与调用链不再依赖 `refDomain`，Root Ref read/update 仅按匹配的
  App、Space selector 和精确 permission 授权，管理侧按 App 查询审计。
- projection 以 `(appId, spaceId, hash)` 标识；新事件使用 App-global revision；
  幂等以 `(appId, spaceId, requestId)` 隔离，同 payload 重放原结果、异 payload
  冲突，不同 Space 可复用 request ID。
- 迁移逐项保持权威 aggregate 状态，显式处理旧 request ID 冲突；旧 ledger
  只读归档，新流有明确 cutover checkpoint，兼容与归档均有退出条件。

业务模型、生命周期与迁移边界见 [模型评审](./Model-review.md)。

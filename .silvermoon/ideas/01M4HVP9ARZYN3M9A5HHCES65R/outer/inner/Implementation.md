# Implementation

## Steps

### I-S01: 确定迁移与一致性方案

以现有权威 aggregate 和旧 ledger 为依据，确定 App-global revision、
Space projection、幂等冲突处置、旧请求重放桥接、分页稳定性和原子性方案；
准备可重复的迁移、漂移检测及回滚边界测试。

### I-S02: 贯通无 domain 的契约与调用链

统一更新数据面协议、授权、内核、持久层及管理面 API、WebUI、CLI、MCP，
同步 issuer、SDK、第一方 Spaces App、API baseline、文档和破坏性变更说明。
管理面与数据面边界保持不变。

### I-S03: 验证迁移与混合版本行为

执行相关包测试、类型与契约检查、packed consumer 验证及迁移演练，
覆盖竞争、跨 Space 排序、失败重放、历史归档和有期限的旧 token 容忍。

## Acceptance criteria

### I-AC01: 契约与消费者一致

公开 API 与调用链不依赖 domain，精确权限与 Space 隔离不退化；
以协议、授权、管理入口和消费者测试及 API 差异检查证明。

### I-AC02: 数据与重放安全

迁移前后 aggregate 逐项一致，幂等冲突显式处理，原子更新、跨 Space
requestId 复用和 App-global revision 竞争行为正确；以迁移 fixture、
故障注入及并发测试证明，不伪造旧流全序。

### I-AC03: 发布候选可验证

相关构建、类型检查、包测试与 packed consumer 检查通过，
兼容退出与回滚限制有可执行证据；精确命令和结果在本阶段辅助材料中记录。

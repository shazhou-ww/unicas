# Implementation

## Steps

### I-S01: 实现 App-level capability transport

在 `@unicas/space-client` 中以 `AppCasClient` 和 `createAppCasClient` 替代
Space-level factory。所有 CAS 方法把 `spaceId` 作为第一个参数，并复用现有
App/Space v1 routes、错误、取消和 cache 语义。

实现 provider metadata 校验、selector/permission 匹配、content/root-refs/
management 三个固定内部 credential class、同 class singleflight acquisition、
过期替换、Root Ref domain pinning 和服务端拒绝后的受控失效。只允许 Ideal
列出的无副作用操作在 `401 invalid_token` 后刷新并重试一次。

### I-S02: 迁移高层 SDK 与 cache 组合

将 `@unicas/space-blob-client` 的 factory、node-content helpers 和 escape hatch
改为接收 `AppCasClient + spaceId`；将 `@unicas/space-file-client` options 改为
共享 client 与显式 Space。保持 blob tree、file manifest、Root Ref retain/release、
upload、取消和 browser cache 的 App/Space 隔离。

### I-S03: 迁移第一方消费者与测试替身

迁移 `@unicas/spaces` capability adapter、file service、SDK examples、Node/browser
packed consumers 和测试 doubles。第一方 provider 从已知签发 claims 生成非权威
metadata，并拒绝超出 principal Space/access 的 requirement，不解析已签 JWT
来替代服务端授权。

### I-S04: 更新公开文档与迁移说明

更新 package README、package inventory、docs site quickstart/reference/architecture、
示例、changelog、版本说明和 troubleshooting 相关内容。新增从
`createSpaceCasClient`/`getToken` 到 `createAppCasClient`/provider 的可执行迁移
说明，并明确 `refDomain` 不进入业务方法签名。

### I-S05: 生成 0.2.0 release artifacts

把六个 App-user SDK packages 统一提升到 `0.2.0`，更新 release matrix、版本测试、
API baseline、release manifest、snippet fixtures 和 packed artifact metadata。
移除 `SpaceCasClient`、`SpaceCasClientConfig` 与 `createSpaceCasClient` 的公开导出，
不保留未批准的兼容别名或 deep import。

### I-S06: 验证并记录 implementation evidence

运行核心 client、高层 SDK、Spaces consumer 的聚焦测试与类型检查，再运行 docs、
repository、release 和 deterministic packed-consumer 验证。将精确命令、结果与
关键行为证据记录在同世界 `ImplementationEvidence.md`，并只在证据有效时勾选
ledger。

## Acceptance criteria

### I-AC01: 单一 App client 直接访问多个 Space

公开 declaration 只提供 `AppCasClient`/`createAppCasClient`，每个 CAS 方法以
`spaceId` 为第一参数；一个实例连续访问私有精确 Space 与 `/shared/**` Space。
通过 API baseline、functional tests 和 packed Node/browser consumer 证明，
并证明旧 Space client exports 不存在。

### I-AC02: Capability 生命周期安全且可诊断

测试证明同一 grant 同时匹配 selector 与 permission、metadata 与时间窗口验证、
固定 credential class、并发 acquisition 合并、token 原子替换、Root Ref domain
pinning、scope miss/provider failure 的稳定错误，以及仅允许的
`401 invalid_token` 单次安全重试。测试同时证明 `403` 和写操作不会自动重放。

### I-AC03: 高层 workflow 保持 Space 隔离

blob/file/client/cache 测试证明共享 App client 时，node、blob、file manifest、
Root Ref 与 cache key 仍绑定显式 Space；相同 hash、共享 token 或 selector 前缀
不能产生跨 Space cache 命中或 workflow 混用。

### I-AC04: 第一方与文档 surface 完整迁移

repository 搜索、类型检查、docs/snippet 验证和 Spaces tests 证明第一方源码、
示例、README、docs 与 packed fixtures 不再调用或宣传旧 Space client，并提供
可执行 provider migration。

### I-AC05: 0.2.0 候选可重复构建

六个 package manifests、matrix、API manifest 与 release manifest 一致标识
`0.2.0`。`pnpm sdk:prepare` 生成的声明和 packed artifacts 可由
`pnpm check:sdk-release` 重复验证，repository checks、docs checks、build、
typecheck 与目标 package tests 全部通过。

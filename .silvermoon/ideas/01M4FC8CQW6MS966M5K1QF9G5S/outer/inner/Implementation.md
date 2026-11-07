# Implementation

本 Implementation 实现已批准的理想世界 revision
`32dc300bbb417e39ee3648062feea5b0c9771151`。变化属于对既有 App/Space v1
wire 行为的兼容性契约补全：不增加 route、authority、存储语义或外部写入，
不修改已发布 `0.1.1`，也不授权 npm publish 或 production deployment。

## Steps

### I-S01: 建立单一权威契约与兼容性边界

由 `@unicas/space-protocol` 继续拥有 HTTP operation、capability claim schema、
operation permission policy、稳定公开 error code 与 OpenAPI 生成输入。保持
`[space-client] -> space-protocol` 和 `service -> space-protocol` 的依赖方向；
在 `ContractAlignment.md` 记录 wire 稳定项、实现诊断项以及 SemVer/migration
结论。

### I-S02: 补齐二进制与 byte range 表达

在 TypeScript `readContent` operation 中表达可选 `Range` header、`200`/`206`
二进制 body 和成功响应 header，并由相同生成链补入 `416 INVALID_REQUEST` 与
`Content-Range`。保持 client 的 `{ offset, length? }` 输入、零长度短路以及
runtime 的 bounded、open-ended、suffix range 行为不变。

### I-S03: 机器化 capability 与 operation authority

把 capability v1 claim schema 和七个公开 operation 的 exact permission /
required claim policy 固定为 protocol-owned machine-readable source。service
授权器消费同一 policy；OpenAPI 使用 vendor extension 表达这些 JWT claim
约束，不把 permission 伪装为 OAuth scope，也不改变 issuer-derived App、
signed `spaceId` 或 `refDomain` 检查。

### I-S04: 对齐稳定 validation 与 error code

将公开稳定的 authorization、node、upload admission 和 Root Ref error code
写入 TypeScript/OpenAPI 权威元数据，并在 HTTP 文档中区分 normative wire
结果与仅供实现诊断的内部细节。保留现有状态码、错误码、Root Ref
canonicalization/bounds 和 lease-driven upload 行为。

### I-S05: 增加跨 surface drift 防护并验证候选

增加 focused protocol、client、service、OpenAPI 和文档测试，使 contract、
生成 artifact、runtime policy 或文档矩阵单独漂移时失败。重新生成 OpenAPI，
运行相关 package typecheck/test、repository drift check 与 Silvermoon candidate
校验，并把命令和结果记录到 `ContractAlignment.md` 与 ledger。

## Acceptance criteria

### I-AC01: readContent contract 完整且 wire 兼容

生成 OpenAPI 的 `readContent` 必须包含 canonical binary media type、可选
`Range`、`200`/`206`/`416`、`Accept-Ranges`、`Content-Length`、`Content-Type`、
`X-CAS-Refs` 和相应 `Content-Range`；protocol、client 和 runtime focused tests
证明现有 full/ranged/unsatisfiable 行为未改变。

### I-AC02: capability policy 只有一个权威来源

OpenAPI 的 claim schema 与每个 operation vendor extension 必须由
protocol-owned schema/policy 生成，service 的授权选择直接消费相同 policy。
测试证明七个 operation 的 exact permission、Root Ref `refDomain` 要求和空
OAuth scope 数组一致。

### I-AC03: 稳定 validation 与 error 边界可审查

权威 HTTP 文档和 machine-readable contract 必须列出调用者可依赖的稳定
error code 与约束，并明确 upload transport/internal storage diagnostics 不属于
App/Space HTTP contract。Root Ref 重复键、数量、delta、overflow、readiness 和
idempotency 行为必须继续由现有 runtime tests 证明。

### I-AC04: 自动 drift checks 覆盖全部表示

受版本控制的 OpenAPI 必须与生成器逐字等价；focused tests 必须检查 binary /
range response、capability claims、operation permissions、error catalog、client
Range header 和 runtime `416`。任一权威 source 或生成 artifact 单独改变都会使
至少一个 repository check 失败。

### I-AC05: 候选保持 package boundary 与发布边界

验证必须证明 protocol 不依赖 client/server，client 仍是薄 HTTP wrapper，
service/runtime 不进入 protocol。结论必须记录为兼容性 contract correction，
无需 consumer migration；候选不得发布 npm、修改 dist-tag 或执行 production
deployment。

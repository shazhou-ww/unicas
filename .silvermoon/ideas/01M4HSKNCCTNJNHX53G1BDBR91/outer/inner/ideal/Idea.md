# 让 App-level client 原生管理多 Space capability

## 意图

让一个 App 用户会话通过同一个 App-level client 频繁访问私有与共享 Space，
由 SDK 统一管理 capability 的匹配、复用和刷新。调用方只选择业务上要访问的
Space，不再维护 Space client、access token 与权限 profile 之间的对应关系。

## 背景

App-user API 已采用 capability version 2：一个短期 token 可以通过多个 grant
同时授权精确 Space 和共享 Space selector，并为不同 selector 绑定不同权限。
典型用户会同时拥有一个可写的私有 Space，并频繁读取所有用户可见的
`/shared/**` Space；一个 token 可以自然表达这组权限。

当前 `@unicas/space-client` 仍以 `appId + spaceId` 创建一个
`SpaceCasClient`，并通过无请求上下文的 `getToken()` 获取 bearer token。
这个接口把 client 生命周期固定在单个 Space，却允许 token 覆盖多个 Space。
当调用方需要频繁跨 Space，或需要区分普通读写、Root Ref 与管理权限时，
它必须自行创建和保存多个 client，并决定每个 client 应当使用、刷新或替换
哪个 token。这样会把 capability selector、permission、有效期与
`refDomain` 的组合复杂度暴露给每个 SDK 使用者。

将 token 退回为单一 Space 可以重新对齐现有 client，但会让高频跨 Space
访问承担更多 token 获取、刷新和切换成本，也无法充分利用
“私有精确 grant + 共享前缀只读 grant”这一已接受的授权模型。因此本 idea
选择让公开 client 与 App 用户会话对齐，同时继续把每次数据操作限制在一个
明确 Space。

## 期望结果

- App-user SDK 提供一个以 App 用户会话为生命周期的 `AppCasClient`。它直接替代
  `SpaceCasClient`，持有统一的 capability provider、短期 token 状态、并发刷新
  协调和共享缓存，并能连续访问调用方指定的多个 Space。
- 每个 CAS 操作都以 `spaceId` 为第一个参数，例如
  `client.readNode(spaceId, hash)`。公开 API 不提供 `forSpace`、scoped view 或
  authorization profile；调用位置始终明确目标 Space。
- 每项操作在发出请求前都形成明确的 capability requirement，至少包含
  `appId`、`spaceId` 和 operation permission。SDK 使用完整 requirement 选择
  或请求 capability，而不是只按 Space 建立 token 映射。
- 常规用户会话只使用 SDK 根据 operation permission 推导的固定内部 credential
  class，每个 class 至多维护一个当前 token；这些 class 不进入公开 API。
  一个 token 可以同时包含私有 Space 的精确 grant 和共享 Space 的前缀 grant；
  正常刷新以新 token 替换旧 token，不把历史 token 累积成任意 token 池。
- 调用方不传递或选择 `refDomain`。在该服务端概念被独立 idea
  `remove-root-ref-domain` 移除前，provider metadata 与 SDK 内部 Root Ref
  credential class 负责保持 domain 一致；不能把它重新暴露为业务操作参数。
- 当前 token 不能满足 requirement 时，SDK 通过 provider 获取匹配能力或返回
  稳定、可诊断的失败，不通过随机试 token、拼接多个 grant 或静默放宽权限
  继续请求。
- 服务端仍是唯一授权边界。客户端对 token metadata 的解析、匹配和缓存只用于
  选择凭据、刷新时机和改进错误体验；任何本地判断都不能替代签名、issuer、
  audience、App、Space、permission 与 `refDomain` 的服务端校验。
- 节点与上层 blob/file 缓存继续以至少 `appId + spaceId + hash` 隔离。
  App-level client 不得让相同 hash、共享 token 或 selector 前缀绕过 Space
  缓存边界。
- `SpaceCasClient` 与 `createSpaceCasClient` 由 App-level surface 替代。
  blob/file 等天然绑定单一 Space 的高层 workflow 接收同一个 `AppCasClient`
  加显式 `spaceId`，但不创建或拥有 Space-level 认证 client。公开类型、示例、
  API artifact、版本说明和第一方消费者对最终模型保持一致。
- SDK 文档以私有可写 Space 与 `/shared/**` 只读 Space 为代表场景，证明一个
  App client 可以在不向调用方暴露 token-to-Space 管理的情况下安全切换 Space。

## 范围

### 范围内

- 定义直接接收 `spaceId` 的 App-level client、capability requirement 和 token
  provider 的公开职责与类型边界，不增加公开 scoped view 或 profile。
- 实现 selector、operation permission、有效期和内部 Root Ref domain 一致性
  感知的 token 选择、替换、并发刷新协调与显式失败行为。
- 将当前 Space client 的 HTTP transport 能力收敛到 App client，保持 App/Space
  v1 route 与服务端授权语义。
- 让 node、blob、file 与 browser cache 层能够复用一个 App client 的认证状态，
  同时保持既有 Space 隔离、取消、错误和资源生命周期语义。
- 为私有与共享 Space、不同权限、过期刷新、并发请求、scope miss、隐藏的
  Root Ref domain 一致性、缓存隔离和服务端拒绝添加聚焦测试。
- 更新 SDK README、文档站、quickstart、TypeScript API reference、迁移说明、
  changelog、API baseline、打包 consumer 与第一方 Spaces App 使用方式。
- 在下一次 pre-1.0 minor 中移除 `SpaceCasClient` 与
  `createSpaceCasClient`，更新全部上层 SDK 和 first-party consumers，并提供
  可执行迁移证据。

### 范围外

- 从 capability selector 枚举、发现或持久化实际 Space。Space catalog、分享关系
  和业务导航仍由 App 的业务层提供；授权凭据不是资源发现 API。
- 改变 App 管理员、control plane、OAuth consent 或外部 issuer 的所有权边界。
- 在 SDK 中保存 refresh token、access token 或用户数据到默认持久化存储；
  跨页面、跨进程和离线 token vault 不属于本 idea。
- 自动合并多个 token 的 grant 来满足一次请求，自动扩大权限，或在服务端
  `403` 后盲目遍历 token 并重放有副作用的操作。
- 为了 App-level client 改变 CAS 节点、Root Ref、blob、file 或垃圾回收的业务
  语义。
- 在本 idea 中修改或删除服务端 token-global `refDomain` 协议、存储与审计
  模型；该工作由独立 idea `remove-root-ref-domain`
  (`01M4HVP9ARZYN3M9A5HHCES65R`) 管理。
- 隐式部署生产环境、发布 npm 包或修改冻结的 `unicas.shazhou.work` 环境。

## 约束

- 保留 App 作为授权主体边界、Space 作为每次资源访问边界、token 作为短期
  immutable capability bundle。App-level client 不代表 App-wide unrestricted
  authority。
- 一次请求必须由同一个已选择 token 中的一个 grant 同时满足 selector 和
  permission；不得跨 grant 或跨 token 拼接授权。
- provider 必须有明确的 token 替换与刷新契约。相同内部 credential class 的
  并发刷新要合并，过期、撤销、scope miss 和 provider 失败要保留稳定且可诊断
  的错误，不得回退到成功形状或旧权限。
- capability 和刷新材料默认只保存在内存中，不进入业务缓存、日志、异常文本、
  telemetry、持久化示例或测试 fixture。
- `refDomain` 在当前服务端协议中属于整个 token，但不得出现在 App client 操作
  签名中。SDK 将首次有效 Root Ref capability 的 domain 固定到内部 Root Ref
  credential class，后续刷新若改变 domain 必须显式失败；普通节点操作不得因此
  获得 Root Ref 或 GC 权限。
- 保持现有 package dependency 方向和浏览器/Node 兼容矩阵。OAuth 登录与 token
  endpoint 的具体传输可以继续由 provider 适配，但 capability requirement、
  token 生命周期和 Space 选择体验必须由 SDK 统一。
- 保持 query-scoped `appId + spaceId` route、capability version 2、最多 32 个
  grant 及现有 selector 语义，除非 Ideal World 经显式修订并重新批准。
- 移除 Space-level client 是明确的 pre-1.0 breaking change，必须进入统一 minor
  版本判断、API baseline、迁移文档和 packed consumer 验证；不能只修改源码类型
  而遗漏发布 artifact 或第一方消费者。
- idea-specific 设计、计划和证据保留在本 idea；只有被接受的稳定共识才进入
  `docs/`。

## 已确定的 API 方向

公开类型、provider 契约、刷新并发、重试边界和兼容策略由同世界的
[API 设计](./ApiDesign.md)定义：

- `AppCasClient` 直接公开全部 CAS 操作，每个方法以 `spaceId` 为第一参数；不提供
  `forSpace(...)` 或其他 Space client factory。
- provider 返回 bearer token 与已规范化的非权威 capability metadata。SDK
  验证和匹配 metadata 以选择凭据，但不自行解析 JWT，也不把 metadata 当作
  授权证明；服务端仍执行全部授权校验。
- 调用方不配置 authorization profile 或 `refDomain`。SDK 仅在内部按 operation
  permission 区分有限 credential class；Root Ref domain 由 provider metadata
  固定并保持一致。
- `SpaceCasClient` 与 `createSpaceCasClient` 在下一次 pre-1.0 minor 中移除；
  blob/file workflow 改为接收共享 `AppCasClient` 与显式 `spaceId`。
- 只有 `readNode`、`readMetadata`、`readContent`、`listRootRefs` 和 `usage`
  可以在服务端以 `401 invalid_token` 拒绝后执行至多一次受控刷新与原样重试。
  `leaseNode`、`updateRootRefs` 和 `gc` 不自动重放；`403`、网络失败和其他
  非成功响应也不触发自动重试。

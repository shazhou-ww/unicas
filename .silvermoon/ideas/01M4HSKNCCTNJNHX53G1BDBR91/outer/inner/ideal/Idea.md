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

- App-user SDK 提供一个以 App 用户会话为生命周期的主 client。它持有统一的
  capability provider、短期 token 状态、并发刷新协调和共享缓存，并能连续
  访问调用方指定的多个 Space。
- 调用方可以从主 client 获取绑定一个 `spaceId` 的轻量 scoped view，或通过
  等价的显式 Space 操作访问数据。scoped view 共享主 client 的认证与缓存状态，
  不拥有独立 token 生命周期；它继续防止一次业务操作意外混用不同 Space。
- 每项操作在发出请求前都形成明确的 capability requirement，至少包含
  `appId`、`spaceId`、operation permission，以及适用时的 `refDomain`。
  SDK 使用完整 requirement 选择或请求 capability，而不是只按 Space 建立
  token 映射。
- 常规用户会话在每个显式 authorization profile 下只维护一个当前 token。
  一个 token 可以同时包含私有 Space 的精确 grant 和共享 Space 的前缀 grant；
  正常刷新以新 token 替换旧 token，不把历史 token 累积成任意 token 池。
- authorization profile 明确区分普通节点访问、Root Ref domain 和 GC 等
  高权限能力。profile 不得隐式扩大 selector 或 permission；当前 token
  不能满足 requirement 时，SDK 通过 provider 获取匹配能力或返回稳定、
  可诊断的失败，不通过随机试 token、拼接多个 grant 或静默放宽权限继续请求。
- 服务端仍是唯一授权边界。客户端对 token metadata 的解析、匹配和缓存只用于
  选择凭据、刷新时机和改进错误体验；任何本地判断都不能替代签名、issuer、
  audience、App、Space、permission 与 `refDomain` 的服务端校验。
- 节点与上层 blob/file 缓存继续以至少 `appId + spaceId + hash` 隔离。
  App-level client 不得让相同 hash、共享 token 或 selector 前缀绕过 Space
  缓存边界。
- 现有 Space-oriented 调用方式获得清晰迁移路径。`SpaceCasClient` 可以保留为
  主 client 的轻量 scoped view 或兼容入口，但不再要求调用方为每个 Space
  分别拥有认证状态。公开类型、示例、API artifact、版本说明和第一方消费者
  对最终模型保持一致。
- SDK 文档以私有可写 Space 与 `/shared/**` 只读 Space 为代表场景，证明一个
  App client 可以在不向调用方暴露 token-to-Space 管理的情况下安全切换 Space。

## 范围

### 范围内

- 定义 App-level client、Space scoped view、capability requirement、
  authorization profile 和 token provider 的公开职责与类型边界。
- 实现 selector、operation permission、有效期和 `refDomain` 感知的 token
  选择、替换、并发刷新协调与显式失败行为。
- 将当前 Space client 的 HTTP transport 能力复用于主 client 和 scoped view，
  保持 App/Space v1 route 与服务端授权语义。
- 让 node、blob、file 与 browser cache 层能够复用一个 App client 的认证状态，
  同时保持既有 Space 隔离、取消、错误和资源生命周期语义。
- 为私有与共享 Space、不同权限、过期刷新、并发请求、scope miss、Root Ref
  profile、缓存隔离和服务端拒绝添加聚焦测试。
- 更新 SDK README、文档站、quickstart、TypeScript API reference、迁移说明、
  changelog、API baseline、打包 consumer 与第一方 Spaces App 使用方式。
- 根据公开 API 兼容策略决定现有 `createSpaceCasClient` 的保留、适配或弃用路径，
  并提供可执行迁移证据。

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
- 在没有单独接受的需求前把 token-global `refDomain` 下沉到每个 grant。
  初始模型通过显式 authorization profile 隔离不同 Root Ref domain。
- 隐式部署生产环境、发布 npm 包或修改冻结的 `unicas.shazhou.work` 环境。

## 约束

- 保留 App 作为授权主体边界、Space 作为每次资源访问边界、token 作为短期
  immutable capability bundle。App-level client 不代表 App-wide unrestricted
  authority。
- 一次请求必须由同一个已选择 token 中的一个 grant 同时满足 selector 和
  permission；不得跨 grant 或跨 token 拼接授权。
- provider 必须有明确的 token 替换与刷新契约。相同 profile 的并发刷新要合并，
  过期、撤销、scope miss 和 provider 失败要保留稳定且可诊断的错误，不得回退
  到成功形状或旧权限。
- capability 和刷新材料默认只保存在内存中，不进入业务缓存、日志、异常文本、
  telemetry、持久化示例或测试 fixture。
- `refDomain` 在当前协议中属于整个 token。不同 Root Ref domain 使用不同的
  显式 profile；普通节点操作不得因此获得 Root Ref 或 GC 权限。
- 保持现有 package dependency 方向和浏览器/Node 兼容矩阵。OAuth 登录与 token
  endpoint 的具体传输可以继续由 provider 适配，但 capability requirement、
  token 生命周期和 Space 选择体验必须由 SDK 统一。
- 保持 query-scoped `appId + spaceId` route、capability version 2、最多 32 个
  grant 及现有 selector 语义，除非 Ideal World 经显式修订并重新批准。
- 任何破坏性 SDK 变化都必须进入统一版本判断、API baseline、迁移文档和 packed
  consumer 验证；不能只修改源码类型而遗漏发布 artifact 或第一方消费者。
- idea-specific 设计、计划和证据保留在本 idea；只有被接受的稳定共识才进入
  `docs/`。

## 待解决问题

- token provider 应返回 bearer token 加已规范化的 capability metadata，还是由
  SDK 解析 JWT claims 形成仅用于路由的非权威 metadata？Implementation 必须
  选择一个不把本地解析误当成授权验证、且不会要求调用方重复 selector 匹配的
  契约。
- 现有 `createSpaceCasClient` 应长期保留为 App client 的 convenience wrapper，
  还是经过一个有版本和迁移证据的周期后弃用？选择必须同时考虑公开 API 简洁性
  与现有 SDK consumer 的迁移成本。
- 当服务端因 token 过期、撤销或 scope 变化拒绝请求时，哪些无副作用操作可以在
  一次受控刷新后自动重试，哪些写操作必须把结果交还调用方？不得在实施前用统一
  的宽泛重试策略替代逐操作决定。

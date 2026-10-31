# App-level multi-Space client API 设计

## 设计目标

`@unicas/space-client` 只提供一个与 App 用户会话同生命周期的 CAS client。
调用方在每次操作中显式传入目标 `spaceId`，SDK 统一管理 capability 与 cache：

```ts
const cas = createAppCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  capabilityProvider,
  cache,
});

const privateNode = await cas.readNode("/users/alice", privateHash);
const sharedNode = await cas.readNode("/shared/templates", templateHash);
```

公开 API 不提供 `forSpace`、`SpaceCasClient`、authorization profile 或
`refDomain` 参数。高层 blob/file workflow 可以绑定一个 Space，以保证一次
workflow 不混用 Space，但它们共享同一个 App client，不拥有独立认证状态。

## 目标公开 TypeScript surface

```ts
import type {
  SpaceCapabilityPermissionKind,
  SpaceSelector,
} from "@unicas/space-protocol";

export function createAppCasClient(
  config: AppCasClientConfig,
): AppCasClient;

export interface AppCasClient {
  readNode(
    spaceId: string,
    hash: CasHash,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CasNode>;

  readMetadata(
    spaceId: string,
    hash: CasHash,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CasNodeMetadata>;

  readContent(
    spaceId: string,
    hash: CasHash,
    range?: CasNodeRange,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;

  leaseNode(
    spaceId: string,
    hash: CasHash,
    options?: SpaceNodeLeaseOptions,
  ): Promise<SpaceNodeLeaseResult>;

  listRootRefs(
    spaceId: string,
    options?: CasListRootRefsOptions,
  ): Promise<CasRootRefsPage>;

  updateRootRefs(
    spaceId: string,
    update: CasRootRefUpdate,
  ): Promise<CasRootRefsResult>;

  usage(
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<CasUsage>;

  gc(
    spaceId: string,
    options?: CasGcOptions,
  ): Promise<CasGcResult>;
}

export interface AppCasClientConfig {
  readonly baseUrl: string;
  readonly appId: string;
  readonly capabilityProvider: SpaceCapabilityProvider;
  readonly fetcher?: HttpFetcher;
  readonly cache?: CasNodeCache;
}

export interface SpaceCapabilityProvider {
  acquire(
    requirement: SpaceCapabilityRequirement,
  ): Promise<ProvidedSpaceCapability>;
}

export interface SpaceCapabilityRequirement {
  readonly appId: string;
  readonly spaceId: string;
  readonly permission: SpaceCapabilityPermissionKind;
  readonly reason:
    | "missing"
    | "expiring"
    | "requirement-miss"
    | "server-rejected";
}

export interface ProvidedSpaceCapability {
  readonly bearerToken: string;
  readonly metadata: SpaceCapabilityMetadata;
}

export interface SpaceCapabilityMetadata {
  readonly version: 2;
  readonly notBefore?: number;
  readonly expiresAt: number;
  readonly grants: readonly SpaceCapabilityGrantMetadata[];
  readonly refDomain?: string;
}

export interface SpaceCapabilityGrantMetadata {
  readonly selector: SpaceSelector;
  readonly permissions: readonly SpaceCapabilityPermissionKind[];
}

export type CasCapabilityErrorCode =
  | "PROVIDER_FAILED"
  | "INVALID_CAPABILITY_METADATA"
  | "UNSATISFIED_CAPABILITY_REQUIREMENT";

export class CasCapabilityError extends Error {
  readonly code: CasCapabilityErrorCode;
  readonly cause?: unknown;
}
```

这里的声明描述 public contract，不要求实现把全部类型放在同一个源码文件。
生成的 package-root declarations 与 API baseline 必须呈现等价 surface。

`AppCasClient` 没有 `close()` 或 `forSpace()`。App 在登录会话结束时丢弃 client
与 provider；client 不持久化 token，也不声称远程撤销 token。

## 操作与 requirement

每次调用先验证 canonical `spaceId`，再生成一个精确 requirement：

| 操作 | permission |
| --- | --- |
| `readNode`、`readMetadata`、`readContent` | `cas:nodes:read` |
| `leaseNode` | `cas:nodes:lease` |
| `listRootRefs` | `cas:root-refs:read` |
| `updateRootRefs` | `cas:root-refs:update` |
| `usage` | `cas:usage:read` |
| `gc` | `cas:gc:execute` |

requirement 只包含 App、目标 Space、精确 permission 和 acquisition reason。
调用方不提供 selector、profile、token key 或 `refDomain`。

provider 负责通过 App 自己的登录会话、token endpoint 或其他适配器取得
capability。它可以返回覆盖更广场景的一个 token，例如同时包含：

- `/users/alice` 的 node read/lease 与 Root Ref 权限；
- `/shared/**` 的 node read。

SDK 不要求 provider 为每个 requirement 单独签发 token，也不要求业务调用方
维护 token-to-Space 映射。

## Metadata 与授权边界

provider 返回 bearer token 与该 token 的规范化 metadata。SDK 不解析 JWT；
provider adapter 可以从受信 token endpoint response 或其他发行结果构造 metadata。

metadata 只用于本地选择、刷新和错误诊断，不能证明 bearer token 真实拥有权限。
服务端继续验证签名、issuer、audience、App、Space selector、permission 与当前
协议要求的其他 claims。

SDK 必须复制、验证并冻结 provider 结果：

- `bearerToken` 非空；
- `version` 为 `2`；
- `notBefore` 与 `expiresAt` 是有效 Unix 秒值，时间窗口可用；
- grant 数量、selector 与 permission 满足协议约束；
- 同一个 grant 同时匹配目标 Space 和 operation permission；
- Root Ref capability 在当前协议下包含一个有效 `refDomain`。

metadata 无效或不能满足触发 acquisition 的 requirement 时，不发送 HTTP 请求，
不回退旧 token，也不尝试其他历史 token。provider failure 由
`CasCapabilityError` 的 `PROVIDER_FAILED` code 与 `cause` 显式保留。
错误 message、日志和 telemetry 不得包含 bearer token、完整 metadata 或 provider
响应体。

## 自动 credential class

公开 API 不存在 authorization profile。SDK 只在内部从 permission 推导三个固定
credential class：

- content：node read 与 lease；
- root-refs：Root Ref read 与 update；
- management：usage 与 GC。

每个 class 至多指向一个 current capability；同一个 immutable capability record
可以被多个 class 共享。acquisition 成功时，SDK 原子替换请求 class 的 current
record，并可以让它满足的其他 class 指向同一 record。任何 class 都不能积累历史
token，因此这不是可遍历或随机尝试的 token pool。

Root Ref 的 `refDomain` 只存在于 provider metadata 与内部 root-refs class：

- 第一个有效 Root Ref capability 固定该 App client 会话的 domain；
- 后续 Root Ref acquisition 必须返回同一 domain；
- domain 改变以 `INVALID_CAPABILITY_METADATA` 显式失败；
- `readNode` 等普通操作不接收或推导 domain；
- 调用方无法通过 CAS 方法选择、覆盖或观察 domain。

彻底删除服务端 `refDomain` 由独立 idea `remove-root-ref-domain`
(`01M4HVP9ARZYN3M9A5HHCES65R`) 管理。该 idea 完成后，上述内部 pinning 可以删除，
而本文件定义的 App client 方法签名不需要再次变化。

## 刷新与并发

SDK 在以下情况调用 provider：

- credential class 没有 current capability；
- current capability 已进入协议 clock-skew 窗口；
- current metadata 不满足本次 requirement；
- 前一个 request 被服务端拒绝并使 current capability 失效。

同一 credential class 同时只能有一个 acquisition。等待者在 acquisition 完成后
重新检查自己的 requirement；若结果仍不满足，SDK 可以为尚未满足的 requirement
启动下一次 acquisition，但不得拼接多个 token 或 grant 来满足一次请求。

成功 acquisition 原子替换 current capability。已经取得旧 token snapshot 并发出
的 HTTP request 可以完成，后续 request 只观察替换后的状态。OAuth refresh token
或登录 session 由 provider 自己持有，不传给 App client。

## 服务端拒绝与自动重试

首次发送前，所有操作都可以完成必要 acquisition。发送后的自动重试严格限制为：

- 仅 `readNode`、`readMetadata`、`readContent`、`listRootRefs` 和 `usage`；
- 仅服务端返回 `401` 且稳定 code 为 `invalid_token`；
- 使引用该 capability 的内部 class 失效，调用 provider 一次，再以相同参数重试
  一次；
- 第二次失败原样抛出 `CasClientError`，不得继续循环。

以下情况绝不自动重放：

- `leaseNode`、`updateRootRefs`、`gc`；
- 任意 `403`；
- 网络异常、超时、取消与无法解析的响应；
- 其他 `401` code。

稳定的 `insufficient_permission` 或 `resource_scope_mismatch` 可以使相关内部 class
失效，但当前操作仍原样抛出 `CasClientError`。下一次独立调用再通过 provider
acquire；SDK 不在同一次 `403` 后试探其他 token。

即使 `updateRootRefs` 带 `requestId`，SDK 也不替调用方判断业务事务是否应重放。

## Cache 与高层 SDK

App client 接受现有 `CasNodeCache`。cache key 继续是
`version + appId + spaceId + hash`；token、selector 与内部 credential class
不改变 cache identity，也不能让相同 hash 跨 Space 命中。

blob/file workflow 天然要求一次操作树留在同一 Space，因此它们可以保存
`spaceId`，但不能保存 Space-level auth client：

```ts
export interface CasBlobClientConfig extends CasBlobClientOptions {
  readonly client: AppCasClient;
  readonly spaceId: string;
}

export function createCasBlobClient(
  config: CasBlobClientConfig,
): CasBlobClient;

export interface SpaceFileSystemOptions {
  readonly client: AppCasClient;
  readonly spaceId: string;
  readonly catalog: SpaceFileRootCatalog;
  readonly blobOptions?: CasBlobClientOptions;
  readonly createId?: () => string;
  readonly createRequestId?: () => string;
}
```

`CasBlobClient.unicasClient` 改为 `AppCasClient`，并增加只读 `spaceId`。node-content
helpers 同样接收 `AppCasClient + spaceId`。file client 将这两个值传给 blob
client。browser cache 的 versioned App/Space key 保持不变。

调用示例：

```ts
const cas = createAppCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  capabilityProvider,
  cache,
});

const files = createSpaceFileSystem({
  client: cas,
  spaceId: "/users/alice",
  catalog,
});

const sharedBlobs = createCasBlobClient({
  client: cas,
  spaceId: "/shared/templates",
});

await files.listRoots();
await sharedBlobs.openBlob(templateHash);
```

两个 workflow 共享 App client 的 capability 与 cache 状态；业务代码不创建
Space CAS client，也不保存 bearer token。

## Breaking migration

这个设计以替代 Space-level client 为目标，不保留第二套长期 surface：

- 在下一次 pre-1.0 minor 中新增 `createAppCasClient` 与 `AppCasClient`；
- 同一版本移除 `createSpaceCasClient`、`SpaceCasClient` 与
  `SpaceCasClientConfig`；
- CAS 方法调用把 `spaceId` 移到第一个参数；
- blob/file configs 改为接收 `client + spaceId`；
- package name、App/Space v1 HTTP routes、capability version 2 与 cache key
  version保持不变。

迁移前后对应关系：

```ts
// 旧 API
const cas = createSpaceCasClient({
  baseUrl,
  appId,
  spaceId,
  getToken,
});
await cas.readMetadata(hash);

// 新 API
const cas = createAppCasClient({
  baseUrl,
  appId,
  capabilityProvider,
});
await cas.readMetadata(spaceId, hash);
```

`getToken()` 不能作为无 metadata 的隐式兼容入口，因为它无法让 SDK 安全判断
selector、permission、expiry 或 Root Ref domain。迁移指南必须展示如何把 App
现有 token endpoint 适配为 `SpaceCapabilityProvider`。

Implementation 必须同步更新六个 App-user SDK packages 的版本判断、package-root
declarations、API baseline、README、文档站、quickstart、changelog、packed
Node/browser consumers、第一方 Spaces App 和所有测试替身。发布候选必须证明
旧 Space client exports 已消失，且同一个 App client 能安全访问私有与共享 Space。

# App-level multi-Space client API 设计

## 设计目标

这份设计定义 `@unicas/space-client` 的目标公开 surface。它让一个 App 用户
会话共享 capability 状态，并继续把每次 CAS 操作绑定到一个明确 Space。

设计采用兼容性优先的增量路径：

- 新增 `createAppCasClient` 和相关类型，不改变现有 HTTP route、capability
  version 或 CAS 操作语义。
- `AppCasClient.forSpace(...)` 返回现有 `SpaceCasClient`，因此
  `@unicas/space-blob-client`、`@unicas/space-file-client` 和调用方已有的
  Space-oriented 组合方式可以直接复用。
- `createSpaceCasClient` 保持当前签名和行为，在首个版本中不弃用。

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
  forSpace(
    spaceId: string,
    options?: AppSpaceClientOptions,
  ): SpaceCasClient;
  close(): void;
}

export interface AppCasClientConfig {
  readonly baseUrl: string;
  readonly appId: string;
  readonly capabilityProvider: SpaceCapabilityProvider;
  readonly fetcher?: HttpFetcher;
  readonly cache?: CasNodeCache;
}

export interface AppSpaceClientOptions {
  readonly authorizationProfile?: SpaceAuthorizationProfile;
}

export type SpaceAuthorizationProfile =
  | {
      readonly id: string;
      readonly kind: "content";
    }
  | {
      readonly id: string;
      readonly kind: "root-refs";
      readonly refDomain: string;
    }
  | {
      readonly id: string;
      readonly kind: "management";
    };

export const DEFAULT_SPACE_AUTHORIZATION_PROFILE: Readonly<{
  readonly id: "content";
  readonly kind: "content";
}>;

export interface SpaceCapabilityProvider {
  acquire(
    request: SpaceCapabilityAcquireRequest,
  ): Promise<ProvidedSpaceCapability>;
}

export interface SpaceCapabilityAcquireRequest {
  readonly profile: SpaceAuthorizationProfile;
  readonly requirements: readonly SpaceCapabilityRequirement[];
  readonly reason:
    | "missing"
    | "expiring"
    | "requirement-miss"
    | "server-rejected";
  readonly current: SpaceCapabilityMetadata | null;
  readonly rejection?: {
    readonly status: number;
    readonly code?: string;
  };
  readonly signal?: AbortSignal;
}

export interface SpaceCapabilityRequirement {
  readonly appId: string;
  readonly spaceId: string;
  readonly permission: SpaceCapabilityPermissionKind;
  readonly refDomain?: string;
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
  | "CLIENT_CLOSED"
  | "PROFILE_MISMATCH"
  | "PROVIDER_FAILED"
  | "INVALID_CAPABILITY_METADATA"
  | "UNSATISFIED_CAPABILITY_REQUIREMENT";

export class CasCapabilityError extends Error {
  readonly code: CasCapabilityErrorCode;
  readonly cause?: unknown;
}
```

这里的声明描述公开契约，不要求实现把全部类型放在同一个源码文件。生成的
API baseline 必须呈现等价的 package-root exports。

## App client 与 scoped view

`createAppCasClient` 创建一个与 App 用户会话同生命周期的对象。它拥有：

- 一个 `appId` 和 data-plane `baseUrl`；
- 一个 provider；
- 按 authorization profile 隔离的当前 capability、刷新状态和拒绝状态；
- 所有 Space view 共用的 fetcher 与 node cache。

`forSpace(spaceId, options)` 首先验证 canonical Space ID，然后返回冻结的
`SpaceCasClient` view。view 只保存 Space 与 profile 描述，所有 token 获取、
替换和并发协调都委托给 App client。多次创建同一 Space view 不承诺对象 identity，
但必须共享相同 App client 状态。

默认 profile 是 `content`。profile 的用途是隔离不同授权上下文，而不是授予
权限：

- `content` 用于 node read/lease；
- `root-refs` 用于 node 操作以及一个明确 `refDomain` 下的 Root Ref 操作；
- `management` 用于 usage 和 GC。

调用 profile 不支持的操作时，SDK 在联系 provider 或发送 HTTP 请求前抛出
`CasCapabilityError`，code 为 `PROFILE_MISMATCH`。profile 本身不得扩大 selector
或 permission；每次操作仍生成一个精确 requirement。

`close()` 丢弃内存中的 capability 引用、阻止新的 provider/HTTP 操作，并让之后
的 view 调用以 `CLIENT_CLOSED` 失败。已经发出的 HTTP 请求继续服从调用方传入的
`AbortSignal`；`close()` 不伪装成远程 token 撤销。

## Requirement 与 provider

每个公开操作在发送请求前映射为一个 requirement：

| 操作 | permission | profile |
| --- | --- | --- |
| `readNode`、`readMetadata`、`readContent` | `cas:nodes:read` | `content` 或 `root-refs` |
| `leaseNode` | `cas:nodes:lease` | `content` 或 `root-refs` |
| `listRootRefs` | `cas:root-refs:read` | `root-refs`，并带 `refDomain` |
| `updateRootRefs` | `cas:root-refs:update` | `root-refs`，并带 `refDomain` |
| `usage` | `cas:usage:read` | `management` |
| `gc` | `cas:gc:execute` | `management` |

provider 接收 SDK 已形成的精确 requirements，并负责通过 App 自己的登录会话、
token endpoint 或其他适配器取得 capability。provider 可以返回覆盖更广业务
场景的一个 token，例如：

- `/users/alice` 的 node read/lease 与 Root Ref 权限；
- `/shared/**` 的 node read；
- token-global `refDomain: "documents"`。

SDK 不要求 provider 为每个 requirement 单独获取 token，也不要求调用方维护
token-to-Space 映射。provider 返回的 metadata 必须是 token 的规范化描述；
SDK 不再解析 JWT。metadata 只参与本地选择、刷新和诊断，不能证明 bearer token
真实拥有对应权限。

SDK 必须复制、验证并冻结 provider 结果：

- `bearerToken` 非空；
- `version` 为 `2`；
- `notBefore`、`expiresAt` 是有效 Unix 秒值且时间窗口可用；
- grant 数量、selector 和 permission 满足协议约束；
- Root Ref requirement 的 `refDomain` 精确相等；
- 同一个 grant 同时满足目标 Space selector 和 operation permission。

metadata 无效或不能满足触发 acquisition 的 requirement 时，不发送 HTTP 请求，
不回退旧 token，也不尝试其他历史 token。

provider error 由 `CasCapabilityError` 的 `PROVIDER_FAILED` code 和 `cause`
显式保留。SDK 的错误 message、日志或 telemetry 不得包含 bearer token、完整
metadata 或 provider 响应体。

## Token 槽位、刷新与并发

每个 `profile.id` 只有一个 current token 槽位。相同 id 再次出现时必须与首次
注册的 profile kind 和 `refDomain` 完全一致，否则以 `PROFILE_MISMATCH` 失败。

SDK 在以下情况调用 provider：

- 槽位为空；
- token 已进入协议 clock-skew 窗口，reason 为 `expiring`；
- current metadata 不满足 requirement，reason 为 `requirement-miss`；
- 前一请求被服务端拒绝且允许受控刷新，reason 为 `server-rejected`。

同一 profile 同时只能有一个 acquisition。等待者在 acquisition 完成后重新检查
自己的 requirement；若结果仍不满足，SDK 可以把尚未满足的并发 requirements
合并到下一次 provider 请求，但不得保存任意历史 token 池或随机试 token。

成功 acquisition 原子替换 current token。已经取得旧 token 快照并发出的请求
可以完成，但后续请求只观察新 token。provider 自己拥有 OAuth refresh token
或登录 session；这些材料不传给 App client。

## 服务端拒绝与自动重试

所有操作都可以在首次发送前完成必要 acquisition。发送后的自动重试严格限制为：

- 仅 `readNode`、`readMetadata`、`readContent`、`listRootRefs` 和 `usage`；
- 仅服务端返回 `401` 且稳定 code 为 `invalid_token`；
- 标记当前槽位已拒绝，调用 provider 一次，再用相同参数重试一次；
- 第二次失败原样抛出 `CasClientError`，不得继续循环。

以下情况绝不自动重放：

- `leaseNode`、`updateRootRefs`、`gc`；
- 任意 `403`；
- 网络异常、超时、取消和无法解析的响应；
- 其他 `401` code。

服务端拒绝会让 current token 不再用于后续新请求。不能自动重试的操作把原始
`CasClientError` 交给调用方；下一次独立操作再通过 provider 获取 capability。
即使 `updateRootRefs` 有 `requestId`，SDK 也不替调用方判断业务事务是否应重放。

## 缓存与上层 SDK 组合

App client 接受现有 `CasNodeCache`。所有 view 共享它，cache key 继续是
`version + appId + spaceId + hash`。profile、token 和 selector 不改变缓存身份，
也不能让相同 hash 跨 Space 命中。

由于 view 继续实现 `SpaceCasClient`，上层调用保持现有形状：

```ts
const app = createAppCasClient({
  baseUrl: "https://api.unicas.work",
  appId,
  capabilityProvider,
  cache,
});

const documentsProfile = {
  id: "documents",
  kind: "root-refs",
  refDomain: "documents",
} as const;

const privateCas = app.forSpace("/users/alice", {
  authorizationProfile: documentsProfile,
});

const sharedCas = app.forSpace("/shared/templates", {
  authorizationProfile: documentsProfile,
});

const files = createSpaceFileSystem({
  cas: privateCas,
  catalog,
});
const sharedBlobs = createCasBlobClient(sharedCas);

await files.listRoots();
await sharedBlobs.openBlob(templateHash);

app.close();
```

第一次 acquisition 可以返回同时覆盖私有精确 selector 和 `/shared/**` 的 token。
之后两个 view 通过同一 profile 槽位复用它；调用方不保存或选择 bearer token。

## 兼容与迁移

首个实现版本采取 additive API change：

- `createSpaceCasClient(config)`、`SpaceCasClientConfig.getToken` 和所有现有操作保持
  原样，当前 consumer 不需要迁移；
- `createSpaceCasClient` 不在首个版本标记 deprecated；
- 单 Space、测试替身和已经由外部系统管理 token 的场景可以继续使用旧 factory；
- 新的多 Space App 用户流程和文档示例优先使用 `createAppCasClient`；
- 后续若要弃用或移除旧 factory，必须另行更新 Ideal、版本判断、迁移文档、
  changelog、API baseline 和 packed consumer 证据。

Implementation 必须更新 package-root declarations、API baseline、README、文档站、
quickstart、版本说明、changelog、packed Node/browser consumer 和第一方 Spaces
App，并用类型与运行时测试证明旧 factory 未回归。

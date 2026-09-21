# packages — UniCAS 包结构与边界

UniCAS 是独立可部署的 CAS 中间件（content-addressed storage + App 控制面）。
`packages/` 是 standalone 仓库的 workspace package 边界，包含 UniCAS
中间件包及不发布的第一方集成 App。2026-08-29 重组后，本目录内**零
`@unidocs/*` 依赖**，该承诺完全兑现。

公共资源名是 **App** 和 **Space**，数据访问面包族统一使用 `space-*`。
冻结的 Stack/Tenant v1 仅由 `space-protocol/v1`、`space-client/v1` 和
`space-browser-cache/v1` 显式承载；物理或历史兼容字段由命名 adapter 隔离，
不得暴露到当前 wire、CLI、MCP 或 WebUI。

## 命名规则

1. **目录名 = 包名**：`packages/<name>` = `@unicas/<name>`，一一对应。
   改名必须同时改目录名与 `package.json` 的 `name`（依赖 guard 强制校验，
  见 `tests/workspace-boundaries.test.mjs`）。
2. **客户端按 actor 分两组**：
  - `space-*` — Space 数据面 package family（root 为 current，`./v1` 为 frozen v1）
  - `admin-*` — App 管理控制面
3. **编码层**：`codec` —— wire 编码，独立发布、独立测试，无 workspace 依赖。
4. **契约包**：`space-protocol`（数据面 HTTP 契约 + capability）/
   `admin-protocol`（控制面契约）。只放类型、路由、校验、常量——无 IO、
  无平台绑定、**不含任何编码**。两面共用的协议类型归 `space-protocol`；
  `admin-protocol` 可依赖 `space-protocol`，反向禁止。
5. **界面/入口**：`admin-webui`（管理 WebUI，纯浏览器包）、
   `admin-cli`（管理 CLI + stdio MCP）、`space-client`（数据面 HTTP client）。
6. **服务端按平台分层，不按 actor 拆部署**：`service` 是 cloud-neutral 的
  data + admin HTTP actor 与平台端口；`service-cloudflare` 是唯一 Cloudflare
  Worker 和公网入口。控制面实现归属这两个包，不存在独立控制面部署单元。

## 客户端访问面固定结构

admin 与 data 两类参与者的访问面保持分离，客户端包采用同一套角色：

```
admin:  [admin-cli, admin-webui] -> admin-client -> admin-protocol
space: [space-cli, space-webui] -> space-client -> space-protocol
```

- `protocol` 定义该访问面的 HTTP 接口、接口依赖的 request/response 类型，
  以及配合这些类型使用的简单纯函数（如构造函数、类型判定函数）。
- 两个访问面共用的协议类型放在 `space-protocol`；只允许
  `admin-protocol -> space-protocol`，不允许反向依赖。
- `client` 对每个 HTTP API 提供简单的 `Request -> Promise<Response>` 封装；
  client 对象只收纳 base URL、credential 等公共传输参数，不承载业务抽象。
- 更高层抽象另建包装包；`space-blob-client -> space-client` 是基准模式。
- 上图是固定的角色与依赖模型；某个 CLI/WebUI 产品尚未实现时不创建空包。
  WebUI 的服务端 BFF 属于服务端梳理范围，不改变浏览器侧的依赖方向。

## 包清单（14 包）

```
packages/                           @unicas org
│
├── ■ 编码层（cloud-neutral、无 IO、独立发布独立测试）
│   └── codec/             @unicas/codec              数据面 wire 编码
│         规范节点二进制格式（binary）、SHA-256 摘要（digest）、流式节点解析
│         （canonical-stream）、限额/校验（validation）——不含 blob 分片
│
├── ■ 契约层（cloud-neutral、无 IO、冻结契约）
│   ├── space-protocol/   @unicas/space-protocol    Space 数据面
│   │     HTTP request/response 类型（types/http）+ 路由（routes）
│   │     + capability 词汇（capability）；不 re-export 编码符号
│   └── admin-protocol/    @unicas/admin-protocol     admin 组 · 控制面
│         控制面契约：类型、路由、错误码、并发/ETag、authz、威胁模型
│
├── ■ 内核/库层（cloud-neutral）
│   ├── service/           @unicas/service            data + admin HTTP actor
│   │     精确匹配 v1 App/Space 与 frozen v1 protocol；定义 control/data SQL、
│   │     blob、按 key 串行 actor 等平台端口；内置 App/Space 与 v1 capability
│   │     校验、权限矩阵与有界 authority
│   │     cache，以及 Root Ref 校验/幂等/投影/revision/retry 业务内核；不依赖
│   │     Cloudflare 类型或 control-plane 实现；node GC 的候选复核、删除顺序与
│   │     回收统计、Space node usage、node content range/metadata read，以及
│   │     lease-driven direct node upload 语义，同样通过 semantic repository port 执行；
│   │     控制面业务内核（App/member/invitation/issuer/audit 语义）经
│   │     ControlPlaneAdminService 与 semantic repository port 执行
│   └── control-auth/      @unicas/control-auth       admin 组
│         OIDC 认证库：discovery、PKCE、id_token 校验（admin BFF 与
│         MCP/OAuth ingress 共用）
│
├── ■ Cloudflare 适配（UniCAS 中间件唯一部署单元）
│   └── service-cloudflare/@unicas/service-cloudflare  UniCAS Worker 部署单元
│         D1/R2/KV/DO bindings、统一公网路由、credential 隔离、admin BFF/OIDC、
│         MCP/OAuth ingress、control schema 与 D1 repository 适配
│
├── ■ client 层
    ├── admin-webui/       @unicas/admin-webui         admin 组 · 浏览器 UI（纯前端）
    │     经 @unicas/admin-client 取 admin-protocol 类型；不含任何服务端代码
    ├── space-client/     @unicas/space-client       Space 数据面 · 传输层
    │     纯 HTTP 封装，每个路由一个函数（readMetadata/readContent/
    │     leaseNode/updateRootRefs/usage/gc）；root 的 `createSpaceCasClient`
    │     绑定 App/Space，`./v1` 的 `createTenantCasClient` 绑定 frozen v1；
    │     无编码、无业务封装，仅组装层使用
    ├── space-blob-client/@unicas/space-blob-client  Space 数据面 · 业务面
    │     业务方唯一入口：storeBlob / openBlob(含元数据的句柄式随机读) /
    │     retain / release；底层能力统一经 unicasClient 访问
    │     + 节点写辅助（storeNodeContent/leaseNodeContent）
    │     + blob index CBOR（client 侧 manifest，服务端不解析）
    ├── space-file-client/@unicas/space-file-client  Space 数据面 · 文件系统业务面
    │     WebDAV 风格 working tree（stat/readdir/read/write/mkdir/move/copy/remove）
    │     + 显式 commit/discard；文件 manifest 协议独立定义，root 名称与 revision
    │     经注入的业务 catalog port 持久化，CAS 仍不解析目录语义
    ├── space-browser-cache/@unicas/space-browser-cache  Space 数据面 · 浏览器缓存策略
    │     实现 CasNodeCache；仅缓存不可变节点元数据和完整内容，内存 + IndexedDB LRU
    │     root 按 endpoint/Principal/App/Space/hash/version 隔离；`./v1` 保留
    │     endpoint/principal/stack/tenant/hash，不持久化凭据或 working tree
    ├── admin-client/      @unicas/admin-client        admin 组 · 控制面 HTTP client
    │     纯函数传输层（对标 space-client）：每操作一函数，类型直接来自
    │     @unicas/admin-protocol；session cookie + CSRF 由 session provider 提供
    ├── admin-cli/         @unicas/admin-cli           admin 组
    │     CLI + stdio MCP（bin `unicas`），走 /admin HTTP API（admin-client）；
    │     登录 = BFF /admin/auth/cli/authorize（服务端跑 Google OIDC）→
    │     /admin/auth/cli/exchange 换 session cookie + CSRF；
    │     `unicas mcp` 是 admin-client 之上的薄 MCP 呈现层（无 MCP 转 MCP）
    │
    └── ■ 私有第一方集成 App
        └── spaces/            @unicas/spaces              文件工作流与 release smoke
          独立部署且不发布；只消费公开 Space client，部署配置与 App-owned
          D1 migration 位于 stacks/unicas/spaces
```

## 依赖规则（分层单向，guard + boundary 测试强制）

```
编码层(codec) + 契约层(space-protocol, admin-protocol)
  ← service（cloud-neutral actor + platform ports）
    ← service-cloudflare（UniCAS 中间件唯一 Worker）
契约层 + 编码层 ← space-client（纯函数传输层，仅组装）
                    ← space-blob-client（业务方唯一入口）
                      ← space-file-client
                        ← spaces（私有外部集成 App，不发布）
契约层 ← admin-client（控制面 HTTP 传输，仅组装/CLI 用）
        ← admin-cli（走 admin-client + control-auth 登录）
```

- **codec 是最底层**：无 workspace 依赖，仅外部 `cborg`；`space-protocol`
  不 re-export codec 符号（强制迁移，2026-08-29 决策）。
- **space-client 是纯函数传输层**：与 HTTP 路由一一对应。root factory 绑定
  `appId`/`spaceId`；`./v1` factory 绑定 `stackId`/`tenantId`。两者只组装 JWT
  与公共传输参数，无编码、无业务封装、无对象模式（`node()` 已移除）。
- **业务方只用 space-blob-client**：其接口覆盖完整数据面
  （blob 写/随机读 + 节点元数据/续租/root-refs + usage/gc），应用栈不再直接
  依赖 space-client；当前业务层只接收 `SpaceCasClient`。
- 契约层：`space-protocol` 持有数据面共享类型；`admin-protocol` 仅通过允许的
  单向依赖复用 App/Space identity 类型，反向依赖禁止。
- `service` 同时依赖 Space/admin protocol，统一 current、frozen-v1 与 Admin HTTP surface；
  平台 context 显式提供 control/Space SQL、blob 与 keyed actor 端口。capability
  校验属于该 cloud-neutral actor：authority 只经只读 resolver port
  注入，D1 `AuthorityRepository` 仍由 Cloudflare adapter 构造。
- `service-cloudflare` 是 UniCAS 中间件唯一部署包，持有 D1/R2/KV/DO 和公网 route；生产及
  本地 Miniflare 均不再通过 tenant/admin/MCP service bindings 拆分 UniCAS。
- Space D1/R2 repositories、DO 生命周期与 legacy audit RPC 已并入
  `service-cloudflare`，原 `server-cloudflare`、`control-plane`、`control-plane-mcp`
  迁移包已删除；admin BFF/OIDC（src/admin-bff）与 MCP/OAuth ingress（src/mcp）
  也已并入 `service-cloudflare`，`admin-webui` 只剩浏览器 UI。
- 数据面不得依赖 admin 组包；admin 实现包不得依赖 Space 实现包。
  唯一协议级单向例外是 `admin-protocol -> space-protocol`，用于复用两面
  公共协议类型，反向禁止（由 `admin-protocol/tests/cross-plane.test.ts` 与
  各包 `tests/boundary.test.ts` 断言）。
- **零 `@unidocs/*` 依赖**：`packages/` 是独立中间件边界，生产与测试均不
  依赖应用栈包。
- `admin-cli` 走 `/admin` HTTP API（经 `@unicas/admin-client`），运行时依赖
  `admin-protocol`（契约类型）+ `admin-client`（传输）+ `control-auth`
  （PKCE/state 辅助）；`unicas mcp` 是同一 `admin-client` 之上的 stdio MCP
  呈现层，不引入 MCP 转 MCP。

## 存储编码边界（2026-08-29 决策）

```
CAS 感知的编码 = 只有 1 种：规范 CAS 节点格式（codec/binary.ts）
  ├─ header：digest / contentType / size / refs
  └─ content：不透明字节

CAS 对 content 的立场：
  ✗ 不解析任何内容格式（SValue / SBlob / JSON / 任意未来格式）
  ✓ refs 由调用方编码在 canonical node body 的 refs 段（无 header），CAS 只做通用校验：
      规范节点结构合法、摘要/尺寸一致（re-lease 不可变性）、refs 有界、
      child 就绪、通用大小上限（MAX_CANONICAL_NODE_BYTES）
  ✗ 不校验「声明的 refs 与内容内部引用一致」——所有格式一视同仁
```

SValue 是 unidocs（应用栈）的文档内容模型，**unicas 不感知**。2026-08-29 已
从 `server-cloudflare` 移除 SValue 专属逻辑（16MB 上限 + refs 一致性校验）；
SValue/SBlob 类型族与 codec 全部留在 `@unidocs/protocol` + `@unidocs/svalue-codec`。
refs 一致性若需兜底，由应用栈侧在写入前自检（`refsFromSValue`），不污染 unicas。

**大 blob 分片也是 client 侧概念**：`blob-index` manifest 的编码/解码归属
`space-blob-client`（CAS 服务端只把它当不透明 contentType，从不解析——与
2026-08-28 流式 blob 设计一致：「CAS 服务端无需理解 blob-index 的内容语义」）。

## 能力（capability）词汇归属

Current Space capability 归属 `space-protocol/src/space-capability.ts`，共享算法、
错误与 refDomain 规则归属 `shared-capability.ts`，冻结 v1 claim/permission 归属
`src/v1/capability.ts`。capability 是 JWT claim 词汇而非编码，故不进 `codec` 包。

## 本轮重组记录（2026-08-29）

| 变更 | 说明 |
|---|---|
| `protocol` → `space-protocol` | 改名对齐 actor 前缀 |
| `protocol-admin` → `admin-protocol` | 改名对齐 actor 前缀 |
| `server-common` 删除 | binary/digest/canonical-stream/validation 先并入 `space-protocol` |
| capability 词汇迁入 | 从 `@unidocs/service-auth` 迁入 `space-protocol`，service-auth 变 re-export 薄壳 |
| SValue 专属逻辑移除 | CAS 服务端不再解析 SValue；`@unidocs` 生产依赖清零 |
| `admin-cli` → 依赖 `admin-protocol` | 工具结果用冻结契约类型标注，防 schema 漂移 |
| **codec 拆分（强制迁移）** | `binary/digest/canonical-stream/validation` 从 `space-protocol` 抽为 `@unicas/codec`；`space-protocol` 不再 re-export 编码符号；纯编码消费者直接依赖 codec |
| **blob 分层（space-blob-client）** | `blob index` 从 codec 迁入新包 `@unicas/space-blob-client`；space-client 收窄为与 HTTP 一一对应的薄传输；blob 层提供完整接口（句柄式随机读对标 SBlobHandler、usage/gc 透传），业务方不再触碰底层 client |
| **权限改名** | tenant 数据面 `cas:admin` → `cas:manage`（消除与「admin 面/控制面」的术语撞车） |
| **space-client 下沉纯函数** | 移除 `node()` 对象模式，改 `readMetadata`/`readContent` 直接函数；业务面全部收敛到 `space-blob-client`（补 `readMetadata`/`leaseNode`/`updateRootRefs` 透传），应用栈不再直接依赖传输层 |
| **admin-client + CLI 改通道** | 新建 `@unicas/admin-client`（/admin HTTP 纯函数 client，类型直接来自 admin-protocol，消除 MCP 工具 schema 双份手写）；admin-cli 从 MCP 通道改为走 /admin HTTP：登录 = 打开 BFF `/admin/auth/cli/authorize`（服务端跑 Google OIDC）→ `/admin/auth/cli/exchange` 换 session cookie + CSRF |
| **tenant auth 下沉 service** | stack capability verifier、操作权限矩阵、authority resolver port 与 30s/60s 有界缓存迁入 `@unicas/service`；Cloudflare 层只负责用 D1 repository 注入 authority 数据与记录事件 |
| **Root Ref 内核下沉 service** | 请求 canonicalization、幂等、节点/aggregate 校验、domain projection、revision transition plan 与 bounded retry 迁入 `@unicas/service`；D1/R2 adapter 只负责语义化读取与原子提交 |
| **node GC 内核下沉 service** | 过期无引用候选、删除前复核、content-before-metadata 顺序与回收统计迁入 `@unicas/service`；D1/R2 adapter 保留候选 SQL、对象删除和 multiplicity-aware edge cascade |
| **node usage 内核下沉 service** | logical/physical/reservation/readiness/lease 统计语义迁入 `@unicas/service`；D1/R2 adapter 只列 node、读取 canonical object 大小与 reservation 总量 |
| **node read 内核下沉 service** | own-content HTTP range 解析、canonical payload offset 与 metadata/state shaping 迁入 `@unicas/service`；D1/R2 adapter 只读 node row、ordered edges 与 object range |
| **lease-driven upload 内核下沉 service** | App/Space lease 的 generation fencing、临时对象检查、canonical validation、child readiness 与 publication 编排迁入 `@unicas/service`；Cloudflare adapter 负责 D1/R2 facts 与 presigned PUT |
| **tenant Cloudflare 包收口** | D1/R2 repositories、tenant/domain DO、schema 与 audit RPC 迁入 `@unicas/service-cloudflare`，删除 `@unicas/server-cloudflare` |

## 待办（README 定方向）

1. **capability 归属复查**：如未来出现第二个消费方，可独立成包或并入
   `codec` 包（目前它是 JWT claim 词汇，留在 `space-protocol` 合理）。
- [x] **服务实现下沉（已完成）**：控制面业务语义（stack/member/invitation/issuer/key/audit）
  已全部迁入 `service` 的 `ControlPlaneAdminService`，经语义化 repository port 执行；
  D1 SQL 与事务留在 `service-cloudflare` 的 repository 适配。
- [x] **入口收尾（已完成）**：`admin-webui/src/server` 与 `control-plane-mcp` 的
  ingress 已并入 `service-cloudflare`（src/admin-bff、src/mcp），两个迁移实现包已删除；
  `admin-webui` 只剩浏览器 UI，依赖方向为 `admin-webui -> admin-client -> admin-protocol`。

## 维护约定

- 依赖 guard：`tests/workspace-boundaries.test.mjs`（目录名=包名、声明与
  import 一致、composite tsconfig references 恰好覆盖 dependencies）。
- 边界测试：`service`、`service-cloudflare`、`admin-webui` 各自有
  `tests/boundary.test.ts`，断言允许的依赖集与跨组禁止项；**client 层与
  契约/编码层包**（`space-client`、`space-blob-client`、`admin-client`、
  `admin-protocol`、`space-protocol`、`codec`、`control-auth`）的依赖边界
  由 package-deps guard（声明与 import 一致）加
  `admin-protocol/tests/cross-plane.test.ts`（只放行
  `admin-protocol -> space-protocol`，其余跨面实现依赖禁止）兜底。
- 改名流程：`git mv` 目录 → 同步 `package.json` `name` → 更新所有 import /
  tsconfig references / workspace aliases / 当前文档 → guard 与 boundary 测试兜底。
- 历史设计文档中的兼容 wire/resource 标识不随物理目录改名。

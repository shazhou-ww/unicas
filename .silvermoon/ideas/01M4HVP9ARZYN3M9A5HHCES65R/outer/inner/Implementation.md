# Implementation

## Steps

### I-S01: 确定迁移与一致性方案

以现有权威 aggregate 和旧 ledger 为依据，确定 App-global revision、
Space projection、幂等冲突处置、旧请求重放桥接、分页稳定性和原子性方案；
准备可重复的迁移、漂移检测及回滚边界测试。

具体方案见 [一致性与切换设计](./Consistency.md)。交付
`release\service\migrate-root-refs.mjs`：输入只读，dry-run 不写数据；
仅生成本地迁移副本。任何 projection 漂移、孤立 row、旧 requestId
碰撞、payload hash 不符或不完整历史均拒绝切换。旧事件不重编号，
唯一旧请求桥接原 revision；新流从 App checkpoint 的下一 revision 开始。

### I-S02: 贯通无 domain 的契约与调用链

统一更新数据面协议、授权、内核、持久层及管理面 API、WebUI、CLI、MCP，
同步 issuer、SDK、第一方 Spaces App、API baseline、文档和破坏性变更说明。
管理面与数据面边界保持不变。

新表为 `cas_app_root_*`，旧表仅用于 cutover 检查和归档。保留 Cloudflare
历史 class/binding 及 allowlisted actor-kind 名称以避免资源迁移与 telemetry
schema 扩张，但 actor key 只含 App。schema-only migration 不会自动迁移旧数据；
存在旧状态而无 cutover marker 时，新服务 fail closed。
第一方 Spaces 已移除 Principal/issuer/bootstrap/preflight 的 domain 字段，
并交付 `0003_remove_ref_domain.sql`。WebUI 本身没有 domain 选择页面，
其 admin-client 类型与内嵌 CLI skill 资产随构建更新，不新增无关 UI。

### I-S03: 验证迁移与混合版本行为

执行相关包测试、类型与契约检查、packed consumer 验证及迁移演练，
覆盖竞争、跨 Space 排序、失败重放、历史归档和有期限的旧 token 容忍。

真实 Miniflare D1 测试覆盖 CAS 竞争与整批回滚、晚期 event 插入失败、
丢失响应重放、旧请求桥接、跨 Space 同 requestId、projection 漂移、
未迁移阻断、分页 scope/revision 绑定及 event watermark。离线 SQLite
fixture 还验证 source 文件字节不变、archive 写保护、冲突拒绝和 Spaces
所有权保留。未执行任何生产迁移、npm 发布或外部配置变更。

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

#### 验证证据（2026-10-27）

SDK 验证使用以下进程级环境，所有工作目录和缺失浏览器的恢复均留在仓库内；
临时 consumer 自带 workspace boundary，realpath 检查确保依赖来自打包产物，
不指向原 workspace package：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path (Get-Location).Path '.wrangler\playwright-browsers'
$env:TEMP=Join-Path (Get-Location).Path '.wrangler'
$env:TMP=$env:TEMP
$env:NODE_COMPILE_CACHE=Join-Path $env:TEMP 'node-compile-cache'
```

| 精确命令 | 结果 |
| --- | --- |
| `pnpm --filter @unicas/space-protocol docs:generate` | 通过；数据面 OpenAPI 已更新 |
| `pnpm --filter @unicas/admin-protocol docs:generate:v2` | 通过；管理面 OpenAPI 已更新 |
| `pnpm --filter @unicas/space-protocol --filter @unicas/admin-protocol --filter @unicas/service --filter @unicas/space-client --filter @unicas/admin-client --filter @unicas/admin-cli --filter @unicas/spaces test` | 通过，7 包、377 tests |
| `pnpm --filter @unicas/service-cloudflare test` | 通过，29 files、258 tests，含完整 DO/GC/telemetry suite |
| `pnpm --filter @unicas/service-cloudflare exec vitest run tests\root-refs.test.ts tests\audit-reads.test.ts --testTimeout=15000` | 最后一次 CAS 调整后通过，15 tests |
| `pnpm --filter @unicas/space-blob-client --filter @unicas/space-file-client --filter @unicas/space-browser-cache --filter @unicas/observability test` | 4 包全部通过 |
| `pnpm exec vitest run tests\root-refs-cutover.test.mjs tests\openapi-drift.test.ts tests\deploy-plan.test.mjs tests\spaces-release-bootstrap.test.mjs tests\spaces-release-smoke.test.mjs` | 通过，69 tests；含持久 fixture 的 CLI dry-run/local-copy |
| `pnpm exec vitest run tests\openapi-drift.test.ts tests\root-refs-cutover.test.mjs tests\app-space-v1-cutover.test.mjs tests\app-space-v1-issuer-cutover.test.mjs tests\sdk-readiness.test.mjs` | 通过，当时合计 27 tests；后续新增 fixture 后迁移测试又单独验证 |
| `pnpm exec vitest run tests\root-refs-cutover.test.mjs tests\deploy-plan.test.mjs tests\local-tooling.test.mjs` | 通过，60 tests |
| `pnpm docs:check` | 通过，7 tests；含新增迁移文档导航与确定性构建 |
| `pnpm build` | 最终独立执行通过，16 tasks；既有 Vite sourcemap 警告不阻断 |
| `pnpm typecheck` | 通过，27 tasks，含相关 test contracts |
| `pnpm release:sdk:prepare` | 通过；更新 API baseline 与 release manifest；两次确定性打包、packed declarations、Node consumer/quickstart、Chromium/Firefox/WebKit 全通过 |
| `pnpm release:sdk:check` | 通过；再次独立证明 baseline/manifest 与 packed consumers 一致 |
| `pnpm release:service:plan` | 通过，仅打印 dry-run 计划，没有执行 remote D1 或部署 |
| `pnpm exec vitest run tests\workspace-boundaries.test.mjs --testNamePattern='^(?!.*repository ownership roots)'` | 105 通过、1 明确跳过；原因见下 |
| `git --no-pager diff --check` | 通过；仅 Git 现有 LF/CRLF 提示 |

初次 `pnpm --filter @unicas/admin-protocol docs:generate` 因无此 script 失败，
已改用仓库实际 `docs:generate:v2`。初次 packed check 暴露 Windows Corepack
shim 与既有 runner 的 native-pnpm-only 假设，已使 runner 同时识别两种 shim，
实际运行通过。浏览器缺失后才执行 `pnpm exec playwright install chromium firefox webkit`，
恢复到上述仓库内路径；随后三引擎验证通过。曾并行运行 SDK build 与 workspace
build 导致共享 dist 的一次编译失败，已停止并发写同一产物，最终独立 build 通过。

完整 workspace boundary 检查仍有一项环境性失败：`D:\Code\unicas\stacks`
目录创建时间为 2026-09-14，早于本次实施，但断言要求该目录不存在。
未删除或移动该非本次创建的目录，未修改或弱化断言；其余 105 项通过。
因此不声称原始工作目录的完整 `check:repo` 已通过。父 agent 后续在干净候选
快照中运行完整 boundary 检查，106/106 通过，且未修改该目录或断言。
父复核还发现并修复本次 v2 迁移的旧项目级验证器遮蔽问题，更新了 root dependency
manifest、lockfile、技能注册和 CI 安装边界；最终标准 idea 检查通过。
独立验证与修复结论见 [实施复核](./Review.md)。
实施 subagent 未修改 `ideal`、`events.jsonl`，也未 stage、commit、push 或记录
生命周期事件；候选集成与 gate 交接由父 agent 完成。

#### 部署演练发现的重试修正

隔离本地 D1 与真实 HTTP/DO 故障注入发现：DO 未配置重试次数时显式传入
`maxAttempts: undefined`，原默认值合并被覆盖，持续存储失败会无限重试。
父 agent 新增有限失败的回归测试，先确认旧代码超过默认五次，再改为逐项
解构默认值，保留明确配置，恢复五次上限与退避延迟。
本地演练同时给 HTTP 请求设置 15 秒超时，并要求故障响应小于 10 秒、
整批无副作用且后续请求恢复。该修正改变本实施修订，须重新提交精确版本验收，
不能沿用此前的实现验收事实作为新修订已接受的证据。

修正后验证：

| 精确命令 | 结果 |
| --- | --- |
| `pnpm --filter @unicas/service exec vitest run tests\root-refs.test.ts` | 6 tests 通过；新增测试断言默认五次尝试和 `[25,50,100,200]` 退避 |
| `pnpm --filter @unicas/service build` | 通过；供真实 worker 演练打包使用 |
| `pnpm --filter @unicas/service --filter @unicas/service-cloudflare typecheck` | 两包通过 |
| `pnpm --filter @unicas/service-cloudflare exec vitest run tests\root-refs.test.ts tests\do.test.ts --testTimeout=15000` | 34 tests 通过 |

故障注入的本地 HTTP 演练已恢复，外层保留真实环境适用范围与结果；
不以此次合成数据成功推断生产迁移或公网权限已验证。

#### 文档语义复审（2026-10-27）

父审查发现公开文档仍混有已删除模型，不能仅凭链接检查证明 I-AC01。
本轮修正 8 份公开文档：删除 Root Ref domain 概念、旧 token 示例 claim、
domain revision/permission mismatch/负 balance 语义、`SpaceRefDomainClaim`、
`_legacy` sentinel 和不存在的兼容写 route；改为 App-global revision、
App/Space/hash 非负 projection、App/Space/requestId 幂等及显式 checkpoint。
HTTP 错误表补齐 `ROOT_REF_SNAPSHOT_CHANGED`。保留业务 domain、DNS 和
旧历史只读 archive/migration 说明，不以全文禁止 domain 一词代替语义检查。

`observability.md` 仅说明 `root_ref_domain` 是保留的历史 telemetry label，
对应 App-scoped Root Ref actor，不代表新的业务、授权、审计流或幂等维度；
未改任何 telemetry 字段或行为。

在 `packages\docs-site\tests\docs-site.test.mjs` 新增语义回归断言，检查当前
调用指南与架构页不再出现已删除契约，同时正向断言新 revision、projection、
幂等键、分页错误、无兼容写 route，以及 migration/archive 与历史 actor-kind
说明仍保留，并检查渲染后的架构页。

- `pnpm docs:check`：通过，8 tests（包含新增语义回归与既有链接/确定性构建检查）。
- `git --no-pager diff --check -- packages\docs-site`：通过。
- 本轮仅修改上述文档、文档测试与本 Implementation；未改源码、ideal、events，
  未提交。父 agent 已复现完整 boundary 检查为 164 通过、1 项既有 `stacks`
  目录断言失败；本轮未删除目录或修改、弱化该断言。

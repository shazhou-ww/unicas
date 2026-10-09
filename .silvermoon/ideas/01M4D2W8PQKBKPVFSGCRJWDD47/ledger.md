# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 将 App/Space schema 迁移移出运行时
- [x] **I-S02:** 合并 manifest metadata 与 content 读取
- [x] **I-S03:** 复用 file-root catalog snapshot
- [x] **I-S04:** 暴露安全的外层分段计时
- [x] **I-S05:** 将 Spaces placement 锁定到 APAC 数据面
- [x] **I-S06:** 锁定兼容性、运维和验证证据

### Implementation acceptance criteria

- [x] **I-AC01:** 普通 Space 请求不执行 schema migration
- [x] **I-AC02:** 目录读取只有一个 session/root lookup 和一个 manifest 边界
- [x] **I-AC03:** 授权、隔离和 API 兼容性保持不变
- [x] **I-AC04:** Server-Timing 有界且不泄露数据
- [x] **I-AC05:** Spaces 使用可回滚的显式 APAC placement
- [x] **I-AC06:** 候选通过窄测试和发布前检查

### Implementation evidence

- 协议与 client：`pnpm --filter @unicas/space-protocol test`（25 tests）、
  `pnpm --filter @unicas/space-client test`（5 tests）和
  `pnpm --filter @unicas/space-file-client test`（9 tests）通过。
- 服务与 Spaces：`node-read.test.ts`（5 tests）、`do.test.ts`（24 tests）、
  `worker.test.ts` 与 `schema.test.ts`（合计 23 tests），以及 Spaces 的
  `timing.test.ts`、`file-service.test.ts` 与 `worker.test.ts`（合计 28 tests）通过。
- 部署与文档：`pnpm exec vitest run tests/deploy-plan.test.mjs`（43 tests）和
  `pnpm docs:check`（7 tests）通过。
- 联合 typecheck：`@unicas/space-protocol`、`@unicas/space-client`、
  `@unicas/service`、`@unicas/service-cloudflare`、`@unicas/space-file-client`
  和 `@unicas/spaces` 全部通过。
- 发布前检查：`pnpm deploy:plan` 确认 `CAS_DB` migration 在 Worker 发布前；
  `pnpm deploy:spaces:plan` 完成 build 和 Wrangler dry-run；service Worker 在
  package build 后完成 Wrangler dry-run；Silvermoon worktree 与 staged 检查通过。
- 实现证据只证明候选行为、兼容性和可发布性。Smart Placement 尚未部署，APAC
  TTFB、Worker wall time 和 cold-request SLO 仍由 Deployment 世界的 canary
  验证；本阶段不声称生产延迟目标已经达成。
- 首次 production canary 的 31 次目录请求为 31/31 HTTP 200，TTFB p95
  741.8 ms、cold 1.620 s，但 Cloudflare Workers directory-only wall p95 为
  647.975 ms，超过 500 ms 门槛；CPU p95 仅 5.881 ms。该结果将候选重新带回
  Implementation，不能以 TTFB 或 `Server-Timing` 替代失败的 wall 证据。
- 补充候选让 `readSession()` 在同一条 `SPACES_DB` 查询中返回 0/1 root
  snapshot，并让 file service 直接打开该 snapshot；repository snapshot 测试和
  file-service call-count 测试证明常见目录路径不再调用 `listRoots()`。完整
  `@unicas/spaces` suite 67/67、package typecheck、docs 7/7 和
  `pnpm deploy:spaces:plan` 均通过。移除一个生产中约 220 ms 的 D1 网络边界是
  可验证的实现结果；新的 production wall SLO 仍留给后续 Deployment canary。
- 第二轮 production canary 证明 root snapshot 已生效：`spaces_root` 消失且
  `spaces_session` p95 降至 41–76 ms；但 warm TTFB p95 为 2020.5–2133.1 ms，
  `spaces_unicas` p95 为 1392–1474 ms，`cas_do` p95 最高 1467 ms。只读 D1
  metadata 同时确认 `unicas-spaces` 位于 ENAM、`unicas-tenant` 位于 APAC；
  因此 Smart Placement 优化了次要 session 边界，却让主导 CAS/DO 路径跨区。
- 显式 `aws:ap-southeast-1` 候选由 deployment config test 锁定；deploy-plan
  43/43、docs 7/7、Spaces package typecheck、`pnpm deploy:spaces:plan` Wrangler
  dry-run、Silvermoon worktree/staged/remote check 和 main CI
  `37869596238` 均通过。该证据只证明候选可发布，production SLO 仍必须由新
  promotion 后的 APAC canary 验证。

## Deployment

### Deployment steps

- [x] **D-S01:** 锁定发布候选和回滚基线
- [x] **D-S02:** 同步稳定契约并通过发布前门禁
- [x] **D-S03:** 通过受保护 release promotion 发布
- [x] **D-S04:** 执行 APAC authenticated directory canary
- [x] **D-S05:** 观察稳定性并执行失败回滚
- [x] **D-S06:** 发布外部证据并进入验收门禁

### Deployment acceptance criteria

- [x] **D-AC01:** production 对应受保护的精确发布
- [x] **D-AC02:** migration、发布和 canonical smoke 全部成功
- [x] **D-AC03:** APAC directory TTFB 达标
- [x] **D-AC04:** Worker wall time 与安全 timing 达标
- [x] **D-AC05:** controlled cold request 达标
- [x] **D-AC06:** 稳定性和回滚准备得到证明
- [x] **D-AC07:** 外部证据安全、完整且可复核

### Deployment evidence

- D-S01 / D-S02：以 Smart Placement Spaces version
  `809775fb-4ec0-41bd-b260-aaf9f9e3bf88` 为回滚基线；显式 APAC placement
  Implementation revision `e0f056dc9d40eee358668920db94d96f3a843f54`
  已验收并通过 deploy-plan 43/43、docs 7/7、Spaces typecheck、Wrangler
  dry-run、Silvermoon checks 和 main CI。
- D-S03 / D-AC01 / D-AC02：[#38](https://github.com/shazhou-ww/unicas/pull/38)
  生成 two-parent release `f6b91703e419509f3723acb340aeab7d60bcc0ba`；
  [workflow 37874444277](https://github.com/shazhou-ww/unicas/actions/runs/37874444277)
  完成 migration、service/Spaces publication、两个 canonical smoke、五个
  origin probe 和 immutable tag `production-20261009-589`。
- D-S04 / D-AC03 / D-AC04 / D-AC05：attempt 2 后的 31 次 SIN directory
  observation 为 31/31 HTTP 200；cold 1350.4 ms，warm TTFB p95 627.8 ms，
  warm Worker wall p95 470.346 ms。`spaces_session`、`spaces_unicas` 和
  `cas_do` p95 分别为 238/220/184 ms；无 `spaces_root`、`cas_schema` 或
  unsafe timing。
- D-S05 / D-AC06：最终 credential-only publication 于
  `2026-10-09T03:00:32Z` 完成；至 `03:15:44Z` 的五个 canonical origin
  均为预期状态且无 5xx。`unicas-spaces` 与 `unicas` metrics 均只有
  `success` outcome、各 2 requests、0 errors；Production protection 已恢复，
  无 active/waiting release run，未触发回滚。
- D-S06 / D-AC07：旧 synthetic credential 已返回 401，新 credential 只保留在
  Production environment；本地 DPAPI 密文和 canary 脚本已精确删除。完整 release、
  version、canary、metrics、stability 和 rollback disposition 已写入
  `outer/Evidence.md`。

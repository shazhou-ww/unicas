# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 将 App/Space schema 迁移移出运行时
- [x] **I-S02:** 合并 manifest metadata 与 content 读取
- [x] **I-S03:** 复用 file-root catalog snapshot
- [x] **I-S04:** 暴露安全的外层分段计时
- [x] **I-S05:** 用 Smart Placement 替代固定 IAD
- [x] **I-S06:** 锁定兼容性、运维和验证证据

### Implementation acceptance criteria

- [x] **I-AC01:** 普通 Space 请求不执行 schema migration
- [x] **I-AC02:** 目录读取只有一个 root lookup 和一个 manifest 边界
- [x] **I-AC03:** 授权、隔离和 API 兼容性保持不变
- [x] **I-AC04:** Server-Timing 有界且不泄露数据
- [x] **I-AC05:** 固定 IAD placement 已被可回滚候选替代
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

## Deployment

### Deployment steps

- [ ] **D-S01:** 锁定发布候选和回滚基线
- [ ] **D-S02:** 同步稳定契约并通过发布前门禁
- [ ] **D-S03:** 通过受保护 release promotion 发布
- [ ] **D-S04:** 执行 APAC authenticated directory canary
- [ ] **D-S05:** 观察稳定性并执行失败回滚
- [ ] **D-S06:** 发布外部证据并进入验收门禁

### Deployment acceptance criteria

- [ ] **D-AC01:** production 对应受保护的精确发布
- [ ] **D-AC02:** migration、发布和 canonical smoke 全部成功
- [ ] **D-AC03:** APAC directory TTFB 达标
- [ ] **D-AC04:** Worker wall time 与安全 timing 达标
- [ ] **D-AC05:** controlled cold request 达标
- [ ] **D-AC06:** 稳定性和回滚准备得到证明
- [ ] **D-AC07:** 外部证据安全、完整且可复核

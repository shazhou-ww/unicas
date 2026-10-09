# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 审计远端基线与有效保护设置
- [x] **I-S02:** 将远端完整验证收敛到 release 边界
- [x] **I-S03:** 实现 main exact-revision pre-push
- [x] **I-S04:** 提供显式且不覆盖用户配置的 hook 生命周期
- [x] **I-S05:** 固化 regression tests 与开发者责任边界
- [x] **I-S06:** 验证并发布 implementation 证据

### Implementation acceptance criteria

- [x] **I-AC01:** 普通更新不再触发完整远端 validation
- [x] **I-AC02:** release gate 仍是 authoritative 外部写入前置
- [x] **I-AC03:** pre-push 对精确 main revision fail closed
- [x] **I-AC04:** hook 生命周期跨配置来源可诊断
- [x] **I-AC05:** runner 基线与 settings 风险有持久证据
- [x] **I-AC06:** repository candidate 可重复验证且无外部写入

## Deployment

### Deployment steps

- [ ] **D-S01:** 发布并固定 Deployment contract
- [ ] **D-S02:** 读取 live workflow 与保护设置
- [ ] **D-S03:** 证明普通 main push 为零 hosted gate
- [ ] **D-S04:** 运行 exact-primary manual release preflight
- [ ] **D-S05:** 运行 exact-primary manual CodeQL proof
- [ ] **D-S06:** 核对无外部写入并发布证据
- [ ] **D-S07:** 失败时停止而不是削弱 gate

### Deployment acceptance criteria

- [ ] **D-AC01:** live trigger matrix 与已验收实现一致
- [ ] **D-AC02:** ordinary main push 不创建 CI 或 CodeQL run
- [ ] **D-AC03:** manual CI 对 exact primary 完成 release superset
- [ ] **D-AC04:** manual Security proof 保留独立 CodeQL
- [ ] **D-AC05:** required checks 与 environments 没有 stale 或弱化
- [ ] **D-AC06:** 外部证据可追溯且没有未经授权写入

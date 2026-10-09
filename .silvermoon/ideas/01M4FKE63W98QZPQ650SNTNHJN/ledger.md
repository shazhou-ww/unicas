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

- [ ] **D-S01:** Implementation 接受后制定 GitHub settings 与实测步骤

### Deployment acceptance criteria

- [ ] **D-AC01:** 外部 trigger 与保护状态可读取且不削弱 release gate

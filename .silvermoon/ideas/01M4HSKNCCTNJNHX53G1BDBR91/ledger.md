# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 实现 App-level capability transport
- [x] **I-S02:** 迁移高层 SDK 与 cache 组合
- [x] **I-S03:** 迁移第一方消费者与测试替身
- [x] **I-S04:** 更新公开文档与迁移说明
- [x] **I-S05:** 生成 0.2.0 release artifacts
- [x] **I-S06:** 验证并记录 implementation evidence

### Implementation acceptance criteria

- [x] **I-AC01:** 单一 App client 直接访问多个 Space
- [x] **I-AC02:** Capability 生命周期安全且可诊断
- [x] **I-AC03:** 高层 workflow 保持 Space 隔离
- [x] **I-AC04:** 第一方与文档 surface 完整迁移
- [x] **I-AC05:** 0.2.0 候选可重复构建

## Deployment

### Deployment steps

- [ ] **D-S01:** 固定 no-write Deployment 边界
- [ ] **D-S02:** 证明 accepted candidate 位于 primary
- [ ] **D-S03:** 生成只读 npm candidate plan
- [ ] **D-S04:** 审查第一方与文档 dry-run
- [ ] **D-S05:** 记录外部 no-write 证据

### Deployment acceptance criteria

- [ ] **D-AC01:** Accepted implementation 可从 primary 追溯
- [ ] **D-AC02:** 0.2.0 candidate plan 完整且无 registry 冲突
- [ ] **D-AC03:** Spaces 与 docs deployment plan 可执行
- [ ] **D-AC04:** 外部 publication 与 production 保持不变

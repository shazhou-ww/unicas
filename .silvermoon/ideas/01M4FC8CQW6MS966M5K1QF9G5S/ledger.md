# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 建立单一权威契约与兼容性边界
- [x] **I-S02:** 补齐二进制与 byte range 表达
- [x] **I-S03:** 机器化 capability 与 operation authority
- [x] **I-S04:** 对齐稳定 validation 与 error code
- [x] **I-S05:** 增加跨 surface drift 防护并验证候选

### Implementation acceptance criteria

- [x] **I-AC01:** readContent contract 完整且 wire 兼容
- [x] **I-AC02:** capability policy 只有一个权威来源
- [x] **I-AC03:** 稳定 validation 与 error 边界可审查
- [x] **I-AC04:** 自动 drift checks 覆盖全部表示
- [x] **I-AC05:** 候选保持 package boundary 与发布边界

## Deployment

### Deployment steps

- [ ] **D-S01:** Implementation 验收后制定部署步骤

### Deployment acceptance criteria

- [ ] **D-AC01:** 部署契约与已验收 Implementation 一致

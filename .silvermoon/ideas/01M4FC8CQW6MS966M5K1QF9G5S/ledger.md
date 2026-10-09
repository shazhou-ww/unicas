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

- [ ] **D-S01:** 固定已验收候选与无写入边界
- [ ] **D-S02:** 执行只读 artifact 与 deployment preflight
- [ ] **D-S03:** 记录公开状态与兼容性结论
- [ ] **D-S04:** 发布 Outer World 证据并请求验收

### Deployment acceptance criteria

- [ ] **D-AC01:** 候选与已验收 Implementation 可追溯
- [ ] **D-AC02:** 生成 artifact 与 dry-run 可交付
- [ ] **D-AC03:** 生产兼容性与公开文档状态准确
- [ ] **D-AC04:** 发布与 deployment authority 未扩大
- [ ] **D-AC05:** Outer World 证据完整且可安全审查

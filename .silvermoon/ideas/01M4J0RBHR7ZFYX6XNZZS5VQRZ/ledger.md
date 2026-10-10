# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 将部署资产归还 owning packages
- [x] **I-S02:** 建立 release ownership 与新 command namespace
- [x] **I-S03:** 收敛 local/Git tooling 并删除旧 roots
- [x] **I-S04:** 验证完整 candidate 并发布实施证据

### Implementation acceptance criteria

- [x] **I-AC01:** Repository target layout 完整落地
- [x] **I-AC02:** Deployable packages 独立拥有配置与工具
- [x] **I-AC03:** Release 与 local commands 原子切换
- [x] **I-AC04:** 产品、schema 与 release evidence 保持不变
- [x] **I-AC05:** Package 与 Agent boundaries 保持有效
- [x] **I-AC06:** Repository-wide validation 通过且无外部副作用

## Deployment

### Deployment steps

- [ ] **D-S01:** 发布并固定 Deployment contract
- [ ] **D-S02:** 读取 authoritative remote repository
- [ ] **D-S03:** 验证 remote commands 与 workflow consumers
- [ ] **D-S04:** 核对 publication 没有生产副作用
- [ ] **D-S05:** 发布 Deployment evidence
- [ ] **D-S06:** 失败时停止而不是扩大授权

### Deployment acceptance criteria

- [ ] **D-AC01:** Accepted implementation 可从 authoritative primary 到达
- [ ] **D-AC02:** Remote tree 与 approved ownership layout 一致
- [ ] **D-AC03:** Remote commands 与 workflows 使用新 ownership
- [ ] **D-AC04:** Repository publication 没有产品部署副作用
- [ ] **D-AC05:** 外部证据可追溯且可恢复

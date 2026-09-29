# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 收敛规范目录
- [x] **I-S02:** 保持包边界规则强制适用
- [x] **I-S03:** 记录技能所有权和更新路径
- [x] **I-S04:** 增加 Agent 资产守卫
- [x] **I-S05:** 验证可审阅候选

### Implementation acceptance criteria

- [x] **I-AC01:** `.agents` 是唯一规范根目录
- [x] **I-AC02:** 包边界约束仍然强制且完整
- [x] **I-AC03:** 技能来源和维护方式可重复
- [x] **I-AC04:** 目录回退会被自动阻止
- [x] **I-AC05:** 候选通过生命周期校验且不改变运行时

### Implementation evidence

- 2026-09-29：`pnpm check:agent-guidance` 通过，共 7 项聚焦测试。
- 2026-09-29：`pnpm exec vitest run tests/workspace-boundaries.test.mjs`
  通过，共 99 项既有包边界测试。
- 2026-09-29：`pnpm check:repo` 通过，共 148 项仓库测试，且其内含
  Silvermoon worktree snapshot 校验。
- 2026-09-29：`npx --yes skills list --json` 只从 `.agents/skills` 发现
  `business-data-model-review`、`silvermoon`、`ui-change-review`、
  `unicas-cli`、`unicas-observability` 和 `unicas-package-boundaries`；
  可发现 Agent 不包含 Claude。
- 2026-09-29：`git diff --check` 与
  `pnpm exec silvermoon check --staged` 均通过；候选没有运行时代码或部署配置
  变更。

## Deployment

### Deployment steps

- [ ] **D-S01:** 发布仓库规范
- [ ] **D-S02:** 验证远端规范和发现结果
- [ ] **D-S03:** 验证持续集成结果

### Deployment acceptance criteria

- [ ] **D-AC01:** 主分支提供唯一规范资产
- [ ] **D-AC02:** 主分支技能发现符合契约
- [ ] **D-AC03:** 远端自动化验证通过
- [ ] **D-AC04:** 没有运行时发布副作用

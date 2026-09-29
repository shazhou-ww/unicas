# Deployment

## Steps

### D-S01: 发布仓库规范

将已验收的 implementation 和本部署契约通过普通非 force 流程发布到
`origin/main`。本 Idea 只改变仓库 Agent 指导和检查，不运行 Worker、站点、
数据库或其他生产部署。

### D-S02: 验证远端规范和发现结果

在发布后的主分支提交上运行 Silvermoon remote snapshot 检查，确认 canonical
Agent 资产可从 `.agents/skills` 完整发现、包边界守卫可执行，且没有 Claude
compatibility projection。保留提交、命令和结果作为 ledger 证据。

### D-S03: 验证持续集成结果

等待发布提交的 GitHub Actions CI 完成，确认标准验证和 published Silvermoon
idea state 检查通过，且生产发布 job 没有因本次文档与守卫变更运行。失败时使用
后续普通修复提交，不回写已验收的内层世界或重写共享历史。

## Acceptance criteria

### D-AC01: 主分支提供唯一规范资产

刷新后的 `origin/main` 包含已验收 implementation、`.agents` 规范资产和本部署
契约，且不包含已删除的 provider-specific instruction。由 commit 可达性检查和
`pnpm check:ideas:remote` 证明。

### D-AC02: 主分支技能发现符合契约

`npx --yes skills list --json` 从 `.agents/skills` 精确发现六个预期技能；
`unicas-package-boundaries` 为 repository-owned，发现结果不依赖或声明 Claude
投影。由发布提交上的 CLI 输出证明。

### D-AC03: 远端自动化验证通过

发布提交对应的 GitHub Actions CI 成功，标准验证包含
`tests/agent-guidance.test.mjs` 和既有包边界检查，published Silvermoon idea
state 检查也成功。由 commit 对应的 GitHub Actions run 证明。

### D-AC04: 没有运行时发布副作用

本次发布只更新 Git 仓库内容，CI 中生产部署 job 保持跳过；没有修改或部署
Cloudflare Worker、站点、数据库或凭据。由提交路径清单和 CI job 结果证明。

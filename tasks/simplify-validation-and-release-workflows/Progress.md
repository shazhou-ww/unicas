# Progress

Updated: 2026-09-23

## Current state

已完成批准设计的实现与本地验证：普通交付统一到 `pnpm validate`，发布前门禁
使用严格超集 `pnpm validate:release`；生产、npm 发布和 Spaces 恢复的信任边界已分别
收敛。下一步是在 source publication 后取得 GitHub Actions 时间证据并集成主分支。

## Decisions

- 普通 CI 不保存独立命令清单；root scripts 拥有检查集合，workflow 仅拥有触发器、
  权限、environment、并发和精确 revision 编排。
- 受保护生产和 npm job 均从获批 revision 重新构建，不复用 PR、branch 或普通
  `main` 的可执行产物。
- npm 在一次完整 preflight 后仅对即将写入的包重新查询 registry；该必要重复用于
  安全重跑和检测发布序列中的状态变化。
- 已完成的 v1 issuer cutover 从生产执行图删除；Spaces bootstrap 只保留在独立
  手动恢复入口。

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | 用户于 2026-09-23 明确批准 `Task.md` 中的 Scope。 |
| Interface | Approved | 用户于 2026-09-23 明确批准 `ValidationMatrixReview.md`。 |
| Business and data model | Not applicable | 本任务只改变验证与发布编排，不改变业务概念、实体、关系、持久化 schema、数据生命周期或迁移。 |
| Architecture | Approved | 用户于 2026-09-23 明确批准 `WorkflowArchitectureReview.md`。 |
| Delivery acceptance | Pending | 等待对完成验证后的精确集成 revision 进行交付评审。 |

## Validation

- `pnpm exec vitest run tests/deploy-plan.test.mjs tests/npm-release.test.mjs`：51 项聚焦
  workflow、权限、恢复隔离、失败关闭及 npm 幂等测试通过。
- `pnpm validate`：repository policy、除慢速 Cloudflare adapter 外的 package
  tests、build 与 typecheck 通过；本地与普通 CI 使用同一命令。
- `pnpm validate:release`：严格超集通过，包括 Cloudflare adapter 与发布策略套件、
  确定性六包 artifact、文档浏览器测试、四个 deployment dry-run 和 release planner。
- `pnpm check:tasks` 与 `git diff --check`：通过；仅有仓库既有及当前 Delivery
  acceptance Pending 警告。
- 首次 source Actions run 发现 workflow 将 `DOCS_SOURCE_REVISION` 注入整个验证
  命令，导致本地默认环境与 CI 不一致；该变量已收窄到生产文档部署 step，并增加
  回归断言，等待修复 revision 的 Actions 复验。
- 结构对比：普通 `main` 从 19 个 functional steps 收敛到 checkout、secret scan、
  两项 setup、install、单一 `validate` 和独立 remote ledger check；npm 从两个 job、
  两次 install/build/full preflight 收敛到一个 10-step protected job、一次
  install/build/full preflight。实际 Actions runner 中位数需在候选提交后采集，不能
  由未提交本地实现伪造。

## Blockers

- None.

## Outcome

实现已覆盖批准的命令矩阵、生产与恢复隔离、单 npm protected job、失败关闭和稳定
文档；生命周期仍为 ongoing，尚未请求 Delivery acceptance。

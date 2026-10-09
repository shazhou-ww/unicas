# CI 与端侧保护现状盘点

证据日期：2026-10-09。

## 当前远端 trigger

| Surface | 当前 trigger | 当前行为 | 重复成本或必要性 |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` validation | 所有 branch push、所有 pull request、manual dispatch | 普通 revision 运行 `pnpm validate` | Silvermoon 多次同步到 `main` 会重复执行 |
| `.github/workflows/ci.yml` Silvermoon remote check | `main` push | `pnpm check:ideas:remote` | 与 Agent 同步后的显式 remote check 重复，但当前 tests 要求存在 |
| `.github/workflows/ci.yml` release validation | `release` push 或 manual dispatch | exact revision check 后运行 `pnpm validate:release` | authoritative release proof，必须保留 |
| `.github/workflows/ci.yml` production deploy | `release` push、显式 repository variable、validation success | protected rebuild 后部署与 smoke | 外部写入边界，必须保留 |
| `.github/workflows/security.yml` Dependency Review | pull request | 只审查 dependency diff | PR 专项证明，不由 main pre-push 替代 |
| `.github/workflows/security.yml` CodeQL | pull request、`main` push、weekly schedule、manual dispatch | JavaScript/TypeScript analysis | `main` push 与 Silvermoon 高频同步耦合；schedule/manual 可提供独立覆盖 |
| `.github/workflows/publish-npm.yml` | immutable SDK tag | protected rebuild、preflight、publish、provenance、registry verification | npm release 边界，必须保留 |
| `.github/workflows/recover-spaces.yml` | manual dispatch | 受保护 recovery | 与普通 CI 无关 |

## 当前本地保护

- 根 `package.json` 提供 `pnpm validate` 与严格超集
  `pnpm validate:release`。
- 仓库没有 `.githooks/`、`.husky/`、Lefthook、simple-git-hooks 或已声明的
  `core.hooksPath` 安装机制。
- `CONTRIBUTING.md` 要求贡献者在 PR 前运行 validation，但 Git push 不会
  自动执行或证明该命令。
- Git pre-push hook 从 stdin 获得
  `<local-ref> <local-object> <remote-ref> <remote-object>`；正确实现必须按
  remote ref 识别 `main`，而不是仅检查当前 branch。

## 已有可信 release 边界

- `release` revision 必须通过 `verify-release-revision.mjs`，与 authoritative
  `origin/main` 保持精确关系。
- production job 依赖 validation job、protected `Production` environment、
  serial concurrency、最小权限、部署后 smoke 和 immutable deployment tag。
- npm workflow 从 immutable tag 在 protected `npm` environment 中重建，
  使用 OIDC trusted publishing、provenance 与匿名 registry verification。
- branch/PR/main validation artifact 当前不会进入 production 或 npm
  publication。因此移除普通 main validation 不应改变 artifact trust boundary。

## Implementation 必须量化的基线

实施前应从 GitHub Actions 读取一个有代表性的时间窗，至少记录：

- 普通 branch、PR、`main`、release 与 scheduled workflow 的 run 数量；
- `main` 上由 Silvermoon lifecycle 同步产生的 run 数量；
- validation 与 CodeQL 的 runner duration、成功率和取消率；
- release candidate 在同一窗口的数量；
- 预计移除普通 push trigger 后节省的 runs/minutes。

实施后用相同口径证明普通 `main` push 不再运行完整 validation/CodeQL，
release candidate 与 schedule/manual 证明仍可执行。

## 外部配置未知项

当前身份读取 `repos/shazhou-ww/unicas/branches/main/protection` 返回 HTTP 404；
这不能证明 branch protection 不存在，也不能证明 required checks 为空。
Implementation 必须用有权限的只读方式确认实际 settings。若 required check
仍引用将被移除的 main/PR context，必须在 Deployment 中先审查迁移方案，避免
让合并或 release promotion 永久阻塞。

# Release-gated CI implementation evidence

证据日期：2026-10-09。

## 远端 workflow 基线

固定窗口为 `2026-09-09T07:03:05.613Z` 至
`2026-10-09T07:03:57.441Z`。读取 GitHub Actions REST API 的完整分页
workflow runs，并为每个 run 读取全部 jobs；runner 分钟按每个 completed job
的 `completed_at - started_at` 求和。没有用 workflow wall time 代替 runner
时间，也没有把首个 100-run page 当作完整样本。

### CI (`.github/workflows/ci.yml`)

| Event class | Runs | Runner 分钟 | 成功 | 失败 | 取消 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `main` push | 417 | 930.8 | 345 | 59 | 13 |
| 其他 branch push | 116 | 319.5 | 101 | 15 | 0 |
| pull request | 61 | 146.5 | 55 | 5 | 1 |
| `release` push | 30 | 137.7 | 20 | 8 | 2 |
| manual dispatch | 5 | 16.2 | 3 | 2 | 0 |
| **总计** | **629** | **1550.7** | **524** | **89** | **16** |

其中 display title 以 `idea:` 开始的 Silvermoon `main` 同步占 35 runs、
72.4 runner 分钟。这是保守子集：没有仅凭 Git activity 把其他 run 推断为
Silvermoon lifecycle 决定。

新 trigger matrix 会移除该历史窗口中普通 `main`、其他 branch 与 PR 的 594
个完整 CI runs、1396.8 runner 分钟；按原样本分别占 94.4% runs 和 90.1%
runner 分钟。未来实际净值仍需扣除 release/manual preflight 的真实频率，
不能把本估算当作 post-change 实测。

### Security (`.github/workflows/security.yml`)

| Event class | Runs | Runner 分钟 | 成功 | 失败 | 取消 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `main` push | 17 | 29.7 | 16 | 0 | 0 |
| pull request | 9 | 10.4 | 0 | 9 | 0 |
| **总计** | **26** | **40.2** | **16** | **9** | **0** |

一个 `main` run 在读取时尚无最终 conclusion。Silvermoon `main` 子集占 11 runs、
19.4 runner 分钟。新 matrix 删除普通 `main` CodeQL，保留 PR，并增加
`release`、weekly schedule 与 manual proof；因此这里只量化被移除的历史
`main` 成本，不声称新增 proof 为零成本。

## GitHub settings 只读审计

- 使用具有 repository admin read 权限的身份读取
  `repos/shazhou-ww/unicas/branches/main/protection`，GitHub 返回
  `404 Branch not protected`。
- repository rulesets 列表只有 active tag ruleset
  `Immutable production deployment tags`（ID `23425969`）；没有 branch
  target ruleset。
- 因而审计时没有 `main` required status check context 需要从已移除的
  CI/CodeQL trigger 迁移。此结论只描述读取时状态，不授权未来跳过 settings
  审计。
- Implementation 没有写入 branch protection、ruleset、environment、
  Actions variable/secret 或其他 GitHub settings。

## Repository deliverables

- `.github/workflows/ci.yml` 只接受 `release` push 与 manual preflight，并继续
  以 `pnpm validate:release` 保护 production dependency chain。
- `.github/workflows/security.yml` 不再接受 `main` push；Dependency Review
  仍只在 PR 运行，CodeQL 由 PR、`release`、weekly schedule 与 manual 触发。
- `.githooks/pre-push` 只定位 repository root 并调用
  `scripts/pre-push-main.mjs`；全部 ref/SHA/fail-closed 逻辑在 Node.js。
- `scripts/git-hooks.mjs` 提供显式 install/status/uninstall，且不覆盖已有
  local 或 inherited `core.hooksPath`。
- `tests/release-gated-ci.test.mjs` 与既有 deployment workflow tests 固定
  trigger、release dependency、multi-ref、exact SHA、dirty/non-HEAD、
  validation mutation/failure 和 config conflict 行为。

## 已执行验证

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/release-gated-ci.test.mjs tests/deploy-plan.test.mjs` | 通过：2 files，50 tests |
| `pnpm check:release-gated-ci` | 通过：1 file，7 tests；包含 validation 期间 HEAD/worktree 变化的 fail-closed 证明 |
| `pnpm hooks:status` | 按预期返回 `uninstalled` 和 exit 1；没有隐式安装或修改 Git config |
| `pnpm check:repo` | 通过：既有 6 files/165 tests 与独立 hook suite 1 file/7 tests |
| `pnpm validate` | 通过：repository checks、所有非 Cloudflare adapter package tests、workspace build 与 typecheck |
| `pnpm validate:release` | 通过：`pnpm validate` 严格超集、5 files/40 release-policy tests、29 files/268 Cloudflare tests、SDK artifacts、3 browser tests与四个 deployment dry-run |
| `pnpm exec silvermoon check --worktree --audience agent` | 通过 |

第一次 `pnpm validate` 把 I/O-heavy 临时 Git fixture 与既有 suites 放在同一
Vitest invocation，导致 `stack-tenant-retirement` 的 5 秒扫描测试在竞争下超时；
没有 assertion failure。`check:repo` 随后把新增 suite 保留在同一 gate 但改为
独立 Vitest invocation，未提高或放宽原测试 timeout。其后
`pnpm check:repo`、`pnpm validate` 和 `pnpm validate:release` 全部通过。

以上命令没有触发 release push、deployment、tag、npm publication 或 GitHub
settings 写入。staged snapshot、primary synchronization 与 remote check 在候选
收口时追加。

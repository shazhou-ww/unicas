# Release-gated CI deployment evidence

证据日期：2026-10-09。

## 固定合同与观测范围

- Deployment contract revision:
  `523cc3e08d341740c78b197fd934372c6acf27fb`
- Contract primary commit:
  `52a2088e0c4275f59438feb2e176ba238ced12f7`
- dispatch 前观测时间：`2026-10-09T07:24:32.0347108Z`
- dispatch 后观测时间：`2026-10-09T07:42:36.1555832Z`

两个 manual proofs 均以 `main` 上的 contract primary commit 为 exact head SHA。
没有推送 `release`，因为该 branch 是 production trigger；release event 的 live
trigger/condition 由 GitHub default-branch workflow 读取证明，release superset
本身由 non-writing manual CI run 证明。

## Live workflow 与 settings

GitHub Actions API 返回以下 active workflows：

| Workflow | ID | State | Live trigger |
| --- | ---: | --- | --- |
| **CI** | `357581163` | `active` | `release` push、`workflow_dispatch` |
| **Security** | `379256341` | `active` | pull request、`release` push、weekly `17 3 * * 1`、`workflow_dispatch` |
| **Publish npm package** | `364071822` | `active` | 本部署未修改或触发 |

live content 来自 GitHub Contents API 的 default-branch `main`，不是本地 YAML
替代品。CI 没有 ordinary branch、PR 或 `main` trigger；Security 没有 `main`
trigger。Dependency Review 仍以 job condition 限定为 pull request。

设置在 proof 前后读取结果一致：

- `main` branch protection API 返回 `404 Branch not protected`，因此没有
  required status check context，也没有 stale `validate`/CodeQL context 可迁移。
  本结果只记录事实，不把不存在的保护描述为成功写入。
- 唯一 repository ruleset 是 active tag ruleset
  `Immutable production deployment tags`（ID `23425969`），target 为 `tag`，
  include `refs/tags/production-*`，禁止 `update` 和 `deletion`。
- `Production` environment 仍有 `required_reviewers` 与 `branch_policy`；
  custom policies 精确允许 `main` 和 `release`。
- `npm` environment 仍有 `required_reviewers`。
- 本 Deployment 没有调用 settings mutation API，也没有读取 secret value。

## Ordinary main push 证明

按 exact SHA 查询 CI/Security runs：

| Primary SHA | 用途 | `event=push` CI/Security runs |
| --- | --- | ---: |
| `b863525a3dfa01f3d3c563dcba22273c30d5f1ec` | Implementation publish | 0 |
| `ee8f4b217c4b38313c2507c0b7086b31f0eb1a78` | Implementation evidence publish | 0 |
| `7dd8c5f278717303a803ff67453b912e28e956f3` | Implementation acceptance publish | 0 |
| `52a2088e0c4275f59438feb2e176ba238ced12f7` | Deployment contract publish | 0 |

contract SHA 后来出现的两个 runs 均为本合同明确触发的
`workflow_dispatch`，不是 main push。四个真实 primary pushes 因而产生零次
完整 CI/CodeQL hosted gate。

## Manual release-superset proof

- Run: [CI 37898888489](https://github.com/shazhou-ww/unicas/actions/runs/37898888489)
- Attempt: `1`
- Event/ref/head: `workflow_dispatch` / `main` /
  `52a2088e0c4275f59438feb2e176ba238ced12f7`
- Conclusion: `success`
- `validate`: `success`，job ID `113716558582`，`970` 秒
- `Run release validation`: `success`
- `Deploy production`: `skipped`
- `Tag verified production deployment`: `skipped`

run log 在 `2026-10-09T07:38:19Z` 显示执行
`pnpm validate:release`，随后运行 `pnpm validate`、release-policy suites、
Cloudflare tests、SDK artifacts、browser tests 和 deployment dry-runs。
`Verify release revision` 在 manual `main` preflight 中按 condition skipped；
live workflow 仍把该 exact-revision step 限定给真实 `release` ref。manual run
没有获得 production/tag 可达性。

## Manual CodeQL proof

- Run: [Security 37898901324](https://github.com/shazhou-ww/unicas/actions/runs/37898901324)
- Attempt: `1`
- Event/ref/head: `workflow_dispatch` / `main` /
  `52a2088e0c4275f59438feb2e176ba238ced12f7`
- Conclusion: `success`
- `CodeQL`: `success`，job ID `113716598647`，`119` 秒
- `Dependency review`: `skipped`

CodeQL 的 checkout、initialize 和 analyze steps 均成功；Dependency Review 因
非 pull request 正确 skipped。live weekly schedule、manual 和 `release`
trigger 保持可读，未由 pre-push 替代。

## 无外部写入对比

dispatch 前存在一个并发但不属于本 idea 的
[Deploy documentation 37898791556](https://github.com/shazhou-ww/unicas/actions/runs/37898791556)：
它在 `2026-10-09T07:24:02Z` 由 `workflow_dispatch` 创建
`Production` deployment `6955303820`，随后 cancelled，deployment status 从
`waiting` 变为 `error`。该 run 早于本合同 proof dispatch，且不是
CI/Security run，因此没有把它误记为本部署结果。

从第一个 proof 的 `2026-10-09T07:25:03Z` 到 post snapshot：

| Surface | dispatch 前 | dispatch 后 |
| --- | --- | --- |
| 新 `Production` deployments | 基线已固定到 deployment `6955303820` | 0 |
| production tags | 18；最新 `production-20261009-589` | 相同 |
| latest npm run | `37751689281`，SHA `20641ce349ee913bb35caab622c14becbc71a95c` | 相同 |
| `release` ref | `f6b91703e419509f3723acb340aeab7d60bcc0ba` | 相同 |
| branch/ruleset/environment 摘要 | 上述 live settings | 相同 |

因此两个 manual proofs 没有 deployment、tag、npm publication 或 settings
mutation。

## 结论与恢复判断

所有 external proofs 与固定合同一致，不需要恢复动作。普通 main push 为零
hosted gate；manual CI 在 exact primary 上完成完整 release superset；manual
Security 保留独立 CodeQL；production/npm trust boundary 与 immutable tag
保护未弱化。

若未来 proof 失败，应保留 immutable run/log，停止 Deployment acceptance。
workflow 实现缺陷必须形成新 Inner World implementation revision 并重新验收；
settings 问题必须先记录前后状态和恢复方案。不得通过删除
`pnpm validate:release`、放宽 environment 或把 `--no-verify` 当作证明恢复。

## Evidence 发布

- `pnpm exec silvermoon check --worktree --audience agent`：通过。
- `pnpm exec silvermoon check --staged --audience agent`：通过。
- evidence commit:
  `858a4da0825f163372279cf2f51029875256f15c`
- concurrent primary 通过普通 merge 保留后，evidence 由 primary commit
  `797e5dc53d58642a76e8f604150e16dd85d9ce30` 发布。
- evidence commit 可从 refreshed `origin/main` 到达。
- `pnpm check:ideas:remote`：通过，remote
  `797e5dc53d58642a76e8f604150e16dd85d9ce30`。
- GitHub Actions 对该 primary SHA 的 CI/Security 查询为 0 runs，继续符合
  ordinary main push 零 hosted gate。

最终 ledger 收口仍需通过 worktree/staged checks、同步到 refreshed primary 并
重新观测精确 deployment revision。

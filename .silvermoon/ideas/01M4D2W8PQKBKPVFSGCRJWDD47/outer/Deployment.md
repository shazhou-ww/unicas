# Deployment

## Steps

### D-S01: 锁定发布候选和回滚基线

以已验收的 Implementation revision
`ed42de517d1694ac17e8c68aab471cebf04aa929` 和实现 commit
`65605f2073e63623699ec8f235b221709f85ff92` 为代码基线。发布前记录当前
production tag、`release` tip、`unicas` 与 `unicas-spaces` 的已知良好 Worker
version，以及 Spaces 的固定 IAD placement 回滚基线。确认没有并发 production
workflow，tenant baseline migration 是 additive 且旧 Worker 可继续读取迁移后的
schema。证据只记录 revision、version、时间窗口和有界状态，不记录凭据、Principal、
Space、路径或响应内容。

### D-S02: 同步稳定契约并通过发布前门禁

先将本 Deployment 契约、同世界证据模板和 ledger 同步到 `main`，再通过
`silvermoon whats-next` 取得稳定 `deploymentRevision`，后续所有生产动作均针对
该 revision。确认 worktree clean，运行 Silvermoon worktree/staged/remote 检查、
`pnpm deploy:plan` 和 `pnpm deploy:spaces:plan`；发布候选不得包含契约同步之后的
未知实现变更。

### D-S03: 通过受保护 release promotion 发布

使用从 `main` 到 `release` 的普通 GitHub promotion pull request，并保留
two-parent merge commit；不得直接移动 `release`、force-push 或用本地紧急命令
替代正常发布。等待 release CI 的 `pnpm validate:release` 与 `Production`
environment，通过后由 workflow 依次应用 `CAS_DB` migration、发布 service、
运行 canonical App/Space smoke、发布 Spaces 并运行 file smoke，再发布和验证
product 与 docs。记录 promotion PR、workflow run、release merge SHA、production
tag 和各动态 Worker version。

### D-S04: 执行 APAC authenticated directory canary

在 production workflow 成功后，从选定的 APAC 浏览器探针执行一个部署后首个
authenticated `/api/entries?path=/` 请求并记录为 cold observation，随后执行至少
30 次有界、顺序、`cache: no-store` 的 authenticated directory read。探针只读取
HTTP status、TTFB、固定 `Server-Timing` 数值、`CF-Ray` colo 和 placement header；
不保留 cookie、响应 body、目录项、路径标识符或其他账户数据。

报告 TTFB 的 p50/p95/p99/max，并从同一时间窗口的 `unicas-spaces` Workers metrics
报告 response-construction wall 的 p50/p95/p99/max、错误率和请求量。分别汇总
`spaces_session`、`spaces_root`、`spaces_manifest`、`spaces_unicas`、
`cas_auth`、`cas_do`、适用的 `cas_d1_*`/`cas_r2_*` 与 `cas_edge`；不得把
response-construction timing 描述为完整流传输时间。

### D-S05: 观察稳定性并执行失败回滚

canary 后保持至少 15 分钟观察窗口，确认所有 public origin、canonical smoke、
Worker invocation outcome、CPU/wall time 和 5xx 趋势无回归。任一目录 SLO、smoke、
origin 或安全 timing 条件失败时，在请求 Deployment 验收前回滚：Smart Placement
失败优先把 Spaces Worker 恢复到记录的已知良好 version；service 或协议回归则按
docs、site、Spaces、service 的逆发布顺序回滚已变更单元。D1 migration ledger
不回滚；已接受 baseline 必须保持旧 Worker 兼容。回滚后重跑 smoke、origin probe
和 APAC canary，不在失败版本上继续观察以代替回滚。

### D-S06: 发布外部证据并进入验收门禁

将 release、migration、smoke、production tag、Worker version、APAC canary、
Workers metrics、观察窗口和任何 rollback 结果的有界摘要写入同世界
`Evidence.md`，并在 ledger 勾选具有完整证据的 D-S/D-AC 项。同步最终候选到
`main`，通过 Silvermoon remote 检查并重新取得 exact `deploymentRevision`；
只有用户明确验收该 revision 后才记录 `deploymentAcceptedRevision`。

## Acceptance criteria

### D-AC01: production 对应受保护的精确发布

release revision 是验证通过的 two-parent promotion merge，其 main parent 可从
当前 `origin/main` 到达且 release tree 与该 main parent 相同；成功 workflow
创建的 immutable `production-YYYYMMDD-*` tag 指向该 revision。以 GitHub PR、
workflow run、release SHA 和 tag 证明。

### D-AC02: migration、发布和 canonical smoke 全部成功

`CAS_DB` migration 在 service publication 前成功应用，随后 service smoke、
Spaces file smoke 和五个 public origin probe 全部通过；正常 production Space
请求不再报告 `cas_schema`。以 workflow step 结果、migration 输出的无敏感摘要、
production tag 和一个 bounded Space response header 证明。

### D-AC03: APAC directory TTFB 达标

至少 30 次成功的 authenticated APAC `/api/entries` 读取得到完整
p50/p95/p99/max，TTFB p95 不超过 1 秒且没有非 2xx 或响应结构错误。以同一探针、
同一 bounded 时间窗口的统计摘要证明。

### D-AC04: Worker wall time 与安全 timing 达标

同一 canary 窗口内 `unicas-spaces` response-construction wall p95 不超过
500 ms；固定 timing 分段能解释主要等待，header 中没有未知名称、description、
标识符、路径、URL、SQL 值、凭据或内容。以 Workers metrics 和经过 allowlist
归一化的 Server-Timing 汇总证明。

### D-AC05: controlled cold request 达标

部署后首个 APAC authenticated directory observation 不超过 2 秒，并记录观察时间、
colo 和 placement；不得以热请求替代该证据。若无法证明请求为部署后首个 observation，
该标准保持未完成并重新安排受控 cold canary。

### D-AC06: 稳定性和回滚准备得到证明

发布后至少 15 分钟内 canonical smoke、public origin、Worker outcome 和 5xx 趋势
无回归，且已记录变更单元的已知良好 version。若触发 rollback，回滚后的 smoke、
origin 和 APAC canary 必须重新通过；若未触发，证据明确记录阈值均未命中。

### D-AC07: 外部证据安全、完整且可复核

`Evidence.md` 包含 release、tag、version、migration、smoke、canary、metrics、
观察窗口和 rollback disposition，并明确区分浏览器 TTFB、Worker
response-construction wall 与完整传输时间。文件和 ledger 不包含 secret、cookie、
token、Principal/Space ID、目录项、路径或响应内容；最终候选通过 Silvermoon
worktree、staged 和 remote 检查。

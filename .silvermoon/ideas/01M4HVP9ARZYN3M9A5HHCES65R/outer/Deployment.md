# Deployment

## Steps

### D-S01: 固定切换与恢复条件

在任何外部写入前明确目标环境、授权、备份、写入栅栏、issuer/client 切换顺序、
观察窗口、回滚边界和保留期限。先完成部署计划或 dry-run 审查；
不得默认修改冻结的旧环境或发布 npm 包。

实施已提供本地 SQLite 只读检查和生成迁移副本工具：
`release\service\migrate-root-refs.mjs`；`0002_app_root_refs.sql` 仅创建 schema，
不是生产数据切换。部署前还必须在明确目标环境演练 D1 的 snapshot
导出、迁移副本导入/恢复和大小限制，并在同一写入栅栏内逐项核对 aggregate。
Spaces App 须先应用 `0003_remove_ref_domain.sql`，再使用新 bootstrap/preflight。
Cloudflare 的历史 DO class/binding 名保留，新的 actor key 仅含 App；
旧 writer 必须停止，不能在两种 key 下并行写入。

用户已授权现有 Production 通道。服务与 Spaces dry-run、隔离演练及真实 D1
备份的只读迁移计划已通过；实际变更仍须通过原有 Production 审批。
Root Ref 停写窗口仅在审批后的受保护 job 内开始，archive 与桥接记录保留且
不设新 TTL。准入条件、风险与预检证据见 [部署准入与预检](./Readiness.md)。
本步骤在完整 CI、审批和实际切换条件齐备前保持未完成。

### D-S02: 执行受控迁移并验证

在获得相应发布及数据变更授权后，对目标环境执行 reconciliation、
checkpoint、迁移和服务切换，以真实调用验证读写、审计及幂等；
发现漂移或冲突时停止，不用成功形态的默认值继续。

Production job 在验证精确 release 修订后、任何 secrets put 或 Worker 发布前，
执行 [cutover runner](../../../../release/service/cut-over-root-refs.mjs)。
runner 默认只输出计划，只有该受保护 job 中显式 `--production` 才执行变更；
它复用已验证的离线校验和迁移规则，设置旧 writer 栅栏、建立恢复书签与私有
snapshot、迁移新 projection/checkpoint/桥接，并在完整核验后最后写 marker。
已有 marker 时只做一致性与约束核验，不覆盖新流。执行失败须明确保留或恢复
可证明安全的 writer 状态，不直接恢复旧 snapshot 丢弃其他已接受写入。

### D-S03: 退出兼容并完成归档交接

在约定窗口核实 issuer 已停止签发旧 claim、旧 endpoint 无使用，
验证恢复能力与 archive 可读性；达到保留和审计条件后才清理兼容及遗留存储。

archive 与 replay 的保管责任角色为 Production 环境维护者；当前继续保留，
不新增 TTL 或清理期限。观察窗口暂不指定，因此本步骤与外层验收保持未完成。
只有另行明确窗口、退休与审计政策并取得使用证据后，才评估清理；不从上线、
保管角色确认或部署审批推断兼容退休、删除授权或外层验收。

### D-S04: 完成隔离本地迁移恢复演练

使用 [本地演练脚本](./Rehearse-local.mjs) 和全合成数据，验证 Wrangler 本地
D1 的 SQL 导出、离线迁移副本导入及首次新写入前的备份恢复，并通过本地 HTTP
请求检查实际 Space/App actor 调用、重放、审计和失败回滚。脚本仅使用新建的
临时本地存储，禁止 remote 操作；这不能替代目标环境的 D-S01 至 D-S03。

## Acceptance criteria

### D-AC01: 切换不改变保留状态

目标环境切换前后逐项 aggregate 一致，新流 checkpoint 与旧 ledger archive
可追溯；以脱敏 reconciliation 结果、备份及迁移记录证明。

### D-AC02: 新契约在目标环境成立

跨 Space 的 Root Ref 操作、App 审计和相同/不同 payload 重放符合新契约，
相关第一方消费者正常；以 smoke 结果及观察窗口内的运行证据证明。

### D-AC03: 兼容退休与恢复边界清晰

旧 claim 和 endpoint 退休有使用证据，归档保留及清理有明确责任和期限，
恢复流程在约定边界内可执行；以使用核验、归档记录和恢复演练证明。

### D-AC04: 本地转移与恢复链路可重复

演练退出成功，逐项 aggregate 不变，源 snapshot 未改，旧请求桥接和 archive
写保护跨 SQL 转移保留；真实本地 HTTP 请求验证 App-global revision、跨 Space
幂等、分页失效和整批回滚。以脚本结构化结果证明，不推断生产可用性。

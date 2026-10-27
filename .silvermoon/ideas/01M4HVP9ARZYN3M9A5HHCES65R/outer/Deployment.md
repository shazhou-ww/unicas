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

当前默认配置仅提供生产候选，不构成目标选择或执行授权。服务和 Spaces
本地构建/dry-run 已通过；真实数据与恢复演练、维护窗口、保留期限和负责人
尚未确定。准入条件、观察到的目标和预检证据见 [部署准入与预检](./Readiness.md)。
这些条件齐备前保持本步骤未完成，不执行 remote D1 或生产发布。

### D-S02: 执行受控迁移并验证

在获得相应发布及数据变更授权后，对目标环境执行 reconciliation、
checkpoint、迁移和服务切换，以真实调用验证读写、审计及幂等；
发现漂移或冲突时停止，不用成功形态的默认值继续。

### D-S03: 退出兼容并完成归档交接

在约定窗口核实 issuer 已停止签发旧 claim、旧 endpoint 无使用，
验证恢复能力与 archive 可读性；达到保留和审计条件后才清理兼容及遗留存储。

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

# 一致性与切换设计

## 存储与竞争

- Space actor 继续保护节点、lease、child references 和 GC；Root Ref 提交按 App
  路由到一个审计 actor。锁顺序只允许 Space → App，不能反向调用。
- aggregate delta、App revision CAS、projection、event 和 request record 必须在同一个
  D1 batch 中提交。revision CAS 失败必须触发 SQL 约束错误并回滚整个 batch，
  不能用无变化的 UPDATE 后继续写入。有界重试重新读取请求与状态。
- revision 表示 App 审计顺序，不代表跨 Space 的物理请求到达顺序。
- Cloudflare 的历史 class/binding 名和既有 allowlisted actor-kind 保留，
  但新 actor key 仅含 App；这不是 default domain 或隐藏的业务别名。
  没有改变 telemetry 字段、采样、export 或持久化策略。
- projection cursor 绑定 App、Space filter 和 revision；分页前后检查 revision，
  后续页遇到变化返回 snapshot-changed，不拼接不同状态。事件按 revision watermark
  有界读取，Space filter 的空页也推进 watermark。

## 离线迁移与重放桥接

切换须有外部写入栅栏和一致备份；本实现不授权实际生产操作。
迁移逐项比较旧 domain projection 总和与每个节点的权威 aggregate，并检查孤立
projection；任何漂移都终止，不更新 aggregate。

旧请求按 App+Space+requestId 分组。任何跨 domain 重复 identity 都阻止切换，
包括相同 payload：它可能已执行多次，不能静默选一条或折叠历史。须在切换前
人工调查、约定调用方停止重试或另行提供经审查的处置；工具不自动修复。
唯一旧请求保留 payload hash 和原 revision 作为重放桥接；重放不执行 delta，
异 payload 冲突。桥接 provenance 属于只读 archive，不伪造新 event。

新流 checkpoint 取每个 App 的旧 revision 最大值，明确只是数值高水位，不是
旧历史的全序。新事件从 checkpoint+1 开始；旧事件保持原 domain/revision，
只读归档。新 projection 从通过核对的权威 aggregate 建立。

## 回滚与外部前提

首次新写入前可以在写入栅栏内恢复完整备份与旧服务；首次新写入后不能直接
启动旧 writer，因为旧 projection 和 ledger 已冻结。此后只能 forward-fix 或
在停止写入后执行另行审查的逆迁移，不能丢弃新事件恢复旧快照。
目标环境、授权、观察窗口、archive/request retention 与兼容退出日期均由部署
阶段确定，不在实现阶段猜测。旧 v2 claim 暂时作为未知字段忽略；不能进入授权、
转发或幂等键。issuer 停发与旧 endpoint 零使用证据齐备后退出兼容。

## 已有模型渲染证据

父 agent 已在 GitHub 固定提交 `a52cf645d029` 渲染检查 accepted Model-review.md：
关系与基数可见，布局无交叉问题。GitHub 将 ROOT_EVENT 的 `&lt;&lt;AO&gt;&gt;`
显示为 `<>`，AO 字样丢失；生命周期表仍明确 append-only。accepted ideal 未修改。

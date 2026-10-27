# 部署准入与预检

## 当前结论

实现已验收，部署尚未完成。本地构建与打包检查通过，但没有目标环境的
snapshot、迁移/恢复演练或在线 smoke 证据，不能提交 `submitOuter`。
所有 `D-*` 保持未完成；本页不是生产迁移、发布或 archive 清理授权。

## 配置中观察到的候选目标

| 单元 | 仓库默认配置 | 尚未确认 |
| --- | --- | --- |
| service | Worker `unicas`；`api.unicas.work`、`console.unicas.work`；Root Ref 使用 `CAS_DB` / `unicas-tenant` | 是否选择此生产目标、执行授权和维护窗口 |
| Spaces | Worker `unicas-spaces`；`spaces.unicas.work` | 生产 D1 绑定与 issuer/smoke 配置；模板使用占位值，不能直接发布 |
| 冻结旧环境 | `unicas.shazhou.work` | 不在本次范围内，不访问或修改其资源 |

来源为服务的 `wrangler.toml`、Spaces 的 `wrangler.jsonc` 和现有 release
orchestrators；未查询线上账号、配置或客户数据。配置中的生产路由不等于选择
或授权该目标，也没有推断存在一个资源隔离的 staging 环境。

## 本地预检证据（2026-10-27）

| 精确命令 | 结果与边界 |
| --- | --- |
| `pnpm release:service:plan` | 通过；只打印命令，不构建、不上传、不执行 remote D1 |
| `pnpm --filter @unicas/service-cloudflare build` | 通过；既有 Vite sourcemap 警告不阻断 |
| `pnpm --filter @unicas/service-cloudflare exec wrangler deploy --dry-run` | Wrangler 4.123.0 打包通过，退出于 dry-run，没有上传 |
| `pnpm release:spaces:plan` | Spaces 构建和 Wrangler dry-run 通过；使用模板配置，不证明生产参数有效 |

服务计划包含 remote schema migration 与部署命令，但打印计划不等于执行。
`0002_app_root_refs.sql` 只建 schema；不能以普通发布顺序替代数据切换。
打包成功不证明远程资源可访问，也不证明线上权限、数据一致性或恢复能力。

## 外部执行前必须确定

1. **目标与授权**：生产或明确隔离的非生产环境、负责人、维护窗口，以及
   允许的读写操作。生产数据导出、导入、服务切换均需明确授权；npm 发布不包含
   在服务部署授权中。
2. **写入栅栏与备份**：停止所有旧/new writer，验证停写并生成一致 snapshot；
   snapshot 只进入受控且不纳入 Git 的位置。确定备份保管人与恢复目标，
   在所选环境验证 D1 导出/导入格式、限制与完整恢复步骤。
3. **迁移准入**：对该 snapshot 运行只读 plan，逐项核对 aggregate，拒绝
   projection 漂移、孤立 row、旧请求碰撞或不完整历史；演练迁移副本转移，
   确认 checkpoint、旧请求重放桥接和 archive 写保护未丢失。
4. **生命周期政策**：确定 archive 与 replay 记录的保留期限、责任人、
   观察窗口及旧 claim/endpoint 退休条件。不能自行缩短已有重放保障，
   不能在观察与保留期证据不足时清理旧存储。

## 受控切换顺序

在上述条件齐备并完成本契约对应的演练后，保持写入栅栏，验证目标数据迁移，
再切换 service；不得让两代 actor key 下的 writer 并行写入。
服务具备新契约后，先应用 Spaces 的 `0003_remove_ref_domain.sql`，再切换其
issuer/client 与 Worker。旧 v2 claim 在过渡期仅被忽略，不改变权限或幂等。

执行真实跨 Space read/update、App 审计与同/异 payload replay smoke，
保留脱敏核验结果；条件满足后解除栅栏并进入约定观察窗口。
首次新写入前可在栅栏内恢复完整备份与旧服务；首次新写入后只能 forward-fix
或执行另行审查的逆迁移，不能恢复旧快照丢弃新事件，也不能单独回滚旧 writer。

观察窗口、issuer 停发证明、旧 endpoint 使用核验、归档恢复演练和保留期限
未满足前，不完成 `D-S03` 或 `D-AC03`。只有真实外部结果满足全部部署标准，
才记录 `submitOuter` 并请求精确部署修订的验收。

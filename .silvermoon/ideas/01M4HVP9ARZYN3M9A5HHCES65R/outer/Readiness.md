# 部署准入与预检

## 当前结论

先前实现修订已验收；本地演练引出的重试修正须重新实现验收，部署尚未完成。
本地构建与打包检查通过，但没有目标环境的
snapshot、迁移/恢复演练或在线 smoke 证据，不能提交 `submitOuter`。
隔离合成数据演练的 `D-S04`、`D-AC04` 已完成，其余 `D-*` 未完成；
本页不是生产迁移、发布或 archive 清理授权。

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

## 隔离本地演练结果（2026-10-27）

命令：
`node .silvermoon\ideas\01M4HVP9ARZYN3M9A5HHCES65R\outer\Rehearse-local.mjs`。
最终完整运行成功，输出 `outcome=local-rehearsal-passed`：

- Wrangler 本地 D1 导出 SQL，转换成离线 snapshot，执行只读 plan 与迁移副本，
  再以 SQL 导入另一独立本地 D1；源文件 digest 不变。
- 两个 Space 的原 aggregate 与首次新写入前恢复的 aggregate 均为 `[2,3]`；
  checkpoint 为 1，没有为旧事件伪造新的全局顺序。12 个 archive 写保护
  trigger 跨 SQL 导入保留。
- 在独立 workerd 实例中加载同一迁移 SQL，通过真实 loopback HTTP 调用
  Space/App DO，验证旧请求重放、跨 Space 同 requestId、新 revision
  `[2,3,4,5]`、审计分页失效和写入后的 aggregate `[5,5]`。
- 故障注入得到 503，最近一次记录响应为 387ms，满足小于 10 秒的断言；
  aggregate、revision 和事件整批回滚，解除故障后的请求正常推进。
  旧 archive 和新 append-only ledger 的删除均被拒绝。
- 进程结束时释放 HTTP/runtime 并清理其自建临时目录。Cloudflare
  remote 操作为 0，未读取或迁移真实客户数据。

初次打包发现 Windows esbuild 不接受 `file:` import，已修正为绝对文件路径。
随后真实 DO 故障请求超时，进一步定位到实现中显式 `undefined` 覆盖默认
重试上限。该缺陷已在内层实现修复，并通过先失败后通过的回归测试和本演练
再次验证；修订后的实现需重新走精确版本验收，不能把此结果当作已部署。

本地 HTTP harness 注入的是合成可信身份，未覆盖公网 capability 校验、
真实生产账号、资源访问、数据量限制、维护栅栏或保留期。因此它只满足
`D-S04` 和 `D-AC04`，不能满足目标环境的 `D-AC01` 至 `D-AC03`。

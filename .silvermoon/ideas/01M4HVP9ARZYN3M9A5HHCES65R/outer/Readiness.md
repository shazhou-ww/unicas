# 部署准入与预检

## 当前结论

重试修正版 `implementationRevision=b5d1b077bd5e` 已明确验收并同步到 primary，
部署尚未完成。用户现已明确授权通过现有 Actions 通道发布并验证。
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
再次验证；修订后的实现已单独完成精确版本验收，不能把此结果当作已部署。

本地 HTTP harness 注入的是合成可信身份，未覆盖公网 capability 校验、
真实生产账号、资源访问、数据量限制、维护栅栏或保留期。因此它只满足
`D-S04` 和 `D-AC04`，不能满足目标环境的 `D-AC01` 至 `D-AC03`。

## 发布执行通道检查（2026-10-27）

只读调用现有 service 环境校验函数，并核对 Spaces 生产配置清单；
没有生成生产 secrets 文件、输出密钥值或执行部署。当前进程缺少：

| 单元 | 缺失名称 |
| --- | --- |
| service smoke | `UNICAS_SMOKE_APP_ID`、`UNICAS_SMOKE_ISSUER`、`UNICAS_SMOKE_AUDIENCE`、`UNICAS_SMOKE_KID`、`UNICAS_SMOKE_KEY_FILE` |
| service OAuth | `OAUTH_GOOGLE_CLIENT_ID`、`OAUTH_MICROSOFT_CLIENT_ID`、`OAUTH_GITHUB_CLIENT_ID` |
| Spaces 配置 | `SPACES_D1_DATABASE_ID`、`SPACES_GOOGLE_CLIENT_ID`、`SPACES_SIGNING_KID`、`SPACES_SIGNING_PUBLIC_JWKS`、`SPACES_SMOKE_PRINCIPAL_ID`、`SPACES_UNICAS_AUDIENCE` |
| Spaces secrets | `SPACES_GOOGLE_CLIENT_SECRET`、`SPACES_SIGNING_PRIVATE_KEY_PKCS8`、`SPACES_SMOKE_CREDENTIAL` |

同时尝试核对标准 GitHub Actions 执行通道，命令只请求名称，不读取秘密值：

| 精确命令 | 结果 |
| --- | --- |
| `gh secret list --repo shazhou-ww/unicas --env Production --json name` | HTTP 403，当前身份无相应仓库管理权限 |
| `gh variable list --repo shazhou-ww/unicas --json name` | HTTP 403，当前身份无相应变量读取权限 |

这只能证明当前执行身份无法核对配置，不能据此推断 GitHub 上没有配置
Production secrets，也不能推断 Git 推送权限等于 Actions 或 Cloudflare
部署权限。没有替换凭据或绕过权限。后续尝试通过正常 API 手动 dispatch
预检，仍收到 403，没有启动该预检 run。

后续须由有权限的执行者选择并授权目标与维护窗口，通过现有安全机制注入
发布配置或启用已配置的受保护发布通道，再完成写入栅栏、备份、保留政策
和真实目标演练。不要将密钥、token 或客户 snapshot 粘贴到对话或提交到 Git。
这些前置条件未满足，因此 `D-S01` 至 `D-S03` 与对应部署标准继续未完成，
不提交 `submitOuter`，也不请求部署验收。

## 已授权的生产发布执行计划（2026-10-27）

用户已明确授权发布及部署验证。目标为现有 service、Spaces、产品站和文档站的
标准 `release` / `Production` 通道；不发布 npm，不修改冻结旧环境。
执行期间由当前 Agent 负责操作和核验，环境审核沿用仓库现有 required reviewers。
所有 archive、旧请求桥接和备份保留，不设置新 TTL、不做清理；
长期保留与兼容退休继续作为未完成的 D-S03，不冒充本次即时发布验证。

此前无法读取 Secrets 元数据不等于无法发布。现已独立确认：

- Actions run 读取可用，上次 `release` run `37912005945` 实际完成了
  validate、Production 部署、全部 smoke/origin 检查和生产 tag。
- `Production` 环境确有 required reviewers，且不禁止 self review；
  标准发布先经过完整 CI 和该现有审批关口，不依赖手动 dispatch 权限。
- 当前设备的 Cloudflare OAuth 认证包含目标账号与 `d1:write` 权限。
  没有读取或输出 OAuth token；本机缺少 CI 注入的变量不再被当作 Actions 阻塞。
- 生产 D1 只读检查得到 171 个 node、1 个 aggregate root、496 条旧事件与
  496 条旧请求；projection 漂移、孤立 projection 和 requestId 碰撞均为 0。
- 已将真实 D1 SQL 备份保存于 Git 忽略、限制访问的目录，并在本机恢复为 SQLite。
  现有只读迁移 plan 通过：2 个 App、171 个 node、496 条可桥接请求。
  原始记录和下载凭据不进入本契约或 Git。

执行顺序：

1. 通过正常双亲、内容与 main 一致的 promotion merge 发布到 `release`，
   观察完整 CI，并先确认 Production 审批通道可用。此时不冻结线上写入。
2. 在 CI 通过、审批可操作之后，进入 Root Ref 短维护窗口：
   先为旧 ledger 安装拒绝新写入的约束，利用旧 writer 已有的原子 D1 batch
   一并回滚 aggregate delta；只读旧请求重放不改数据。再次备份、校验冻结后的
   ledger 和 projection，保留 Time Travel 恢复书签。
3. 建立新 schema，从当时的权威 aggregate 构建 projection，从冻结的旧表
   复制唯一请求结果并建立各 App 的 checkpoint，安装全部 archive 写保护；
   最后才写入 cutover marker。迁移绝不 UPDATE/DELETE `cas_nodes`，
   不合并旧历史，不覆盖旧记录。校验行数、逐项一致性和约束后才批准部署。
4. 由受保护 workflow 执行 service、Spaces migration/issuer 切换和 smoke，
   随后检查各 origin、生产 tag 与 D1 一致性。已有本地演练不代替这些线上证据。

如果 CI 或审批权限不足，在安装写入栅栏之前停止，线上状态不变。
栅栏后的失败只能在确认新 writer 未写入新事件时撤销本次新增状态和栅栏；
旧 ledger 和 aggregate 未被迁移改写，不能用恢复旧快照丢弃其他已接受写入。
任何新事件出现后仅 forward-fix，不回滚到旧 writer。不可确认安全边界时
保持停写并明确报告，不运行破坏性猜测操作。

## 发布 promotion 与工具链准入

已确认此前 API 权限失败来自默认 CLI 账号与仓库所有者不一致。
本次命令通过凭据管理器中已有的所有者认证操作，不修改全局默认账号，
不放宽 branch protection 或 Production 审批。

正常直接 promotion push 被 `release` 保护规则拒绝，要求 PR 和两项状态检查；
随后通过所有者身份创建了 [发布 PR #65](https://github.com/shazhou-ww/unicas/pull/65)。
所有生产数据操作仍只有只读核对、备份与本地副本迁移，没有安装线上写入栅栏。

PR 的 CodeQL 通过，Dependency review 检出了继承的 `turbo@2.7.2`：
GHSA-hcf7-66rw-9f5r 与 GHSA-3qcw-2rhx-2726 均要求至少 2.9.14。
因此仅将 root 开发工具固定到 2.9.14，并适配其 scoped 平台 binary 的锁文件
检查；不关闭 Dependency review、不改变串行/无缓存任务语义。
完整发布验证仍由 promotion 后的 Actions 在精确 release 修订上执行。

工具升级本地验证：preset/发布规则/local tooling 合计 17 tests 通过；
Turbo 实际执行 protocol 的 43 tests 通过；`pnpm build` 的 16 tasks 通过。
完整 typecheck 发现此前新增文档回归测试的 Map entry 被推断为 `string[]`，
已补充准确 tuple 类型而不改变断言；随后 `pnpm docs:check` 的 8 tests 与
`pnpm typecheck` 的全部 27 tasks 通过。没有改变业务协议或重试实现。

进一步核对 npm 发现设备开发版 `silvermoon@0.5.0` 尚未作为稳定版发布。
虽已发布稳定版 0.4.0 包含 v2 schema 和 submit/accept 事件，真实预检
run `40530409004` 证明它要求旧的显式 sequence 字段，不能读取当前日志。
不能仅凭 schema 版本号推断兼容，更不能为旧验证器重写事件历史。
CI 与文档部署因此固定全局安装确已发布、匹配当前记录格式的
`0.5.0-canary.50.g7e6b2e80af33`，不跟随移动 canary tag。
设备现有开发版不被替换，也不新增项目依赖或擅自发布 Silvermoon。

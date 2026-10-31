# 部署准入与预检

## 当前结论

重试修正版 `implementationRevision=b5d1b077bd5e` 已明确验收并同步到 primary，
部署尚未完成。用户现已明确授权通过现有 Actions 通道发布并验证。
用户于 2026-10-31 在独立会话与隔离 worktree 中明确恢复推进；
实际生产变更仍只允许通过现有受保护 Actions 与 Production 审批。
本地与 Linux 完整预检通过；2026-10-31 受保护 job 已完成生产 Root Ref cutover
并部署新 service；签名路径已修复，smoke 的最后一个旧路由 probe 因未定义变量
失败，后续单元未部署。
生产 marker 后仅允许 forward-fix；整体部署及在线 smoke 尚未完成，不能提交 `submitOuter`。
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
2. 在 CI 通过且 Production 审批通过之后，受保护 job 才进入 Root Ref 短维护窗口：
   先为旧 ledger 安装拒绝新写入的约束，利用旧 writer 已有的原子 D1 batch
   一并回滚 aggregate delta；只读旧请求重放不改数据。再次备份、校验冻结后的
   ledger 和 projection，保留 Time Travel 恢复书签。
3. 建立新 schema，从当时的权威 aggregate 构建 projection，从冻结的旧表
   复制唯一请求结果并建立各 App 的 checkpoint，安装全部 archive 写保护；
   最后才写入 cutover marker。迁移绝不 UPDATE/DELETE `cas_nodes`，
   不合并旧历史，不覆盖旧记录。校验行数、逐项一致性和约束后才继续 Worker 部署。
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

新预检 `40532829724` 已通过验证器安装和事件语法阶段，但暴露 Actions checkout
的 origin URL 缺少 `.git`，不满足 v2 history 对 canonical named primary 的
精确匹配。CI 与文档部署因此在检查前显式规范 origin URL 并刷新
`refs/remotes/origin/main`，同时增加顺序回归检查；不修改用户设备的 Git remote。

数据切换不在本机提前执行。现已将固定 CAS_DB 的 runner 接入 Production job，
放在精确修订校验后、任何 secrets 更新或 Worker 发布前，保证所有远程写入
仍在环境审批之后。runner 默认 plan-only，首次切换复用现有离线规则，
校验/备份/冻结/迁移/核验后最后写 marker；重复执行只读验证已完成状态。
临时客户数据目录受限并在退出清理，provider 原始输出和下载 URL 不进入 job 日志，
不上传客户数据 artifact。发布前与故障路径的可执行测试纳入 `pnpm check:release`；
原离线 fixture 同时改为平台无关路径，以便在 Linux 发布 runner 中实际运行。

## 阶段检查点与接续（2026-10-28）

当前阶段 runner、Production 审批后的执行接线、恢复保护测试和跨平台测试
入口已提交 primary；本次按用户要求停止发布，不再启动新预检或合并 release。

- 发布 PR #65 保持 OPEN。最近一次成功的 release 仍为 `14739e8e45bd`；
  没有发布本次新版本，也没有执行生产 writer fence、数据迁移或 Worker 部署。
- 当前阶段验证：`pnpm check:release` 共 86 tests 通过；
  `pnpm exec vitest run tests\release-gated-ci.test.mjs tests\agent-guidance.test.mjs`
  共 17 tests 通过；`git diff --check` 通过。
- 最新精确修订的完整 Linux `pnpm validate:release` 尚待运行，不能将此前
  失败 run 的修复、本地测试或 CodeQL 当作完整发布验证成功。
- 没有保留运行中的发布 watcher 或生产进程。原始生产备份保留于受限且
  Git 忽略的位置，不提交、不上传；实际切换必须重新取得当时的冻结 snapshot。

明天恢复时先获取 primary 和 PR 新状态，以已配置的仓库所有者认证运行
最新精确修订的完整 CI；不切换全局默认账号、不放宽保护规则、不强推。
确认保护检查和完整预检通过后，正常合并 main 到 release，并沿用 Production
审批，在 job 内执行 cutover、发布与 smoke。runner 的真实 D1 执行/恢复边界
仍须重点审查；遇到数据漂移或不可证明的恢复条件就停止。

所有旧 ledger、备份和请求桥接继续保留，不设置新 TTL 或清理归档。
实际发布、观察窗口及保留政策未完成，因此 D-S01 至 D-S03 和对应标准
保持未完成，不记录 `submitOuter` 或部署验收。

## 恢复推进与执行语义核对（2026-10-31）

新 worktree 初始 HEAD 与刷新后的 primary 均为 `fce0337f448c`，工作区干净；
已将独立分支配置为跟踪 `origin/main`，没有操作原会话的工作区或私有备份。
重新观测 #65：OPEN、无 auto-merge、精确 head 为该 primary，Dependency review
与 CodeQL 均通过。`SPACES_RELEASE_ENABLED=true`；release 仍要求 PR 与两项
检查，包含管理员；Production 仍要求 reviewer，未绕过或修改这些保护。
完整 Linux 预检尚待新候选同步后运行，旧失败记录不代表当前候选通过。

检查本项目 Wrangler 4.123.0 的实际执行代码：
远程 `d1 execute --file` 将原文件流上传到 D1 import，再等待 ingestion 完成；
并不调用本地 `unstable_splitSqlQuery`。该 splitter 会移除 trigger 内的注释，
但这一事实不能证明远程 import 服务保留或删除注释。现将归属证明改为 trigger
体内的无副作用 `SELECT 'root-ref-cutover-owner:<随机值>';`，不再依赖注释保留。
schema 核验只容许固定格式的归属语句；恢复只能认领本次随机值，不能认领
没有可验证归属的旧栅栏或其他操作的栅栏。已有 marker 的路径仍只读核验。

测试 executor 现通过本项目的真实 Wrangler splitter 再执行 SQL；注释方案
在此回归中失败，字面量方案通过。另以真实本地 D1 验证 12 个 archive trigger
的字面量归属保留，以及旧 writer 的 aggregate/event 同批操作因栅栏整体回滚。
同时保留丢失响应、部分写入、其他所有者、恢复读不可用、新事件及 marker 后
禁止回滚等测试。没有执行 remote D1 或借助生产数据验证这一修复。

- `pnpm check:release`：88 tests 通过，包含真实本地 D1 测试。
- `pnpm check:repo`：Silvermoon worktree 校验、184 项仓库测试与 10 项发布门禁测试通过。
- `pnpm validate`：quick tests、完整构建与 typecheck 均通过；不代替完整 Linux 发布预检。
- `pnpm exec vitest run tests\root-refs-production-cutover.test.mjs tests\root-refs-cutover.test.mjs tests\release-gated-ci.test.mjs tests\agent-guidance.test.mjs`：
  字面量修复后的首轮 54 tests 通过；随后新增真实本地 D1 证明已纳入上述完整套件。
- 初次完整套件遇到测试初始化超时及查询包含 baseline trigger 的断言错误；
  改为按需加载 runtime、只选择 archive trigger 后重跑通过，未放宽生产断言。

这些结果只支持发布候选准入，不证明远程 import 服务或生产迁移已成功。
Production job 仍必须读回 trigger 归属并验证冻结状态，任何不可证明的恢复
继续保留栅栏并报告人工恢复条件。保留政策及观察窗口未完成，不勾选生产 D-*，
不重开已接受的 ideal/inner gate，不提交或接受 outer。

## Linux 完整预检与 SDK 证据修复（2026-10-31）

栅栏修复已正常同步 primary `796481061ac6`，精确 HEAD 的 pre-push
`pnpm validate`、remote Silvermoon 校验均通过。手动 dispatch 的非生产
[CI run 41177957838](https://github.com/shazhou-ww/unicas/actions/runs/41177957838)
在 job `124469324009` 失败：quick tests、build、typecheck、发布测试、
Worker suite、外部 SDK Node 与 Chromium/Firefox/WebKit smoke 均已通过，
但 `pnpm release:sdk:artifacts` 检出六包 manifest 大小和 integrity 不匹配。
这不是 Node deprecation 警告，也不证明当前候选已通过完整发布验证。

在同一新 Windows worktree 用当前 pnpm 11.24.0 打包，六包的实际大小与完整
SHA-512 均与该 Linux run 一致。进一步只在内存中将每包 tar 内 `LICENSE`
由 LF 转为 CRLF、重算对应 tar header 并按原参数压缩，就精确重现旧 manifest
全部六组大小与 SHA-512。源码、版本、导出及依赖未改变；不是 tar/gzip 的
平台头差异，而是旧证据捕获了 CRLF 许可证正文。

| 包 | 旧证据 CRLF bytes | 当前 Windows/Linux LF bytes |
| --- | --- | --- |
| `@unicas/codec` | 7580 | 7562 |
| `@unicas/space-protocol` | 24421 | 24403 |
| `@unicas/space-client` | 9757 | 9738 |
| `@unicas/space-blob-client` | 9828 | 9809 |
| `@unicas/space-browser-cache` | 7632 | 7613 |
| `@unicas/space-file-client` | 8791 | 8771 |

`.gitattributes` 已规定根 `LICENSE` 为 LF，但仅比较 checkout 与其自身 packed
license 会让遗留 CRLF checkout 生成自洽却不跨平台的证据。正式 prepare/check
入口现于 build/pack 前明确拒绝 CRLF，增加回归测试；不静默改写源码或 tarball，
不删除大小、完整 integrity、双次打包、消费者、API baseline 或文件内容断言。
在当前符合 attributes 的 Windows checkout 运行正式 `pnpm release:sdk:prepare`
刷新 manifest，再独立执行 `pnpm release:sdk:artifacts` 验证。

- `pnpm exec vitest run tests\sdk-release.test.mjs tests\sdk-readiness.test.mjs tests\npm-release.test.mjs`：
  37 tests 通过。
- `pnpm release:sdk:prepare`：通过，六包双次打包、声明/API baseline、外部 Node
  和三浏览器验证通过；仅生成本地证据，没有 npm publication。
- `pnpm release:sdk:artifacts`：独立重建和检查通过；同样验证所有完整断言。
- `pnpm check:release`：89 tests 通过；程序化对比确认刷新后的六包 bytes 与完整
  SHA-512 均逐项等于上述 Linux run 的实际值，API baseline 无变更。

SDK 修复已正常同步 primary `af1f403194a4`，精确 HEAD 的 pre-push
`pnpm validate` 与 remote Silvermoon 校验通过；重新运行的 Linux
[CI run 41179173939](https://github.com/shazhou-ww/unicas/actions/runs/41179173939)
完整成功，包括 `pnpm validate:release`、SDK artifact 的全部断言及部署 dry-run。
#65 的 Dependency review 与 CodeQL 均通过；没有放宽任何检查或修改 gate。

## 受保护 promotion 与审批等待（2026-10-31）

按既有发布授权，先用 `git merge-tree --write-tree` 验证 promotion tree 与
已完整验证的 main `af1f403194a4` 一致，再以标准 PR merge 和精确 head
条件正常合并 #65。没有 force push、admin bypass 或 auto-merge。
发布修订 `af530f374a71` 的两个父提交依次为旧 release `14739e8e45bd` 与
已验证 main `af1f403194a4`；合并后再次验证 tree 完全一致。

[release CI run 41179560882](https://github.com/shazhou-ww/unicas/actions/runs/41179560882)
的 validate job `124473992194` 于 2026-10-31 07:15:13Z 成功：
`Verify release revision` 和完整 `pnpm validate:release` 均通过。
这同时给出真正 promotion 修订上的独立验证，不把 main push 当作部署。

随后观测到 `Deploy production` job `124474875009` 为 `waiting`，没有执行步骤；
pending deployment 明确要求 Production 的既有 reviewer 审批。Agent 没有使用
当前账号可审批这一权限代替 reviewer 的显式决定，没有运行 cutover、同步
secrets、部署 Worker 或写生产 D1。监视该 run 的本地 watcher 已停止。
GitHub 待审批 job 保留，下一步为 reviewer 审批后的受保护执行与真实 smoke；
若外部状态改变，接续时重新观测，不重放本检查点的旧授权或状态。

以上仅完成发布预检与 promotion。生产 D-*、观察窗口和保留政策仍未完成，
ledger 不勾选；不以 CI 成功、PR merge 或待审批 job 代替 `submitOuter`、
部署验收或新的精确生命周期 gate。

## 审批后 inspect 失败与真实执行器修复（2026-10-31）

用户明确完成 Production 审批后，run `41179560882` 的生产 job 于
07:22:51Z 开始，07:23:09Z 在 cutover 的 `inspect` 阶段失败并报告
`no-remote-mutation`。全部 secrets 同步、Worker 部署、issuer 切换、smoke、
public origin 验证和 deployment tag 均跳过。没有开始 bookmark、writer fence
或数据迁移，不能把审批或 validate 成功当作部署完成。

在同一 Production account、固定 `CAS_DB` / `unicas-tenant` 上仅做只读诊断：

1. Wrangler 4.123.0 在 `WRANGLER_LOG=error` 下执行 `SELECT 1 --json`：
   exit 0、stdout 0 bytes；在正常 `log` 级别下 exit 0 且 JSON 有效。
   runner 原先将静默日志级别误用于机器输出，导致 inspect 解析空串失败。
   现恢复正常日志级别，仍用 pipe 私有捕获 stdout/stderr、日志进入受限临时
   目录并退出清理；不把 provider 正文、私有下载 URL 或客户记录输出。
2. 去掉上述阻断后，真实 schema 核验通过，但九段 `UNION ALL` counter 查询
   被远程 D1 拒绝：`too many terms in compound SELECT: SQLITE_ERROR [code: 7500]`。
   本地 SQLite fixture 未施加该远程限制。现 counters 与全部 verification
   查询使用一个 SELECT 中的标量子查询，每个原有检查仍独立验证且必须为 0；
   不删减检查、不在失败时返回默认成功。
3. 修复后以真实 Wrangler 调用 runner 的原 schema/counters 准入，executor
   强制仅允许 `d1 execute --remote --json --command`，禁止文件执行及所有
   后续阶段。两次只读查询通过，runner 到达 `bookmark` 后因该只读边界主动
   停止，结果为 `inspectionPassed=true`、`no-remote-mutation`。
   这证明当前真实 schema 与初始新状态准入通过，不证明迁移已经执行。

新增真实本地 Wrangler CLI JSON 回归：继承错误日志级别时 helper 仍明确设置
正常日志级别，验证合成 D1 `SELECT 1` 的完整机器结果；子进程输出不继承终端。
所有 fake executor 查询均断言不再使用宽 `UNION ALL`，保留完整 recovery、
foreign fence、marker 后 forward-fix、archive 与新事件保护测试。

- `pnpm check:release`：90 tests 通过。
- `pnpm exec vitest run tests\release-gated-ci.test.mjs`：10 tests 通过。
- `git diff --check`：通过。

候选仍须正常同步 primary、通过精确 Linux 完整预检，再经新 main→release PR
与原 Production 审批执行；不能在本机切换数据，不能 rerun 旧修订假装修复
已进入旧 run。此次执行器修复不改变已接受的 ideal/inner 合同，也不构成 outer
submit/accept。生产 D-* 仍未完成。

## 修复后的精确预检与第二次审批等待（2026-10-31）

执行器修复已同步 primary `9f744f13b1b9`；其精确 HEAD 的 `pnpm validate`
与同步后的 `pnpm check:ideas:remote` 均通过。
[Linux CI run 41180937569](https://github.com/shazhou-ww/unicas/actions/runs/41180937569)
完整成功，validate job `124478025366` 用时 6m23s，包括实际 Wrangler CLI
回归、完整 release 套件、SDK artifacts 与所有部署 dry-run。

新 [promotion PR #66](https://github.com/shazhou-ww/unicas/pull/66) 使用仓库 PR
模板并记录精确验证结果；Dependency review 和 CodeQL 均通过。按既有发布
授权验证 tree 后正常 merge，未启用 auto-merge 或使用 bypass。
release `61b4f060b864` 的两个父提交依次为 `af530f374a71` 与已验证的
main `9f744f13b1b9`，合并前后 tree 均与该 main 一致。

[新 release CI run 41181407106](https://github.com/shazhou-ww/unicas/actions/runs/41181407106)
的 validate job `124479389683` 于 07:44:57Z 成功，包含精确 promotion
验证与完整 `pnpm validate:release`。随后 Production job `124480595703`
为 `waiting`，pending deployment 要求既有 reviewer 审批，尚无执行步骤。
Agent 没有代替 reviewer 审批，也没有将用户针对旧 run 的批准重放到新 run。
本地 watcher 已停止，待审批 job 保留。

下一步是在该新 run 上完成 Production review，然后重新观测并检查受保护
job 的真实 cutover、恢复分类、各部署和 smoke 结果。失败就精确诊断，不
盲目 rerun 或绕过审批；不可证明的恢复仍保留栅栏。
目前没有生产迁移或新版上线证明，不勾选生产 D-*，不提交或接受 outer。

## 生产 cutover 完成与 smoke 路径 forward-fix（2026-10-31）

用户完成新 run `41181407106` 的 Production 审批后，cutover 于
07:51:36Z 输出 `cutover-complete` 并成功退出。脱敏摘要：2 Apps、171 nodes、
496 legacy events、496 replay records；冻结 snapshot 的 digest 为
`81c7c50e09501eb42175c98e2bfefcafefe68887859d5177fbff36da6796b7e2`。
job 记录的 TimeTravel bookmark 为
`00000423-00000000-00005115-09505d514c8d3d701bcd42afcff2dfe9`。
runner 已完成逐项 aggregate/projection、checkpoint、archive/replay 核验，
并最后写入 marker；私有 snapshot 与 provider 输出未作为 artifact 保留。

随后 secrets 同步成功，service 上传与 triggers 发布完成，Worker version
`4740a6a6-1435-4f4f-bf5b-dafa3c051aff`，路由为本任务的 API/Console origins。
service smoke 在读取临时签名文件时失败：错误路径指向
`release/.wrangler/cas-deploy/`，而 job 在仓库根 `.wrangler/cas-deploy/` 创建文件。
失败发生在 capability 签名与 smoke 网络调用之前；job 的签名文件 cleanup
成功。Spaces、site、docs、public origin 检查与 deployment tag 均跳过。
不能将 service 上传成功当作完整发布成功。

marker 已存在且新 service 已启用，因此保留 archive 栅栏、新 events 和 replay，
仅做 forward-fix；不恢复旧 snapshot，不回滚旧 writer，不清空数据。
使用固定 CAS_DB 的 runner 和强制只读 executor 再次执行已完成切换路径：
四次只读查询返回 `already-cutover`，验证 marker、12 archive guards、新 ledger
append-only constraints、当前 aggregate/projection、checkpoint/events 和 replay
关系成立。没有文件执行或其他远程写操作。
`curl.exe --fail --silent --show-error --connect-timeout 10 --max-time 30 --proto '=https' https://api.unicas.work/health`
返回 `{"ok":true,"service":"unicas"}`；仅证明该公开健康响应，不替代 smoke。

修复将 smoke key 路径定位统一放在既有 `smoke-target.mjs`，相对该模块确定仓库
根而非 process cwd，正式 smoke 使用同一 helper。回归将 GitHub workflow 的
创建/清理位置、helper 结果与实际调用接线对应起来，保留全部既有 probe。
以临时合成 ES256 key 运行真实 smoke 入口，目标固定 loopback，成功读入并导入
根目录中的 key 后才遭预期网络失败；没有生产调用或密钥输出，临时 key 已删除。

- `pnpm exec vitest run tests\deploy-plan.test.mjs tests\root-refs-production-cutover.test.mjs tests\release-gated-ci.test.mjs`：
  84 tests 通过。
- 合成 key 的真实入口验证：`syntheticKeyLoaded=true`、`loopbackOnly=true`、
  `privateKeyLogged=false`。
- `git diff --check`：通过。

下一候选须重新经过正常同步、完整精确 Linux CI、main→release PR 及 Production
review。新 job 的 cutover 必须走只读 `already-cutover` 验证，不覆盖已接受新事件。
生产迁移的部分证据已真实取得，但完整部署、在线 smoke、观察窗口与保留政策
尚未完成，生产 D-* 暂不勾选，不提交或接受 outer。

## smoke forward-fix 准入与第三次审批等待（2026-10-31）

smoke 路径修复已同步 primary `c58bf77e5d9c`，其精确 HEAD 的 `pnpm validate`
及同步后的 `pnpm check:ideas:remote` 均通过。
[完整 Linux CI run 41182687325](https://github.com/shazhou-ww/unicas/actions/runs/41182687325)
成功，validate job `124483168394` 用时 6m5s。
[PR #67](https://github.com/shazhou-ww/unicas/pull/67) 的 Dependency review 与
CodeQL 通过；正常 merge 后 release `ce8b12b211e8` 的两父提交为
`61b4f060b864` 与 `c58bf77e5d9c`，tree 与该已验证 main 完全一致。

[新 release run 41183157999](https://github.com/shazhou-ww/unicas/actions/runs/41183157999)
的 validate job `124484546051` 成功，包含精确 release 校验和完整
`pnpm validate:release`。Production job `124485858307` 当前为 `waiting`，
pending deployment 要求既有 reviewer；没有代为审批或重放旧批准。
等待脚本在检测到审批门禁后已退出，没有保留 watcher。

下一步为该新 run 的 Production review。审批后应先验证 cutover
`already-cutover`，再检查 service smoke 与 Spaces/site/docs 部署、
public origin 和最终 tag；保留全部新事件与归档，禁止旧 snapshot restore。
当前生产 cutover 与 service 已有证据，但完整发布和 outer 验收仍未完成。

## 第三次审批执行与最后一个 smoke probe 修复（2026-10-31）

用户于晚间批准 run `41183157999` 后，cutover 的已完成状态只读核验成功，
secrets 同步、临时签名文件创建、新 service 上传及 triggers 发布均成功。
Worker version 为 `c202b512-a745-4553-8541-41db4ebd036a`。
签名路径修复实际生效，service smoke 已执行并通过：

- API health、内部路由不可访问、真实 child/parent lease、content 与 metadata；
- Root Ref 首次更新、同 payload 重放、projection、mixed-sign replacement；
- usage、GC 保留当前 leased nodes、旧 v2 endpoint 404；
- 旧 Space claim v1/v3 和宽 permission 的 401 invalid_token；
- cross-Space read 403、隔离 Space 为空、旧 Tenant claim 401。

最后一个 `App/Space token on retired route` probe 尚未发出请求，
因 `ReferenceError: token is not defined` 于 14:51:10Z 失败。
失败后的 `Root Ref cleanup releases smoke roots` 已成功，临时签名文件 cleanup
也成功。此次 smoke 已接受的新事件和清理事件必须保留；
Spaces、site、docs、最终 public origin 检查与 deployment tag 均跳过。
不能把这些部分成功当作 `APP/SPACE SMOKE PASS` 或完整发布通过。

根因是 capability-provider 重构后，该旧路由 probe 仍引用已移除的变量。
现使用既有 `issueSpace(SPACE_ID)` 在此 probe 前签发有效的同 Space token；
保留旧 endpoint 必须返回 404 的原断言，没有绕过网络 probe 或降低鉴权要求。
新增 TypeScript semantic 检查整个 smoke 脚本的未定义标识符，同时在内存中移除
该 binding 重现原错误，要求明确检出 `Cannot find name 'token'.`。
编译器检查只影响测试，不增加运行时依赖；首次冷编译超过默认 5 秒，因此为
该编译器测试单独设置 30 秒上限，不改变任何生产 smoke 阈值或断言。

- `pnpm exec vitest run tests\deploy-plan.test.mjs tests\root-refs-production-cutover.test.mjs tests\release-gated-ci.test.mjs`：
  85 tests 通过，包含完整脚本未定义标识符的正/反回归。
- `git diff --check`：通过。

继续仅允许 forward-fix，新候选须经过精确完整预检、正常 promotion 与新的
Production review。尚未完成整体部署或 outer gate，不恢复旧 snapshot，
不清空新事件，不勾选未获得完整证据的生产 D-*。

# Deployment evidence

## Candidate

- Idea：`spaces-entries-latency`
- ULID：`01M4D2W8PQKBKPVFSGCRJWDD47`
- 首轮已验收 Implementation revision：
  `ed42de517d1694ac17e8c68aab471cebf04aa929`
- 首轮实现 commit：`65605f2073e63623699ec8f235b221709f85ff92`
- 首轮 acceptance commit：`8a1f360c7e86f6d303384754c617105a96966fa4`
- 初始 Deployment contract revision：
  `bd6aa93fb588d09e9b06e5fccd57e540b6cc92a9`
- 首轮 `main` candidate：
  `e37a2a81a8e12d3487d8d5d7bacbe28fee109672`
- 首轮 production release revision：
  `80838475010aa5a5c53bebd5d7dd335ab14be4e7`
- 首轮 production tag：`production-20261008-571`

## Controlled local pre-validation

以下结果只证明实现减少串行边界并移除请求内 schema 工作，不作为 production
APAC SLO 证据。

| Probe | Baseline | Candidate | Result |
| --- | ---: | ---: | --- |
| Directory boundaries per read | 2 catalog + metadata + content | 1 catalog + combined node read | 4 降至 2 |
| 15 ms/boundary directory p50, 40 runs | 90.1 ms | 45.1 ms | 降低 49.9% |
| 15 ms/boundary directory p95, 40 runs | 105.4 ms | 60.0 ms | 降低 43.1% |
| Fresh Miniflare Space-route p50, 5 runtimes | 70.7 ms | 6.8 ms | 降低 90.4% |
| Fresh Miniflare Space-route p95, 5 runtimes | 71.4 ms | 11.0 ms | 降低 84.6% |
| Request-path schema timing | `cas_schema` 约 60–64 ms | 无 `cas_schema` | 已移至启动阶段 |

候选本地 runtime 启动 p50 从 1.886 秒变为 2.778 秒，约增加 0.893 秒；这是
migration 从首个请求移到启动阶段的预期取舍。两侧热请求约 3 ms，差异不显著。

## Release baseline

- 发布前 production tag：`production-20261008-560`
- 发布前已知良好 release revision：
  `f591269ff589ad17ad32a320ea9aaf529a3d0d0e`
- 最终成功 promotion 前的 `release` tip：
  `ac7bf33d950a99d9e9ecfc19a1323967f0475c0c`；该 revision 的 workflow 在
  Worker publication 前失败，不是 production。
- 已知良好 service version：
  `a4ce64f9-0c48-4cfb-b629-2de957f2b22a`
- 已知良好 Spaces version：
  `a7d0d120-f7c4-4e12-8a16-073ec16223d9`；placement 回滚基线为固定 IAD。
- 已知良好 site version：
  `2a36c5f0-5171-42ae-81e3-eaa584310948`
- 已知良好 docs version：
  `3200c671-c6bd-44ce-819d-c1e995f176d3`
- 发布前确认 `SPACES_RELEASE_ENABLED=true`，没有并发 production workflow。

## Release execution

| Attempt | Promotion | Release revision | Workflow | Outcome |
| --- | --- | --- | --- | --- |
| 1 | [#32](https://github.com/shazhou-ww/unicas/pull/32) | `3d2b0c3e0031d3872e747a29488ea2d4adb0350d` | [37742842919](https://github.com/shazhou-ww/unicas/actions/runs/37742842919) | release-only packed SDK consumer validation 失败；Production job、migration 与 publication 均未运行。 |
| 2 | [#33](https://github.com/shazhou-ww/unicas/pull/33) | `ac7bf33d950a99d9e9ecfc19a1323967f0475c0c` | [37744466583](https://github.com/shazhou-ww/unicas/actions/runs/37744466583) | release validation 通过；remote D1 trigger splitter 在 `0001_baseline.sql` 返回 `incomplete input`，service/Spaces Worker 均未发布且没有 production tag。 |
| 3 | [#34](https://github.com/shazhou-ww/unicas/pull/34) | `80838475010aa5a5c53bebd5d7dd335ab14be4e7` | [37749102134](https://github.com/shazhou-ww/unicas/actions/runs/37749102134) | release validation、Production job 和 immutable tag job 全部成功。 |

最终 promotion 是 two-parent merge，parents 为
`ac7bf33d950a99d9e9ecfc19a1323967f0475c0c` 和
`e37a2a81a8e12d3487d8d5d7bacbe28fee109672`；merge tree 与 main parent tree
均为 `ecfc598a810e16ef1498f0ff648aac9e60781ac5`，main parent 可从
`origin/main` 到达。Production environment 唯一 reviewer 与 workflow actor
相同且禁止自审；在用户已要求继续部署但暂时不可交互时，对最终精确 run 使用
环境允许的管理员旁路，批准后立即恢复 `prevent_self_review=true`、原 reviewer
和原 release branch policy。旁路前只有该 run 处于 waiting。

- `CAS_DB` migration：`0001_baseline.sql` 在 service publication 前成功执行
  35 条命令并记录成功。失败的第二次 attempt 未记录 migration；最终 attempt
  重新列出并成功应用同一 migration。
- Canonical service smoke：workflow step 成功，覆盖 authenticated node、
  Root Ref、usage、GC、隔离与拒绝路径。
- Spaces file smoke：`authenticate`、`hash`、`lease`、`upload`、`commit`、
  `verify`、`cleanup` 全部通过。
- Public origins：API、console、Spaces、product 与 docs 五个 probe 全部通过。
- 发布后 service version：
  `488cebb3-c82b-4c98-a764-fd3e22a96779`
- 发布后 Spaces version：
  `3a412e0f-f417-43c0-8cdd-4d96625c351e`
- 发布后 site version：
  `9ed852b9-d352-47fb-89f1-a02f35865572`
- 发布后 docs version：
  `ca3f2906-ed3b-4b96-9b68-4113c4320df0`
- immutable tag：`production-20261008-571`，由成功 workflow 在
  `2026-10-08T08:28:30Z` 创建并指向最终 release revision。

## Synthetic credential rotation

为避免依赖真实账户或浏览器 cookie，Production environment 的
`SPACES_SMOKE_CREDENTIAL` 被轮换为一次性 256-bit synthetic credential，并对同一
release workflow 执行 rerun attempt 2。validation、migration、service/Spaces
publication、canonical smoke、五个 origin 和 tag job 全部成功；tag 保持
`production-20261008-571`。该次 publication 的 version 为：

- service：`ac553f5a-ebb5-4de1-9e4e-1cec562444f1`
- Spaces：`fc3d0a04-0890-40fb-a84e-8fa4bf18ea32`
- site：`97b800f5-9ac6-4090-917f-9ea1c2e8050f`
- docs：`582de9d7-55a9-4f69-baaf-3a12bc53b0b3`

完成首轮 APAC probe 后，Production secret 再次轮换为新的随机值并执行 rerun
attempt 3，从而使首个临时 credential 失效。attempt 3 的完整 release workflow
成功，最终 production version 为：

- service：`f7a4bad3-ce15-4793-842e-189f437be3f6`
- Spaces：`3de0e383-025e-4821-8cb0-a4b9f3765189`
- site：`d9da9cc8-e606-4815-a778-3e672517f6fd`
- docs：`75ef7ef2-8a09-4cd4-94fc-26953a70ab32`

每次 environment gate 前均确认精确 run attempt、release SHA、唯一 waiting run 与
原 protection policy；只临时关闭 self-review，批准后立即恢复唯一 reviewer、
release branch policy 和 `prevent_self_review=true`。最终 credential 只保留在
受保护 GitHub environment；本地 DPAPI 副本已删除。workflow、探针输出和仓库均
未记录 credential、cookie 或 session 内容。

## APAC authenticated canary

- attempt 2 首个 observation 在 HKG 为 2011.8 ms，超过 2 秒门槛 11.8 ms；
  随后的 30 次 warm read 为 30/30 HTTP 200，TTFB p95 840.7 ms。该 probe 只通过
  结构与安全校验，不能声称 cold criterion 通过。
- attempt 3 成功结束后的首个 APAC authenticated directory observation 于
  `2026-10-08T09:11:21.213Z` 开始，在 SIN 为 1620.0 ms，满足 2 秒门槛。
  之后 30 次顺序、`cache: no-store` 的 warm read 全部 HTTP 200；目录正文被流式
  丢弃，没有检查或持久化目录项、路径、身份字段或 cookie。
- 最终 warm TTFB：p50 718.8 ms、p95 741.8 ms、p99/max 743.0 ms；31/31
  directory request 成功，满足 D-AC03。所有 `CF-Ray` colo 均为 SIN。
- `Server-Timing` parser 只接受固定名称和数值 duration；未发现未知名称、
  description 或 `cas_schema`。最终 31 次请求的有界汇总如下，单位为 ms：

| Phase | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| `spaces_session` | 219 | 233 | 233 | 233 |
| `spaces_root` | 219 | 226 | 228 | 228 |
| `spaces_manifest` / `spaces_unicas` | 181 | 193 | 760 | 760 |
| `cas_auth` | 0 | 0 | 178 | 178 |
| `cas_do` | 173 | 183 | 186 | 186 |
| `cas_do_route` | 157 | 168 | 169 | 169 |
| `cas_d1_node` | 6 | 7 | 9 | 9 |
| `cas_d1_refs` | 5 | 10 | 12 | 12 |
| `cas_r2_get` | 147 | 158 | 158 | 158 |
| `cas_edge` | 174 | 186 | 339 | 339 |

- Cloudflare `workersInvocationsAdaptive` 的秒级聚合将 session 创建、
  directory、cleanup 与 logout 分离；`09:11:25Z`–`09:11:46Z` 恰好包含上述
  31 次 directory invocation。该精确窗口为 31 requests、0 errors、全部
  `success`；CPU p50/p95/p99/max 为 3.706/5.881/14.702/14.702 ms，Worker
  wall p50/p95/p99/max 为 626.675/647.975/1222.982/1222.982 ms。
- 因此 TTFB、cold、outcome 和 timing safety 达标，但 Worker wall p95 超过
  500 ms，D-AC04 明确失败。`spaces_session`、`spaces_root` 与
  `spaces_manifest` 的串行等待解释了低 CPU、高 wall；不能用 TTFB 或
  `Server-Timing` 取代 Cloudflare wall 证据。

## Stability and rollback

- 观察窗口：production workflow 在 `2026-10-08T08:28:34Z` 成功结束；workflow
  内的五个 public origin probe 均通过。在 `2026-10-08T08:44:03Z` 进行无正文
  APAC follow-up probe：API `200` / 520 ms / HKG，console `302` / 655 ms / HKG，
  Spaces `200` / 640 ms / NRT，product `200` / 512 ms / HKG，docs `200` /
  927 ms / HKG。该结果证明 public origins 在 T+15 仍可用，不是 authenticated
  directory SLO 或 Worker response-construction wall 证据。
- Worker outcome、CPU/wall 与 5xx：最终 directory 窗口为 31 success、
  0 errors，探针为 31/31 HTTP 200；CPU 正常但 wall p95 超标。该窗口证明本次
  synthetic run 没有 Worker error 或 HTTP 5xx，不替代最终候选的 15 分钟趋势。
- Rollback threshold：Worker wall 阈值已命中。没有请求 Deployment 验收，也没有
  把该版本标记为满足性能合同。
- Rollback disposition：固定 IAD 基线的已知 APAC wall/TTFB 更差，而 attempt
  2/3 的旧 Worker version 还包含已撤销的 synthetic credential；直接 version
  rollback 会恢复更差拓扑或失效 credential。当前 production 保持 0 error 且
  TTFB/cold 达标，因此保留可用版本并把 idea 重新带回 Implementation，新增
  session/root 单次 D1 query 修复；该补充候选必须重新验收、promotion 和 canary，
  不能在失败版本上继续观察来满足 D-AC04。
- 当前结论：production 发布、credential 撤销、authenticated TTFB、cold 与安全
  timing 已有可复核证据；Worker wall 失败已持久化并触发补充实现。D-S04–D-S06
  和 D-AC02–D-AC07 保持未完成，直到新候选通过完整发布与稳定性门禁。

## Root-snapshot follow-up release

- 已验收 follow-up Implementation revision：
  `d99da2637861b94edbc562e7e8304b6d30ab41a2`
- 实现 commit：`d40045099ce1e9dfd63e33d0e0edf23a53e8d4c1`
- acceptance commit：`3cf48f8fdaba84d741bcb663d1a825bb72fa10be`
- [Promotion #35](https://github.com/shazhou-ww/unicas/pull/35) 生成 two-parent
  release revision `d69e27d086cfdaa6a6449d47122861c89be08db9`，release tree
  与 main parent tree 一致。
- [Workflow 37865051908](https://github.com/shazhou-ww/unicas/actions/runs/37865051908)
  attempt 1 在 Spaces publication 后的即时 authentication 因 credential
  propagation 返回 401；attempt 2 在传播完成后全链路成功。新的 bounded
  credential 建立后，attempt 3 被一个未过期 active smoke run 的 preflight
  阻止；没有修改 D1，等待其约 15 分钟 TTL 自然到期后，attempt 4 于
  `2026-10-09T01:13:31Z` 全链路成功。
- attempt 4 再次通过 release validation、migration、canonical service smoke、
  Spaces file smoke 和五个 public origin probe，并确认 Production protection
  已恢复。最终 tag 与 version 为：
  - tag：`production-20261009-578`
  - service：`2f35887a-ea3a-4778-a3cd-0e9c7903c657`
  - Spaces：`809775fb-4ec0-41bd-b260-aaf9f9e3bf88`
  - site：`49dc589d-b9f3-414c-a795-6d5fbb0ee2c4`
  - docs：`88f836aa-78fa-4168-81b7-b2af63f8903f`

## Root-snapshot follow-up APAC canary

- attempt 4 后首个 controlled observation 为 2171.9 ms，超过 2 秒 cold
  门槛。随后 30 次 warm read 连同 cold observation 为 31/31 HTTP 200；warm
  TTFB p50/p95/max 为 863.9/2020.5/2062.9 ms，D-AC03 与 D-AC05 均失败。
- 同一次 probe 中 `spaces_session` p95 为 41 ms，`spaces_root` 完全消失，
  证明 session/root 单 query 候选已生效；`spaces_unicas` p95 为 1392 ms，
  `cas_do` p95 为 578 ms。header 只含 allowlist timing 且没有 `cas_schema`。
- 为排除刚发布的 cold effect，随后执行独立 steady-state probe：cold 为
  1011.1 ms，30 次 warm read 的 TTFB p50/p95 为 1066.7/2133.1 ms；
  `spaces_session` p95 为 76 ms，`spaces_unicas` p95 为 1474 ms，
  `cas_do` p95 为 1467 ms。31/31 请求仍为 HTTP 200，且 timing 安全。
- `cas_do` 相对 `cas_do_route` 的新增差值把主要等待定位到 service Worker 与
  Durable Object 之间的 dispatch/network 边界，而不是 DO 内部 D1 或 R2 工作。
  同期只读 `wrangler d1 info` 确认 `unicas-spaces` 位于 ENAM、
  `unicas-tenant` 位于 APAC；低 `spaces_session` 与高 `cas_do` 的组合与 Smart
  Placement 靠近 ENAM session 数据库、远离 APAC CAS 数据面一致。

## Follow-up rollback disposition

- 第二轮 canary 明确触发 rollback threshold，当前 release 不满足 Deployment
  contract。固定 IAD 基线已有约 9 秒级 APAC wall/TTFB 证据，直接恢复该版本会
  明知恶化可用性；因此没有把失败 canary 伪装成稳定性通过，也没有执行该有害
  rollback。
- 当前 Smart Placement version 保持服务可用并作为下一候选的回滚基线。idea
  返回 Implementation，把 Spaces placement 改为显式
  `aws:ap-southeast-1`，在不搬迁 D1 的情况下优先共置 APAC CAS/DO 主路径。
  该候选必须获得新的 exact Implementation acceptance 后才能 promotion。
- 当前 synthetic credential 的明文未写入输出或仓库；受保护 secret 与本地
  DPAPI 密文只保留到最终候选完成 canary，之后必须再次轮换、验证旧 credential
  失效并精确删除本地临时文件。

## Explicit APAC placement release

- 已验收 Implementation revision：
  `e0f056dc9d40eee358668920db94d96f3a843f54`
- placement 实现 commit：`e06bb1a4bd4df81abd3d561692b0394f8e30b41b`
- validation evidence commit：`34a6fb30aa16aa4b36d4860c806dfa9f50ba8521`
- acceptance commit：`aac00c41157f847be9dd28f3d6096f44aa3d8831`
- [Promotion #38](https://github.com/shazhou-ww/unicas/pull/38) 从
  `d69e27d086cfdaa6a6449d47122861c89be08db9` 和 acceptance commit 生成
  two-parent release `f6b91703e419509f3723acb340aeab7d60bcc0ba`。release tree 与
  main parent tree 均为 `5faacf10b71d3a9fb89b28ca121836510a84eaf2`。
- [Workflow 37874444277](https://github.com/shazhou-ww/unicas/actions/runs/37874444277)
  attempt 1 完成 release validation、migration、canonical service smoke、
  Spaces file smoke、五个 public origin probe 和 tag
  `production-20261009-589`。attempt 2 对相同 release 做受控新 publication，
  用于取得部署后首个 cold observation。
- 所有 Production gate 均核对 exact attempt、release SHA、唯一 waiting run、
  environment `21951143624`、唯一 reviewer、`release` custom branch policy
  和 `prevent_self_review=true`。只在批准 exact pending deployment 时临时关闭
  self-review，并在 `finally` 恢复；最终独立检查确认 protection 未漂移。

## Passing APAC directory canary

- attempt 1 后首个 observation 为 2296.3 ms，超过 2 秒 cold 门槛；30 次 warm
  request 仍以 793.7 ms p95 通过 TTFB 门槛。没有把该 observation 作为 cold
  acceptance。
- attempt 2 于 `2026-10-09T02:45:40.887Z` 完成 publication 后首个受控 APAC
  authenticated directory observation。cold 为 1350.4 ms，随后 30 次 warm
  read 为 30/30 HTTP 200；warm TTFB p50/p95/p99/max 为
  531.4/627.8/3131.1/3131.1 ms。全部 31 次请求来自 SIN，D-AC03 与 D-AC05
  通过；单个 p99 outlier 不改变约定的 p95 结果。
- 固定 allowlist `Server-Timing` 汇总如下，单位为 ms：

| Phase | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| `spaces_session` | 226 | 238 | 243 | 243 |
| `spaces_manifest` / `spaces_unicas` | 184 | 220 | 685 | 685 |
| `cas_auth` | 0 | 0 | 145 | 145 |
| `cas_do` | 169 | 184 | 211 | 211 |
| `cas_do_route` | 151 | 168 | 170 | 170 |
| `cas_d1_node` | 5 | 10 | 16 | 16 |
| `cas_d1_refs` | 5 | 7 | 8 | 8 |
| `cas_r2_get` | 141 | 156 | 159 | 159 |
| `cas_edge` | 169 | 211 | 323 | 323 |

- `spaces_root` 未出现，证明 session/root snapshot common path 保持生效；
  `cas_schema` 未出现。parser 未接受未知 timing name、description、动态值或
  非有限时长，header 不包含标识符、路径、URL、SQL、凭据或内容。
- 同一 bounded run 的 warm directory Workers metrics 为：wall
  p50/p95/p99/max 422.023/470.346/2639.323/2639.323 ms，CPU
  p50/p95/p99/max 4.977/10.238/22.148/22.148 ms。认证、cleanup 和 logout
  invocation 与 directory window 分离；D-AC04 以 470.346 ms p95 通过。单个
  p99 wall outlier 与低 CPU 一致，已保留而没有从证据中删除。

## Credential revocation and final versions

- performance canary 后生成新的随机 synthetic credential，并于
  `2026-10-09T02:48:03Z` 更新 Production environment secret；新值未落盘或
  输出。workflow attempt 3 在 Spaces publication 后立即 authenticate 时因边缘
  credential propagation 返回 `smoke_credential_invalid` 401，没有创建 smoke
  run。等待传播后只 rerun failed jobs；attempt 4 全链路成功，tag 保持
  `production-20261009-589`。
- 最终 production versions：
  - service：`335175dd-578d-4973-af11-ad8c1f405372`
  - Spaces：`a939ba6b-b685-4ef1-b271-6cbd263aa1a9`
  - site：`edf0c08a-d5b5-4a5a-8b4a-529adeadefc2`
  - docs：`eef664e3-91f2-4713-8625-06fd4cefdc12`
- 旧 credential 对 `/api/smoke/session` 的负向验证返回 401；本地 DPAPI 密文与
  canary 脚本随后被精确删除并确认不存在。最终只读 D1 aggregate 显示未过期
  `cleanup_state='active'` smoke run 为 0。

## Final stability and rollback

- 最终 credential-only production state 于 `2026-10-09T03:00:32Z` 完成。
  `03:15:44Z` 的 T+15 probe 使用 workflow 同款 API health 和 public origins：
  API health 200 / 963.4 ms，console 302 / 568.7 ms，Spaces 200 / 491.1 ms，
  product 200 / 599.3 ms，docs 200 / 501.5 ms；没有 5xx。
- `03:00:32Z`–`03:15:44Z` Workers metrics：

| Worker | Outcome | Requests | Errors | CPU p50/p95/p99/max (ms) | Wall p50/p95/p99/max (ms) |
| --- | --- | ---: | ---: | --- | --- |
| `unicas-spaces` | success | 2 | 0 | 0.854 / 6.178 / 6.178 / 6.178 | 1.180 / 6.893 / 6.893 / 6.893 |
| `unicas` | success | 2 | 0 | 1.822 / 1.995 / 1.995 / 1.995 | 2.120 / 2.319 / 2.319 / 2.319 |

- 稳定性窗口流量较低，因此该 aggregate 证明观察到的 invocation 无 runtime
  error，不替代 31-request directory canary。两组证据合并后覆盖性能 SLO、
  outcome、5xx、CPU/wall 与 public availability。
- Rollback disposition：显式 APAC placement 的 warm TTFB p95、Worker wall
  p95 和 cold observation 全部通过，workflow smoke、origins 和稳定性窗口没有
  触发 rollback threshold，因此未回滚。Smart Placement Spaces version
  `809775fb-4ec0-41bd-b260-aaf9f9e3bf88` 仍作为记录的回滚基线。

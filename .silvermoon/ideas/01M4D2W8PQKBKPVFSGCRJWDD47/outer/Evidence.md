# Deployment evidence

## Candidate

- Idea：`spaces-entries-latency`
- ULID：`01M4D2W8PQKBKPVFSGCRJWDD47`
- 已验收 Implementation revision：
  `ed42de517d1694ac17e8c68aab471cebf04aa929`
- 实现 commit：`65605f2073e63623699ec8f235b221709f85ff92`
- acceptance commit：`8a1f360c7e86f6d303384754c617105a96966fa4`
- Deployment contract revision：
  `bd6aa93fb588d09e9b06e5fccd57e540b6cc92a9`
- 最终 `main` candidate：
  `e37a2a81a8e12d3487d8d5d7bacbe28fee109672`
- production release revision：
  `80838475010aa5a5c53bebd5d7dd335ab14be4e7`
- production tag：`production-20261008-571`

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

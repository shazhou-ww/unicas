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

## APAC authenticated canary

- Probe 与时间窗口：未执行；共享 APAC 浏览器仍在 OAuth 登录边界，浏览器自动化
  连接也连续超时。没有读取或保存 cookie、身份字段或响应内容。
- Cold observation：未捕获。不能把后续热请求追认为部署后的首个 observation；
  D-AC05 保持未完成。
- 请求数与成功率：`0`，不构成 canary。
- TTFB p50/p95/p99/max：待执行
- Worker wall p50/p95/p99/max：待执行
- Colo 与 placement：待执行
- 安全 Server-Timing 汇总：待执行

因此当前证据不声称 APAC TTFB、Worker wall、Smart Placement 或
`cas_schema` header 条件已经达标。需在安全登录态可用后重新安排受控 canary；
若要满足 D-AC05，还需为可观测的部署后首个请求重新建立 cold canary 窗口。

## Stability and rollback

- 观察窗口：production workflow 在 `2026-10-08T08:28:34Z` 成功结束；workflow
  内的五个 public origin probe 均通过。在 `2026-10-08T08:44:03Z` 进行无正文
  APAC follow-up probe：API `200` / 520 ms / HKG，console `302` / 655 ms / HKG，
  Spaces `200` / 640 ms / NRT，product `200` / 512 ms / HKG，docs `200` /
  927 ms / HKG。该结果证明 public origins 在 T+15 仍可用，不是 authenticated
  directory SLO 或 Worker response-construction wall 证据。
- Worker outcome、CPU/wall 与 5xx：Cloudflare dashboard 未登录，待执行。
- Rollback threshold：待判断
- Rollback disposition：release workflow、canonical smoke 与 origin probe
  以及 T+15 public probe 没有触发回滚；性能门禁尚未观测，因此仍保留上述四个
  已知良好 version 作为 rollback targets。
- 最终结论：production 发布成功且可由 immutable tag 复核；性能验收仍被 APAC
  authenticated canary、Workers metrics 和 15 分钟稳定性证据阻塞。

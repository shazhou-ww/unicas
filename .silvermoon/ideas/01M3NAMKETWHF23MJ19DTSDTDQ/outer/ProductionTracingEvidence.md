# 生产 tracing 部署证据

记录日期：2026-10-08 至 2026-10-09。

本记录只保存聚合计数、时间窗、部署 revision、workflow、版本和字段审计
结果。它不保存 trace ID、correlation ULID、App、Space、Principal、
Account、credential、cookie、token、capability、对象键、原始 payload 或
客户数据。

## 0.01 部署

- 受保护 workflow
  [37749102134](https://github.com/shazhou-ww/unicas/actions/runs/37749102134/attempts/1)
  将 revision `80838475010aa5a5c53bebd5d7dd335ab14be4e7`
  部署为 `production-20261008-571`。
- service 部署与 canonical smoke 于 `2026-10-08T08:26:46Z` 完成；
  Spaces 部署与 release smoke 于 `2026-10-08T08:28:08Z` 完成。
- 两个 dynamic Worker 都使用已批准的 manual sample rate `0.01` 和
  Singapore OTLP destination。Cloudflare native traces 的 `enabled` 与
  `persist` 始终为 `false`。
- 所有 canary 只使用 dedicated synthetic identity、credential、内容和
  identifiers；没有使用客户或真实用户数据。

## 代表性 canary

- 最终 revision 的公开 canary 在
  `2026-10-08T09:04:44Z` 至 `09:05:19Z` 对 health、metadata、OAuth
  invalid refresh、unauthorized MCP 和 rejected Spaces smoke session
  各执行 500 次；2,500/2,500 次响应均符合预期且无网络错误。
  Direct Tempo query retained 17 个 roots：3 个 health success、3 个
  metadata success、4 个 MCP rejection、3 个 OAuth rejection 和 4 个
  Spaces smoke rejection。
- Admin `apps list --limit 1` 执行 200 次，199 次成功、1 次瞬态失败。
  Retained `admin_listApps` root 的时间为 `2026-10-08T08:40:44Z`，晚于
  最终 service deployment。
- 一次 browser-authorized synthetic grant 完成 500/500 次 authenticated
  MCP `tools/list`；retained 5 个 success roots。grant 在 canary 后撤销。
- 10 轮 authenticated Spaces release smoke 全部完成 authenticate、hash、
  lease、upload、commit、verify 和 cleanup。
- 为避免提高批准的 `0.01` rate，额外使用 deterministic sampling 的现有
 接口定向执行一轮完整 synthetic smoke。Retained 时间窗为
  `2026-10-08T08:57:05Z` 至 `08:57:32Z`，共 4 个 `spaces.request`
  roots 和 159 个 spans，跨 `unicas-spaces` 与 `unicas` 两个 resource。

定向 retained waterfall 覆盖：

- 25 个 `unicas.fetch` 和 17 个 `unicas.request`；
- 17 个 `unicas.capability.verify` 和 19 个 `unicas.do.dispatch`；
- 44 个 `unicas.d1`，包含 lease、commit、node、refs 与 upload lifecycle；
- 28 个 `unicas.r2`，包含 `put`、`get`、`head` 与 upload lifecycle；
- 3 个 `unicas.node.validate` 和 2 个 `unicas.root_refs.commit`；
- Spaces roots 包含 `file_upload`、`folder_create` 与 `entries_list`。

这 159 个 spans 只有 4 个预期 roots，所有 child parent 均可在 retained
trace 中解析。它证明 upload、validation、commit、D1、R2、Durable Object
和跨 Worker fetch 的代表性 hierarchy。

## Retained field 审计

- 对定向 waterfall 的 159 个 spans 和 431 个 span attributes 逐项应用
  repository allowlist：0 个未知 span、attribute、非法类型、非法 token
  或越界 numeric value。
- Resource fields 只出现 allowlisted `service.name`；instrumentation scope
  为 `@unicas/observability@0.1.0`。
- 0 events、0 links、0 status message，且没有 URL、header、cookie、OAuth
  value、capability、raw identifier、body、content、path、filename、
  object key、SQL、binding、error message 或 provider payload。
- 最终 revision 的 17 个 public/error roots 也通过相同审计，0 violations。
- Admin、authenticated MCP、OAuth 和早期 public retained window 合计审计
  同样为 0 prohibited/unknown fields。

一个 streamed `file_download` trace 在 repeated query 后仍有 8 个
`unicas.request` child 的 parent ID 未 retained；同一 trace 的 3 条
完整上游 fetch chain 和 storage children 仍可用。该限制与 response body
在 root session flush 后继续消费一致。本记录不把该 download waterfall
表述为完整 parentage；D-AC02 依赖上述 parentage 完整的 upload/commit
waterfall。

## Destination operation

- Direct Tempo API 使用单独的最小 `traces:read` credential；ingest policy
  继续只授予 `traces:write`。两个 credential 的值均未写入仓库。
- 2026-10-08 生产复核时，Grafana Portal 显示 trial 剩余 5 天、Max
  Retention 30 天、Traces current usage 0 GB（Portal rounded display）和
  Free Account limit 50 GB。
- Trial 内没有账单；未配置 payment method，也未授权 paid upgrade。
  Free limit 触发的 trace loss 仍按已审核策略接受，而不是自动购买容量。
- Exporter 的一秒 timeout、单并发、每 invocation 最多 16 spans 和
  fail-open 行为未改变。所有生产 canary 的业务响应均独立于 trace export
  成功。

## Sample-zero rollback

- 本机 `cfg` 与 GitHub `Production` environment 的
  `UNICAS_MANUAL_TRACE_SAMPLE_RATE` 均恢复为 `0`。
- release 在回滚期间前进，因此没有发布陈旧的 `808384...`。受保护
  workflow
  [37865051908 attempt 2](https://github.com/shazhou-ww/unicas/actions/runs/37865051908/attempts/2)
  从最新 promotion revision
  `d69e27d086cfdaa6a6449d47122861c89be08db9` 完成真实回滚，并创建
  annotated tag `production-20261009-578`。
- 第一次 zero deployment 已把两个 Worker 发布为 sample `0`，但 Spaces
  release smoke 发现 synthetic smoke credential drift，因此 workflow
  正确失败且没有创建 tag。将受保护 environment secret 重新对齐到批准的
  `cfg` 值后，attempt 2 全部通过。
- Attempt 2 的 validation、service canonical smoke、Spaces seven-stage
  release smoke、product/docs deployment、五个 public origin checks 和
  tag job 均成功。Production self-review 保护在审批后立即恢复为原值。
- 当前 100% active versions 为 service
  `b67cbc0c-eaf2-43de-bc0e-8ad8955d41ff` 和 Spaces
  `a9fcaf65-bad9-4c0e-b2b0-9bd617ddf35b`。两个版本的实际
  `UNICAS_MANUAL_TRACE_SAMPLE_RATE` 都是 `0`，均没有 OTLP endpoint
  binding；因此 runtime 不构造 manual exporter。
- Cloudflare settings API 对两个 Worker 都返回 native traces
  `enabled=false`、`persist=false`、`head_sampling_rate=0`。
- 回滚后独立执行五类公开 canary 各 50 次；250/250 次响应符合预期且无
  网络错误。Workflow 中同次 authenticated Spaces smoke 完成全部七个
  stage。
- Direct Tempo query 在 `2026-10-09T00:44:43Z` 至 `00:45:08Z`
  对 `unicas` 和 `unicas-spaces` 均返回 0 traces。该空结果只与上述
  runtime sample-zero 配置和同窗成功 synthetic requests 共同作为 rollback
  证据，不作为字段安全证据。

## 结论

D-S03、D-S04、D-AC02、D-AC03 和 D-AC04 已有可复核证据。当前 production
manual sample 为 `0`，Cloudflare native tracing 继续关闭；后续任何非零
生产采样都需要新的明确 destination/rate 决策和重新部署。

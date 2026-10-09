# Ledger

Checked items record completed Agent work and valid evidence only. They do not
record Ideal approval, implementation acceptance, deployment acceptance, or
authorization to select a destination, enable nonzero sampling, or deploy.

## Revalidation

Reviewed on 2026-09-29 against primary baseline
`82c96944384c30fc1076a43726df7066231959f2`.

### Implemented with current evidence

- The reviewed telemetry baseline (`fb3123872b9162886287eabccbdde6597310afec`),
  manual tracing implementation
  (`06c41a6bf3d0420feae54f31aad7aa602a44e4e7`), review publication
  (`ab35b3fceae702d51405ca808de9e7274178605d`), and Silvermoon migration
  (`3ddcfd080c5eadba78b55a4da6ba9da8890ff1c0`) are all reachable from the
  reviewed primary.
- At the initial revalidation, the tracing implementation, production Worker
  configurations, and primary observability contract had not changed since
  the manual tracing implementation. Both dynamic Workers disabled native
  tracing and set `UNICAS_MANUAL_TRACE_SAMPLE_RATE=0`; repository search found
  no checked-in OTLP destination, authorization secret, or trace HMAC key.
  Later destination review and activation-plumbing evidence is recorded below.
- Current Cloudflare [tracing](https://developers.cloudflare.com/workers/observability/traces/),
  [span and attribute](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/),
  [known limitation](https://developers.cloudflare.com/workers/observability/traces/known-limitations/),
  and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
  documentation was rechecked on 2026-09-29. It still lists automatic URL, D1
  SQL, KV key/metadata, R2 key/metadata, Durable Object identity, and Durable
  Object SQL/binding attributes without a documented per-attribute
  pre-persistence redaction control. Tracing remains open beta, and the
  documented 3/7-day retention and 2026-10-01 shared observability event
  pricing still match the repository contract.
- Current focused evidence passed: deployment-policy tests 37/37,
  `@unicas/observability` 20/20, service tracing tests 53/53, Spaces Worker
  tests 14/14, the four affected package typechecks, and documentation tests
  7/7. The first cold documentation run hit its existing 30-second setup
  timeout; an immediate rerun of the unchanged command passed.
- The service build plus direct Wrangler dry run and the Spaces build plus
  Wrangler dry run both passed and reported manual sample `0`.

### Historical evidence and lifecycle boundary

- The files under
  [`outer/inner/legacy-repoledger/`](./outer/inner/legacy-repoledger/) preserve
  the prior task evidence. Git records six files as 100% renames; the retained
  `Task.md` differs only by replacing a link to the now-completed App-user v1
  task with equivalent prose.
- Prior Repoledger scope, interface, and architecture approvals remain
  historical context only. Separate explicit Silvermoon decisions later
  approved Ideal revision
  `53803c529f152bce1a487ecf3c8fe9afcfcdaad3` and accepted Implementation
  revision `17055c7d9bc0a1716cfef028d6ce256b5da4d99a`. No deployment revision has
  been accepted.
- The current Ideal and Implementation contracts did not require correction
  during destination onboarding.

## Destination onboarding

Reviewed on 2026-09-29. The non-sensitive operational record is
[`outer/GrafanaCloudDestination.md`](./outer/GrafanaCloudDestination.md).

- Grafana Cloud was selected for synthetic deployment validation. The stack is
  in Singapore (`ap-southeast-1`) and exposes the reviewed credential-free
  OTLP/HTTP traces endpoint.
- The active stack-scoped `unicas-manual-traces-ingest` policy grants only
  `traces:write`. A read-only role count found one Admin and no Editor or Viewer
  members.
- A 90-day token and its instance ID were stored only as
  `cfg:GRAFANA_ACCESS_TOKEN` and `cfg:GRAFANA_INSTANCE_ID`. Their values were
  not recorded, and no Cloudflare Worker secret was changed.
- UniCAS maintainers own the destination lifecycle, token rotation and
  revocation, and first incident response. Trace reading is restricted to
  Grafana organization administrators.
- The current 14-day unlimited trial is unbilled and automatically transitions
  to Free. Trial use is limited to synthetic non-sensitive traces with up to
  30-day retention; production sampling remains zero. The Free 14-day
  retention and current instance limits must be rechecked before a nonzero
  production sample.
- No payment method or paid upgrade is authorized. Free-limit trace loss is
  accepted rather than purchasing capacity without a separate decision.
- The reviewed deletion response restores sample zero if needed, revokes the
  token, fixes the source, and uses an organization-administrator Grafana
  Support request while UniCAS maintainers track closure.
- Destination failures remain bounded to the accepted one-concurrent-request,
  one-second-timeout, fail-open exporter behavior.
- A local synthetic exporter canary authenticated successfully and was
  retained as one `unicas.request` root with one `unicas.fetch` child. A
  read-only Tempo lookup found only synthetic `service.name/version` and the
  expected correlation, operation, peer, outcome, and status-class fields.
  This proves destination compatibility for one shape, not representative
  Worker coverage or comprehensive field safety.

### 生产验证与回滚

2026-10-08 至 2026-10-09 的非敏感聚合证据见
[`outer/ProductionTracingEvidence.md`](./outer/ProductionTracingEvidence.md)。

- Exact revision `80838475010aa5a5c53bebd5d7dd335ab14be4e7`
  以批准的 manual sample `0.01` 部署为 `production-20261008-571`。
  Cloudflare native traces 始终关闭。
- 最终 revision 的 2,500 次公开 success/error canary 全部返回预期结果；
  Admin、authenticated MCP 和 10 轮 authenticated Spaces smoke 也完成。
- 定向 retained Spaces waterfall 共 159 spans，覆盖 cross-Worker fetch、
  request、capability、Durable Object、D1、R2、node validation 和 Root Ref
  commit。159 个 spans 的 parent 均可解析。
- 对这 159 个 spans 和 431 个 attributes 的 strict allowlist audit 为
  0 violations、0 events、0 links、0 status message。其他代表性 retained
  success/error windows 同样为 0 prohibited/unknown fields。
- Streamed `file_download` trace 重查后仍有 8 个 unresolved request
  parents；ledger 不把该 trace 表述为完整 parentage。D-AC02 的完整
  hierarchy 证据来自 upload/commit waterfall。
- Grafana production recheck 记录 trial 剩余 5 天、Max Retention 30 天、
  rounded current usage 0 GB 和 Free Account limit 50 GB；没有 paid
  upgrade 授权。
- Sample rate 已在 `cfg` 和受保护 environment 恢复为 `0`。最新 release
  revision `d69e27d086cfdaa6a6449d47122861c89be08db9` 通过 workflow
  `37865051908` attempt 2 完成真实回滚并创建
  `production-20261009-578`。
- 当前 service 与 Spaces active versions 的实际 sample rate 都是 `0`，
  没有 OTLP endpoint binding；native traces 为
  `enabled=false`、`persist=false`。回滚后 250/250 次公开 synthetic
  canary 成功，同窗 direct Tempo query 对两个 service 均返回 0 traces。
- 第一次 zero deployment 的 synthetic smoke 暴露 credential drift，
  workflow 正确失败且未 tag；重新对齐受保护 secret 后完整 rerun 通过。
  Production self-review 保护已恢复为原值。

## Implementation

### Implementation steps

- [x] **I-S01:** Establish the telemetry safety contract
- [x] **I-S02:** Implement the bounded portable tracing pipeline
- [x] **I-S03:** Instrument the service and Spaces boundaries
- [x] **I-S04:** Document and test the operational contract
- [x] **I-S05:** Make manual tracing activation repeatable

### Implementation acceptance criteria

- [x] **I-AC01:** Telemetry excludes prohibited data
- [x] **I-AC02:** Manual tracing is bounded and fail-open
- [x] **I-AC03:** Cross-boundary traces preserve isolation
- [x] **I-AC04:** Current builds keep production export dormant
- [x] **I-AC05:** Activation is atomic, shared, and secret-safe

### Activation plumbing evidence

Validated on 2026-09-29 without using the Grafana credential, changing a
Cloudflare secret, or deploying a Worker.

- One shared deployment resolver uses the runtime sample-rate, endpoint, and
  HMAC validators. A nonzero rate requires the complete endpoint,
  authorization, and HMAC profile; zero ignores inactive destination values
  and preserves the checked-in dormant configuration.
- The service deployment passes only rate and endpoint as Wrangler variables.
  A separate `wrangler secret put` command sends authorization and HMAC values
  over standard input, never command arguments.
- The Spaces production generator applies the same public variables and puts
  the same two values only in its existing mode-0600 ephemeral secrets file.
  Bootstrap explicitly forces sample zero, and secret cleanup now also runs
  when preparation fails.
- The protected Production workflow supplies the same generic profile to both
  dynamic Workers. It contains no Grafana-specific credential construction,
  and validation jobs receive no production variables or secrets.
- Deployment-policy tests pass 42/42, `@unicas/observability` passes 20/20,
  service tracing tests pass 53/53, Spaces Worker tests pass 14/14, and all
  four affected package typechecks pass.
- Documentation tests pass 7/7. The first cold run again reached the existing
  30-second setup timeout before running a test; the immediate unchanged rerun
  passed.
- Current zero-rate service and Spaces Wrangler dry runs pass and report
  `UNICAS_MANUAL_TRACE_SAMPLE_RATE=0`.
- Synthetic nonzero service and generated Spaces Wrangler dry runs pass with
  rate `0.01` and a credential-free example endpoint. Dummy authorization and
  HMAC values were used only for local validation, were excluded from command
  arguments and public config, and no external request or deployment ran.

## Deployment

### Deployment steps

- [x] **D-S01:** Approve and provision an OTLP destination
- [x] **D-S02:** Approve a bounded nonzero sample
- [x] **D-S03:** Deploy and run synthetic canaries
- [x] **D-S04:** Inspect retention and prove rollback

### Deployment acceptance criteria

- [x] **D-AC01:** Destination governance is explicit
- [x] **D-AC02:** Representative waterfalls are useful
- [x] **D-AC03:** Retained telemetry contains no prohibited values
- [x] **D-AC04:** Production operation remains bounded and reversible

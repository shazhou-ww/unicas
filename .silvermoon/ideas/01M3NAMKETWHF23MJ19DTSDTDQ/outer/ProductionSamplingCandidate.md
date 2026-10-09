# 0.01 生产采样候选记录

记录日期：2026-10-08。

候选提交：
`7ae12f3f8e0c596beaa1afbc75246f2832eb10ca`。

## 已明确的决策

- 初始 manual OTLP 生产采样率明确批准为 `0.01`。
- 目的地继续使用已审核的 Grafana Cloud Singapore
  (`ap-southeast-1`) OTLP/HTTP traces endpoint。
- Cloudflare 原生 tracing 必须继续保持关闭；本次决策只适用于 UniCAS
  allowlist 约束下的 manual exporter。
- 本次决策不构成 Worker 发布、代表性生产 canary 完成、字段安全验收或部署验收。

## 完整 profile

- `UNICAS_MANUAL_TRACE_SAMPLE_RATE` 与 credential-free endpoint 已保存在
  `cfg`。
- 完整 Grafana Basic authorization 值只在内存中从原有
  `cfg:GRAFANA_INSTANCE_ID` 和 `cfg:GRAFANA_ACCESS_TOKEN` 构造，并以 secret
  形式保存为 `cfg:UNICAS_OTLP_AUTHORIZATION`。
- 新生成的 32-byte HMAC key ring 以 `2026-10` 为 active version，并以
  secret 形式保存为 `cfg:UNICAS_TRACE_HMAC_KEYS`。
- 本记录不包含 instance ID、token、authorization header 或 HMAC key
  的值。

## 候选验证

- `pnpm exec vitest run tests/deploy-plan.test.mjs`：42/42 通过。
- service deployment plan 接受完整 `0.01` profile；service build 与
  Wrangler `--dry-run` 通过，公开变量只有采样率和 credential-free
  endpoint。
- 一次性 Spaces production candidate 明确验证采样率为 `0.01`、endpoint
  与审核记录一致、Cloudflare 原生 tracing 的 `enabled` 与 `persist`
  均为 `false`，且 public vars 不包含 authorization 或 HMAC key ring。
- Spaces build 与该 candidate 的 Wrangler `--dry-run` 通过；一次性配置
  已删除。
- 同一四项 profile 已同步到受保护的 GitHub `Production` environment。
  回读确认采样率为 `0.01`、endpoint 与审核记录一致，且两个 secret
  名称均已配置；验证过程没有读取 GitHub secret 值。
- 没有同步 Cloudflare Worker secret，没有发布 Worker，也没有向
  Grafana 发送新的 trace。四项 profile 只会在受保护 release
  deployment 中由现有 service 与 Spaces step 注入两个动态 Worker。

## 生产执行结果

- D-S02 的 `0.01` profile 通过受保护 workflow 部署到 exact revision
  `80838475010aa5a5c53bebd5d7dd335ab14be4e7`，production tag 为
  `production-20261008-571`。
- Synthetic canary 覆盖 service、Spaces、fetch、D1、R2、Durable
  Object、Admin、MCP、OAuth、success 与 error paths。Direct retained
  inspection 和字段审计结果见
  [`ProductionTracingEvidence.md`](./ProductionTracingEvidence.md)。
- 生产复核完成后，sample rate 已恢复为 `0`。受保护 workflow 从最新
  release revision `d69e27d086cfdaa6a6449d47122861c89be08db9`
  完成真实回滚，并创建 `production-20261009-578`。
- 当前两个 dynamic Worker 的实际 sample rate 均为 `0`，没有 OTLP
  endpoint binding；Cloudflare native tracing 继续保持关闭。

该候选记录保留最初的批准与 dry-run 事实；生产 retained evidence、
已知 streamed-response parentage limitation 和 rollback 结果以 linked
Outer World evidence 为准。

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

## Remaining gate

- D-S02 已完成：精确 rate 已批准，同一完整 profile 已配置给两个动态
  Worker 的受保护部署路径，且两个 bundle 的候选 dry run 已通过。
- Draft promotion PR
  [#28](https://github.com/shazhou-ww/unicas/pull/28) 将 `main` 提升到
  `release`。其初始候选 head
  `b03f870cdefb305dc77c3578f53c43a781658f10` 可合并，CI `validate`
  已通过；`Deploy production` 与 `Tag verified production deployment`
  均按预期跳过。
- PR #28 保持 draft 且未合并，因此没有生产发布。它包含上次 production
  promotion 之后的 53 个 non-merge commits，不只包含 tracing 变更。
- D-S03 仍需发布精确 revision，并只用 synthetic non-sensitive data
  覆盖 service、Spaces、fetch、D1、R2、Durable Object、Admin、MCP 与
  OAuth 路径。
- D-S04 仍需直接检查 retained fields、有效 retention/limit/cost，并
  证明将采样率恢复为 `0` 的回滚。

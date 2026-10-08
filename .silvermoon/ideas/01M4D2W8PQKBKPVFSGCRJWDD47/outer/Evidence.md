# Deployment evidence

## Candidate

- Idea：`spaces-entries-latency`
- ULID：`01M4D2W8PQKBKPVFSGCRJWDD47`
- 已验收 Implementation revision：
  `ed42de517d1694ac17e8c68aab471cebf04aa929`
- 实现 commit：`65605f2073e63623699ec8f235b221709f85ff92`
- acceptance commit：`8a1f360c7e86f6d303384754c617105a96966fa4`
- production release revision：待发布
- production tag：待发布

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

- 发布前 production tag：待记录
- 发布前 `release` tip：待记录
- 已知良好 service version：待记录
- 已知良好 Spaces version 与 placement：待记录
- 并发 production workflow：待检查

## Release execution

- Promotion PR：待发布
- Release merge SHA：待发布
- Production workflow：待发布
- `CAS_DB` migration：待发布
- Canonical service smoke：待发布
- Spaces file smoke：待发布
- Public origins：待发布
- 发布后 service version：待发布
- 发布后 Spaces version：待发布

## APAC authenticated canary

- Probe 与时间窗口：待执行
- Cold observation：待执行
- 请求数与成功率：待执行
- TTFB p50/p95/p99/max：待执行
- Worker wall p50/p95/p99/max：待执行
- Colo 与 placement：待执行
- 安全 Server-Timing 汇总：待执行

## Stability and rollback

- 观察窗口：待执行
- Worker outcome、CPU/wall 与 5xx：待执行
- Rollback threshold：待判断
- Rollback disposition：待判断
- 最终结论：待执行

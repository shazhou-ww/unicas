# 契约对齐证据

## 权威来源

| Surface | 权威来源 | 对齐方式 |
| --- | --- | --- |
| HTTP operation 与 schema | `packages/space-protocol/src/space-contract.ts` | oRPC contract 生成 OpenAPI；drift test 比较受版本控制 artifact |
| Capability claims 与 operation authority | `packages/space-protocol/src/space-capability.ts` | service 直接消费 policy；OpenAPI vendor extension 由同一 schema/policy 生成 |
| HTTP transport | `packages/space-client/src/transport.ts` | focused test 证明 Range header、零长度短路及错误状态保留 |
| Runtime wire 行为 | `packages/service` 与 `packages/service-cloudflare` | focused service/adapter tests 证明 range、validation 和 error presentation |
| 集成文档 | `packages/docs-site/content/app-user-api` | 文档引用 machine-readable source，不定义第二份 schema |

## 兼容性与 SemVer

本候选只补充已存在 wire 行为的 TypeScript/OpenAPI/文档表示，并把既有授权
policy 收敛为共享源码。`/v1` 路径、请求和响应 bytes、状态码、稳定 error code、
capability `ver: 1`、permission、Root Ref 原子语义及 client 方法保持不变。

结论：这是向后兼容的 contract correction，可进入现有后续 package 候选，无需
consumer migration。已发布 `0.1.1` 保持不可变；本 idea 不选择版本、不更新
dist-tag，也不授权 publish 或 deployment。

## Validation 与 error 分类

| 类别 | Normative public contract | 仅实现诊断 |
| --- | --- | --- |
| Node read | full/range 状态与 header、`NODE_NOT_FOUND`、`416 INVALID_REQUEST` | object offset、repository read 和存储日志细节 |
| Lease-driven upload | lease JSON shape、公开 state/rejection、`CAS_UPLOAD_LIMIT` | presigned transport 凭据、临时 object key、generation/storage diagnostics |
| Root Refs | canonical request identity、重复 key 拒绝、1..1000 changes、delta bound、readiness、aggregate、idempotency error | retry timing、repository conflict 和内部 projection 细节 |
| Authorization | issuer-derived App、signed Space、exact permission、Root Ref `refDomain`、稳定 denial code | cache/refresh telemetry 和安全日志字段 |

## 验证记录

### Focused contract 与 runtime

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @unicas/space-protocol typecheck` | 通过；公开 `readContent` output 保持 `ReadableStream<Uint8Array>`，input 保持无需 `headers` |
| `pnpm --filter @unicas/space-protocol docs:generate` | 通过；重新生成受版本控制 OpenAPI |
| `pnpm --filter @unicas/space-protocol test` | 通过；4 files、28 tests |
| `pnpm --filter @unicas/service typecheck` | 通过 |
| `pnpm --filter @unicas/service test` | 通过；17 files、139 tests |
| `pnpm --filter @unicas/space-client typecheck` | 通过 |
| `pnpm --filter @unicas/space-client test` | 通过；1 file、6 tests |
| `pnpm --filter @unicas/service-cloudflare typecheck` | 通过 |
| `pnpm --filter @unicas/service-cloudflare exec vitest run tests/do.test.ts --testTimeout=15000` | 通过；1 file、24 tests，包含 full/range/unsatisfiable read |
| `pnpm --filter @unicas/docs-site test` | 通过；1 file、7 tests |

### Repository、artifact 与 consumer

| 命令 | 结果 |
| --- | --- |
| `pnpm check:repo` | 通过；Silvermoon worktree 与 6 files、165 repository tests |
| `pnpm --workspace-concurrency=1 --filter "!@unicas/service-cloudflare" -r test` | 通过；全部非 Cloudflare workspace package tests |
| `pnpm --workspace-concurrency=1 -r build` | 通过；16 个 workspace projects |
| `pnpm --workspace-concurrency=1 -r typecheck` | 通过；16 个 workspace projects |
| `pnpm sdk:prepare` | 通过；OpenAPI drift、public package build、packed declaration、Node 和三浏览器 consumer 全部通过并刷新 SDK baselines |
| `pnpm check:sdk-release` | 通过；22 SDK tests、OpenAPI drift、packed declaration、Node 和三浏览器 consumer |
| `git diff --check` | 退出码 0；仅报告既有 Silvermoon 文件的 CRLF-to-LF warning |

`pnpm validate` 的两次并发执行分别在已通过另一轮的 docs 30 秒测试和
workspace path scan 5 秒测试发生资源竞争型 timeout，未出现 assertion failure。
随后按相同组成项串行执行上表的 repo checks、package tests、build 和 typecheck，
全部通过。并行 workspace build 还曾因 root 与 service-cloudflare 同时重建
admin-webui 而在 Windows 删除同一 `dist` 时得到 `EPERM`；串行拓扑构建通过，
未修改无关 timeout 或 build script。

实现交付 commit：`837255ffd626be41635f45345e20957d8371fe20`。本记录
未执行 npm publish、dist-tag 修改或 production deployment。

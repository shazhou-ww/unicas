# 实施复核

## 结论

实施候选具备提交条件；本复核不是 `acceptInner` 事件或生产变更授权。
保留已接受的 ideal 与现有事件历史，部署清单仍未完成。

父 agent 直接审查了原子提交、权限与转发、App actor 路由、审计分页、
迁移/重放桥接和消费者契约。丢失 revision CAS 通过 NOT NULL 约束令整个
D1 batch 回滚；旧请求重放保留原结果，不合并或重编号旧事件。
未发现需要阻止本实施候选提交的代码问题。

发现并修复的复核问题：

- 公开文档多处仍描述 domain claim、负 domain balance 或 `_legacy` sentinel。
  已交回同一个实施 agent 修正，并增加文档语义回归测试。
- 标准 `pnpm check:ideas` 被项目级 Silvermoon 0.3.0 遮蔽，拒绝已经迁移的
  v2 schema。已删除旧项目依赖及技能副本，改用设备级 0.5.0；
  CI 与文档部署工作流在检查前安装同一全局运行时，并更新指导及回归测试。
  这修复的是本次 schema 迁移引出的检查阻塞，不改变业务模型。

## 父 agent 独立验证

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @unicas/space-protocol --filter @unicas/admin-protocol --filter @unicas/service --filter @unicas/space-client --filter @unicas/admin-client --filter @unicas/admin-cli test` | 6 包、319 tests 通过 |
| `pnpm --filter @unicas/service-cloudflare exec vitest run tests\root-refs.test.ts tests\audit-reads.test.ts tests\do.test.ts tests\app-admin-adapter.test.ts tests\audit-rpc.test.ts --testTimeout=15000` | 60 tests 通过，包括真实 D1 CAS/整批回滚、桥接和路由 |
| `pnpm typecheck` | 27 tasks 通过 |
| `pnpm release:sdk:check` | 最终运行通过；22 tests、OpenAPI 漂移、打包声明、Node consumer/quickstart、Chromium/Firefox/WebKit 均通过 |
| `pnpm docs:check` | 修正文档后 8 tests 通过 |
| `pnpm exec vitest run tests\root-refs-cutover.test.mjs tests\openapi-drift.test.ts tests\deploy-plan.test.mjs tests\agent-guidance.test.mjs tests\release-gated-ci.test.mjs` | 最终 74 tests 通过 |
| `pnpm check:ideas` | 修复运行时遮蔽后通过 |
| `git diff --check` | 通过 |

最初完整运行迁移、OpenAPI、部署计划与 boundary 的组合：164 通过、1 失败。
失败来自既有且未跟踪的 `stacks` 目录，未删除、移动该目录或弱化断言。
随后将暂存候选树 `b3bd3e08d1e8` 用 `git archive` 展开为干净临时快照，
仅联接已有依赖，使用同一个已安装 Vitest 执行
`run tests\workspace-boundaries.test.mjs --root <snapshot>`：**106/106 通过**。
这是候选快照的完整 boundary 验证，不代表原始工作目录的该项环境失败消失。
验证联接与快照随后清理；本复核材料不改变被检查的包或边界规则。

## 外部前提

本地迁移副本不等于生产 D1 转移方案；目标、备份、写入栅栏、导入/恢复演练、
保留期限和兼容退出证据仍须在部署阶段确定。首次新写入之后不能恢复旧 writer
或丢弃新事件回退旧快照。未执行部署、生产迁移、npm 发布或冻结环境操作。

## 后续故障演练复核

隔离 D1/真实 DO HTTP 演练发现先前测试未覆盖的默认值缺陷：
DO 显式传入 `maxAttempts: undefined` 时，默认次数被覆盖，持续存储失败
不能结束重试。新增回归测试在旧实现上明确失败且以第六次调用中止，避免测试挂死；
修复后准确执行五次尝试，并验证四次默认退避为 `[25,50,100,200]`。

修复只改变可选参数为 `undefined` 时的默认值合并，保留显式配置与异常传播。
核心 6 tests、Cloudflare 34 tests、两包 typecheck 及核心构建通过；
真实本地故障注入得到 387ms 的 503 响应，整批状态不变且后续请求恢复。
本轮未改变理想世界、公网 API、数据模型或生产资源，但改变了内层修订，
需要新的 `submitInner` 和针对准确修订的实现验收。

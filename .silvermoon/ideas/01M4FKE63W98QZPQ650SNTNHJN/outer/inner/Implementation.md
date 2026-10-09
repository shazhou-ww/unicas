# Implementation

本 Implementation 实现已批准的理想世界 revision
`50d31809775730ea684075a49e15d25a961728bd`。本候选只改变 repository-owned
workflow trigger、本地 Git hook、回归测试与开发文档；不降低
`pnpm validate`/`pnpm validate:release` 的断言，不修改 production/npm
artifact trust boundary，也不执行 repository settings、deployment、tag 或
npm 外部写入。

## Steps

### I-S01: 审计远端基线与有效保护设置

用 GitHub API 读取 `main` branch protection、repository ruleset 和最近 30 天
CI/Security workflow runs。按 workflow/event 记录 run 数、completed job runner
分钟、成功/失败/取消数，并单列 Silvermoon `main` 同步成本。只读审计结论写入
`ImplementationEvidence.md`；任何 settings 写入继续保留给 Deployment。

### I-S02: 将远端完整验证收敛到 release 边界

把 `.github/workflows/ci.yml` 收敛为 `release` push 和显式
`workflow_dispatch`，两条路径都运行 `pnpm validate:release`；保留 release
exact-revision check、protected production rebuild、smoke 与 immutable tag。
移除普通 branch、PR、`main` push 的完整 validation 和 main-push
`check:ideas:remote`。Security workflow 保留 PR、`release`、weekly schedule
和 manual trigger，Dependency Review 仍只在 PR 执行。

### I-S03: 实现 main exact-revision pre-push

增加薄 `.githooks/pre-push` 和 Node.js dispatcher。dispatcher 解析 stdin
全部 ref update，只在 remote ref 包含 `refs/heads/main` 时执行一次
`pnpm validate`。它必须证明 local object 是可用 commit、等于 checked-out
`HEAD`，且验证前后 worktree 均 clean、`HEAD` 未变化；删除 main、脏 worktree、
非 HEAD revision、输入错误和 validation failure 一律拒绝 push。非 main push
不运行 validation。

### I-S04: 提供显式且不覆盖用户配置的 hook 生命周期

增加 `pnpm hooks:install`、`hooks:status` 和 `hooks:uninstall`。安装器只设置
repository-local `core.hooksPath=.githooks`，重复安装/卸载保持幂等；遇到已有
local、global 或 system `core.hooksPath` 时保留原值并返回可诊断冲突。不得修改
global Git config 或复制 validation command list。

### I-S05: 固化 regression tests 与开发者责任边界

增加 workflow trigger、release gate、multi-ref、exact SHA、dirty/non-HEAD、
validation failure、安装幂等和 inherited conflict 测试，并纳入
`pnpm check:repo`。更新 README、CONTRIBUTING、Silvermoon/Agent validation
说明和 validation/release 文档，明确 `--no-verify` 是可见绕过、不是成功证明，
且 Agent 在 primary 同步后仍显式运行 `pnpm check:ideas:remote`。

### I-S06: 验证并发布 implementation 证据

运行 focused regression、hook CLI diagnostics、`pnpm validate` 和 Silvermoon
worktree/staged checks。记录精确命令、结果、候选 diff、外部只读审计与预期
runner 降幅；仅提交并同步 repository deliverables，不触发 release、
production、tag、npm publish 或 settings 写入。

## Acceptance criteria

### I-AC01: 普通更新不再触发完整远端 validation

解析 workflow YAML 的测试必须证明 CI 只有 `release` push 与 manual preflight，
普通 branch、PR、`main` push 和 tag 不会启动该 workflow；Security 不再由
`main` push 触发，Dependency Review 仍只属于 PR。

### I-AC02: release gate 仍是 authoritative 外部写入前置

workflow regression 必须证明 `release` candidate 在 clean hosted runner
运行 exact-revision check 和 `pnpm validate:release`，production 仍依赖该 job
并在 protected environment 中重新安装、验证、部署与 smoke。manual preflight
不得获得 production 写入路径。

### I-AC03: pre-push 对精确 main revision fail closed

自动化测试必须证明非 main push 立即通过；包含 main 的 multi-ref push 只验证
一次；main deletion、malformed stdin、缺失 commit、local SHA 不等于 HEAD、
dirty worktree、validation failure、验证期间 HEAD 或 worktree 改变都会失败。
成功消息必须标识实际 SHA 与 `pnpm validate`。

### I-AC04: hook 生命周期跨配置来源可诊断

测试必须证明安装/卸载幂等且只写 local config；已有 local 或 inherited
`core.hooksPath` 被保留并导致显式冲突。tracked hook 只负责定位仓库并调用 Node
dispatcher，业务逻辑不依赖 Bash 或 PowerShell。

### I-AC05: runner 基线与 settings 风险有持久证据

`ImplementationEvidence.md` 必须给出固定 UTC 时间窗、完整分页统计口径、
普通 `main`/PR/branch、release、Security 和 Silvermoon 子集成本，并记录有效
branch protection/ruleset 读取结果。若没有 required checks，也只记录事实；
不得在 Implementation 中写入 settings。

### I-AC06: repository candidate 可重复验证且无外部写入

focused tests、`pnpm validate`、Silvermoon worktree/staged checks 必须通过，
命令与结果写入证据和 ledger，候选必须同步到 refreshed primary。验证不得运行
release push、deployment、tag、npm publication 或复用端侧 artifact。

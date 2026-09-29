# 统一 Agent 技能与指令目录

## Intent

将 UniCAS 仓库中的 Agent 技能和可复用指令统一收敛到 `.agents/`，使其成为
唯一受支持、受版本控制的规范来源，并移除对 `.github/instructions` 和
`.claude/skills` 等 provider-specific 布局的依赖。

## Context

当前仓库已经以 `.agents/skills/` 保存 Silvermoon、评审技能和 UniCAS
专用技能，但仍存在两类分散状态：

- 包边界规则保存在 `.github/instructions/packages.instructions.md`，依赖
  GitHub Copilot 专用的 path-scoped instruction 发现机制；
- 本地 `.claude/skills/` 中存在指向 `.agents/skills/` 的 junction，其中
  一部分仍指向已经移除的旧任务技能。该目录已被 `.gitignore` 忽略，且
  Claude 不是当前日常开发环境。

这种混合布局让技能的规范来源、安装目标、引用路径和实际可发现范围不够
清晰，也容易让安装工具重新生成不再受支持的 provider-specific 投影。

## Desired outcome

`.agents/` 成为仓库中 Agent 技能与可复用工程指令的唯一规范根目录：

- 所有可发现技能都位于 `.agents/skills/<skill-name>/`；
- 现有包边界 instruction 以 `.agents` 下的规范形式继续生效，并在修改
  `packages/**` 或 `stacks/unicas/**` 时可靠触发；
- 仓库不再跟踪、引用、安装或要求 `.github/instructions`、
  `.github/skills` 或 `.claude/skills`；
- 根级 `AGENTS.md` 仅保留必要的全局约束和技能路由，不复制技能正文；
- 外部安装技能、包内 canonical 技能和仓库自有技能的来源及更新方式清晰，
  且 `skills-lock.json` 与实际受管理技能保持一致；
- VS Code/Copilot 日常开发可以从 `.agents` 发现所有必要能力，缺少 Claude
  兼容投影不构成支持缺口。

## Scope

### In scope

- 盘点 `.agents`、`.github/instructions`、潜在 `.github/skills`、
  `.claude/skills`、`AGENTS.md`、`skills-lock.json` 及其内部引用。
- 将包边界规则迁移为 `.agents` 下可发现的仓库技能或等效规范资产，并保留
  原有适用范围与全部边界约束。
- 更新 `AGENTS.md`、技能间链接、安装命令、维护说明和测试，使它们只引用
  `.agents` 中的规范位置。
- 移除仓库内 provider-specific Agent 技能或 instruction 布局；清理当前
  本机中已忽略的 `.claude/skills` 兼容 junction，不将其作为支持面恢复。
- 明确区分外部安装技能、随依赖发布的 canonical 技能和 UniCAS 仓库自有
  技能，并为每类保留可重复的更新路径。
- 增加聚焦的仓库守卫，阻止新的 tracked Agent 技能或 instruction 再次
  分散到 `.agents` 之外，并验证技能 frontmatter、链接和发现结果。

### Out of scope

- 为 Claude、Cursor 或其他非日常 Agent 平台建立兼容目录、软链接或复制层。
- 移动 `.github/workflows`、GitHub Actions 配置或其他并非 Agent
  技能/instruction 的 `.github` 内容。
- 改写现有技能的业务流程、触发语义或安全边界，除非迁移路径所必需。
- 改变 UniCAS 包所有权、依赖方向、部署边界或运行时架构。
- 修改 Silvermoon 的上游布局协议或其 packaged canonical skill。
- 新增与目录统一无关的 Agent 能力。

## Constraints

- `.agents/skills/silvermoon` 必须继续与当前安装版本携带的 canonical skill
  完全一致，不能为仓库局部需求直接修改。
- 同一份规则只能有一个规范正文；不得通过复制到多个 provider 目录维持
  兼容。
- 包边界规则迁移后必须保持对 `packages/**` 和 `stacks/unicas/**` 工作的
  强制适用性，不能因目录统一而变成可选提示。
- 使用技能安装/移除工具管理外部技能及其 lock 记录；仓库自有技能继续由
  Git 直接管理，不伪装成外部安装内容。
- 保留 `.claude/` 的忽略边界，避免本地工具生成物进入版本控制；不承诺
  Claude 发现或执行仓库技能。
- 迁移必须通过 Silvermoon snapshot 校验、Agent 资产聚焦测试、相关仓库
  检查和链接检查，并保持现有运行时代码行为不变。

# Implementation

## Steps

### I-S01: 收敛规范目录

将现有包边界 instruction 迁移为
`.agents/skills/unicas-package-boundaries/SKILL.md`，删除仓库中的
provider-specific Agent instruction/skill 布局，并保留 `.claude/` 的本地忽略
边界而不创建任何 Claude 兼容投影。迁移只改变 Agent 指导资产，不改变包结构、
依赖或运行时代码。

### I-S02: 保持包边界规则强制适用

在根级 `AGENTS.md` 中把任何涉及 `packages/**` 或 `stacks/unicas/**` 的修改
明确路由到 `unicas-package-boundaries` skill，并在新 skill 中保留原
instruction 的全部访问面、依赖方向、服务分层和 Durable Object 单写者约束。
更新其他技能中的包边界链接，使规范正文只有一份。

### I-S03: 记录技能所有权和更新路径

新增 `.agents/README.md`，区分外部安装技能、依赖包携带的 canonical skill
和 UniCAS 仓库自有技能。为每类记录可重复的安装、更新或直接维护方式，要求
安装工具使用 universal `.agents` 目标，并说明 `skills-lock.json` 只登记由
安装工具管理的技能。

### I-S04: 增加 Agent 资产守卫

新增聚焦测试并接入根级检查。守卫验证 `.agents/skills` 的发现清单和
frontmatter、Markdown 本地链接、受管理技能与 `skills-lock.json` 的对应关系、
Silvermoon skill 与依赖携带版本的一致性、包边界强制路由，以及不存在仓库外
provider-specific 技能或 instruction 候选。

### I-S05: 验证可审阅候选

运行 Agent 资产聚焦测试、工作区边界测试、完整仓库检查、skills CLI 发现检查
及 Silvermoon worktree/staged snapshot 校验。将可复现证据写入 ledger，审查
最终 diff，并确认候选已准备好通过普通非 force Git 流程发布。

## Acceptance criteria

### I-AC01: `.agents` 是唯一规范根目录

所有可发现技能都直接位于 `.agents/skills/<skill-name>/`，仓库候选中没有
provider-specific Agent skill/instruction 布局，本机隔离 worktree 中也没有
Claude compatibility projection。由 Agent 资产守卫和
`npx skills list --json` 的精确发现清单共同证明。

### I-AC02: 包边界约束仍然强制且完整

根级 `AGENTS.md` 明确要求修改 `packages/**` 或 `stacks/unicas/**` 前加载
`unicas-package-boundaries`，新 skill 保留迁移前的全部包边界约束且没有第二份
规范正文。由聚焦守卫、链接检查和现有 `workspace-boundaries` 测试证明。

### I-AC03: 技能来源和维护方式可重复

`.agents/README.md` 清楚列出外部安装、依赖包 canonical 和仓库自有三类技能及
其更新方式；`skills-lock.json` 只包含前两类受工具管理的技能，仓库自有技能
不伪装成安装内容，Silvermoon 副本与当前依赖携带的 canonical 目录完全一致。
由聚焦守卫证明。

### I-AC04: 目录回退会被自动阻止

根级 `check:agent-guidance` 可独立运行，`check:repo` 也执行同一守卫；新增错误
位置、无效 frontmatter、断裂本地链接、发现清单漂移、lock 所有权漂移或包边界
路由丢失时检查会失败。由聚焦测试的通过结果和根级脚本配置证明。

### I-AC05: 候选通过生命周期校验且不改变运行时

最终候选只涉及 Agent 指导、维护文档、守卫测试、根级检查接线和本 Idea 的
主体世界/ledger，不修改运行时代码或部署配置；相关测试、`pnpm check:repo`
及 Silvermoon worktree/staged 校验全部通过，可以通过非 force 流程发布。

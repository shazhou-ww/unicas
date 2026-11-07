# Deployment

本 Deployment 验证已验收的 Implementation revision
`f1e4991876155c55e2515b575a5617de2a89f5fb` 在 GitHub 的实际结果。它只授权
读取 repository settings/workflow state、触发两个无外部写入的 manual
workflow proof，并把证据写回本 Outer World。它不授权推送 `release`、修改
branch/environment/ruleset、触发 production、创建 tag、发布 npm 或复用
端侧 artifact。

## Steps

### D-S01: 发布并固定 Deployment contract

先对本 Deployment 和 ledger 运行 Silvermoon worktree/staged checks，单独提交
并通过普通非 force Git 同步到 refreshed primary。只有 `whats-next` 返回稳定
`deploymentRevision` 后，才执行以下外部检查；所有 workflow proof 使用该
primary commit 作为 `main` ref 的 exact head SHA。

### D-S02: 读取 live workflow 与保护设置

通过 GitHub API 读取 default-branch 上 CI/Security workflow、启用状态、
repository branch protection/rulesets，以及 `Production`/`npm` environments
的非敏感保护元数据。证明 CI live trigger 只有 `release` push/manual，
Security live trigger 保留 PR、`release`、weekly schedule/manual；确认是否有
required checks 引用已删除的 main/PR validation context。只记录设置，不执行
settings 写入，也不读取 secret value。

### D-S03: 证明普通 main push 为零 hosted gate

对 implementation publish、evidence publish、acceptance publish 和 Deployment
contract publish 的 exact SHAs 查询 CI 与 Security runs。必须证明这些
`main` push 没有 `event=push` 的 CI/CodeQL run。若同一 SHA 后续存在本合同
触发的 `workflow_dispatch`，按 event 分开记录，不能把 manual proof 错算为
main push。

### D-S04: 运行 exact-primary manual release preflight

在同步后的 Deployment contract commit 上通过 `workflow_dispatch` 启动 **CI**
workflow，ref 为 `main`。等待单次外部结果并记录 immutable run URL、run ID、
attempt、head SHA、event、conclusion 与 job 结果。`validate` 必须成功运行
`pnpm validate:release`；`deploy-production` 和 `tag-production` 必须 skipped，
不得产生 deployment 或 tag。

### D-S05: 运行 exact-primary manual CodeQL proof

在同一 primary commit 上通过 `workflow_dispatch` 启动 **Security** workflow。
记录 immutable run 与 job 结果；CodeQL 必须成功，Dependency Review 因非 PR
而 skipped。live workflow 必须继续保留 weekly schedule、manual 和
`release` trigger，不能把端侧 hook 视为 security proof。

### D-S06: 核对无外部写入并发布证据

对比 proof 前后的 production deployment、production tag、npm workflow run
和 settings 摘要，证明两个 manual runs 没有 production/npm 写入或 settings
变更。把 API 口径、外部结果、runner duration、失败恢复和 immutable links
写入 `DeploymentEvidence.md`，完成 ledger 后验证、提交、同步 primary，并运行
`pnpm check:ideas:remote`。

### D-S07: 失败时停止而不是削弱 gate

任一 manual proof 失败、SHA 不匹配、job 可达性异常或 settings 出现 stale
required context 时，阻止 Deployment acceptance 并保存 run/log link。workflow
实现缺陷必须返回 Inner World 形成新 implementation revision 并重新验收；
settings 问题必须先形成明确前后/恢复方案。不得通过取消 release validation、
放宽 environment 或把 `--no-verify` 当作通过来恢复。

## Acceptance criteria

### D-AC01: live trigger matrix 与已验收实现一致

GitHub default-branch workflow 读取必须证明 CI 只有 `release` push/manual，
Security 只有 PR、`release`、weekly schedule/manual；两个 workflow 均为
active。repository tests 的静态 YAML 结果不能替代此 live 读取。

### D-AC02: ordinary main push 不创建 CI 或 CodeQL run

四个已发布 primary SHAs 的 Actions 查询必须没有 `event=push` 的 CI/Security
run。Deployment contract SHA 上允许且只允许本合同明确触发的
`workflow_dispatch` proof。

### D-AC03: manual CI 对 exact primary 完成 release superset

CI run 必须为 `workflow_dispatch`、head SHA 等于固定 Deployment contract
commit、conclusion 为 success；`validate` 成功，`deploy-production` 与
`tag-production` skipped。run logs/steps 必须显示 `pnpm validate:release`，
且没有 deploy、tag 或 npm job 执行。

### D-AC04: manual Security proof 保留独立 CodeQL

Security run 必须为 `workflow_dispatch`、相同 exact head SHA、conclusion 为
success；CodeQL 成功且 Dependency Review skipped。live schedule 与
`release` trigger 仍可读。

### D-AC05: required checks 与 environments 没有 stale 或弱化

branch protection/ruleset 读取不得包含已删除的普通 validation/CodeQL required
context。若读取时仍没有 branch protection，只记录该事实；不得把不存在的保护
描述为成功写入。`Production`/`npm` environment 与 immutable production tag
ruleset 必须仍存在，且本 Deployment 不修改它们。

### D-AC06: 外部证据可追溯且没有未经授权写入

`DeploymentEvidence.md` 必须包含 contract revision、primary SHA、immutable
run links、API 查询结论、job/duration、前后外部写入摘要和 recovery 判断。
Silvermoon worktree/staged/remote checks 必须通过，候选同步到 refreshed primary；
不得出现 release branch push、production deployment、新 production tag、npm
publication 或 settings mutation。

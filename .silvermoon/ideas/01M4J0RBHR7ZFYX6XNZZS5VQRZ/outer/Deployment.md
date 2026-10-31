# Deployment

本 Deployment 验证已验收的 Implementation revision
`26b3d4e72ca42e02adee354f0111f3e9151f28d9` 已作为 repository-only cleanup
发布到 authoritative `origin/main`。本 idea 没有需要部署的产品 artifact；
现实世界结果是 remote repository tree、default-branch commands、workflow
consumers 与 Silvermoon snapshot 和已验收实现一致。

本合同只授权普通非 force Git 同步，以及通过 Git/GitHub API 读取公开或当前
身份已获授权的非敏感 repository metadata。它不授权 workflow dispatch、
`release` branch push、production deployment、remote D1 migration、npm
publication、Git tag、secret mutation、repository settings mutation或
`unicas.shazhou.work` frozen legacy 操作。

## Steps

### D-S01: 发布并固定 Deployment contract

对本 Deployment 和 ledger 运行 Silvermoon worktree/staged checks，单独提交并
通过普通非 force Git 同步到 refreshed primary。重新运行 `whats-next`，固定
该次返回的 deployment revision 和 exact contract primary SHA；后续外部观测
只以该 primary snapshot 为准。

### D-S02: 读取 authoritative remote repository

通过 `git ls-remote` 与 GitHub repository API 读取 default branch、exact head
SHA 和 commit metadata。使用 remote Git tree 而不是仅依赖当前 worktree，
验证 `release/`、`scripts/{git,local}`、package-owned deployment assets 与
`examples/app-user-sdk/` 已发布，且顶层 `sdk/`、`stacks/` 和
`packages/spaces/scripts/` 不存在。

### D-S03: 验证 remote commands 与 workflow consumers

读取 exact primary 上的 root manifest 和 live default-branch workflow content。
验证 approved `local:*` 与 `release:<unit>:<action>` commands 可见，旧 commands
零匹配；CI、docs、npm 与 Spaces recovery workflows 均引用新 paths/commands。
只做读取，不触发 manual workflow。

### D-S04: 核对 publication 没有生产副作用

按 implementation、evidence、acceptance 与 contract primary SHAs 查询 GitHub
Actions runs 和 deployments，区分 GitHub dependency dynamic checks 与
repository-owned workflows。固定 proof 前后的 `release` ref 和 tag snapshot，
证明本 idea 的 ordinary main publications 没有触发 CI/Security、docs deploy、
npm publish、Spaces recovery、production deployment 或 tag creation。

### D-S05: 发布 Deployment evidence

将 exact revisions、remote tree/command inventory、live workflow references、
Actions/deployment 查询、无外部写入对比和 recovery 判断写入同世界
`DeploymentEvidence.md`。据此完成 deployment ledger，运行 Silvermoon
worktree/staged checks，提交、普通同步 primary，并运行
`pnpm check:ideas:remote`。

### D-S06: 失败时停止而不是扩大授权

若 remote head 漂移、accepted layout/commands 缺失、workflow 仍引用旧 path，
或观察到本 idea SHA 关联的 production side effect，停止 Deployment acceptance
并保留 immutable link/query evidence。实现缺陷必须返回 Inner World 形成新的
implementation revision 并重新验收；不得通过 dispatch、补部署、修改 settings
或 force push 规避失败。

## Acceptance criteria

### D-AC01: Accepted implementation 可从 authoritative primary 到达

GitHub default branch 必须为 `main`，contract primary 必须是
`origin/main` exact head，且已验收 implementation、implementation evidence 与
acceptance commits 均可从该 head 到达。local HEAD、remote primary 和
Silvermoon remote snapshot 必须一致。

### D-AC02: Remote tree 与 approved ownership layout 一致

Remote Git tree 必须包含 accepted `release/`、`scripts/`、package deployment
assets 与 external-consumer example；不得包含顶层 `sdk/`、`stacks/`、
`packages/spaces/scripts/`、compatibility copies 或 unexpected ownership roots。

### D-AC03: Remote commands 与 workflows 使用新 ownership

Exact primary 的 root manifest 必须只暴露 approved local/release command
namespace；live default-branch workflows 必须使用新 commands 和 paths，且不再
引用被删除的 wrappers、roots 或 aliases。

### D-AC04: Repository publication 没有产品部署副作用

Idea publication SHAs 不得关联 repository-owned CI/Security push run、docs
deployment、npm publication、Spaces recovery、production deployment 或新 tag。
Dependency dynamic checks可单独记录，但不得误记为 repository deployment。
本 Deployment 本身不得触发 workflow 或修改外部设置。

### D-AC05: 外部证据可追溯且可恢复

`DeploymentEvidence.md` 必须记录 implementation revision、contract primary、
remote queries、immutable run links、ref/tag 对比和 failure recovery 判断。
Deployment ledger、Silvermoon worktree/staged/remote checks 必须通过，evidence
必须通过普通非 force Git 同步到 refreshed primary。

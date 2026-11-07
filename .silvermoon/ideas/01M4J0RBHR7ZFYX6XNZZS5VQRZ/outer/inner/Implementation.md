# Implementation

## Steps

### I-S01: 将部署资产归还 owning packages

创建 private `@unicas/site` workspace package，并将 product apex static source、
Wrangler config、tests 和独立 Wrangler devDependency 归入该 package。将
App-scoped Space migration 原样迁入
`packages/service-cloudflare/migrations/app-space/`；将 Spaces Wrangler config
与 migrations 迁入 `packages/spaces/`，并让 `@unicas/spaces` 独立声明 Wrangler。
同步 package inventory、workspace/TypeScript references、boundary tests、root
commands 和直接配置消费者。此步骤形成第一个 coherent commit。

### I-S02: 建立 release ownership 与新 command namespace

按 Ideal World 建立 `release/{app-user-sdk,service,spaces,site,docs,shared}`。使用
Git rename 迁移 SDK release contract/evidence、service/Spaces deploy 与 smoke
scripts、Spaces operational scripts 和 shared release helpers。为 site/docs
提供只接受显式 plan 或 production mode 的 deploy wrappers，移除 package-local
direct deploy scripts。

Root commands 原子切换为 `release:<unit>:<action>`，包括明确区分
`release:spaces:bootstrap-deploy` 与 `release:spaces:bootstrap-data`。同步 workflow、
tests、CODEOWNERS、gitattributes、docs 和所有 repository-owned callers；不保留
旧 command aliases 或 file-path wrappers。此步骤形成第二个 coherent commit。

### I-S03: 收敛 local/Git tooling 并删除旧 roots

建立 `scripts/git/` 与 `scripts/local/`。迁移 hooks、pre-push gate、local runtime、
mock OIDC、argument forwarding、key generation、Dockerfile 和 compose input；
root local commands 切换为 `local:<action>`。

更新 root/package README、canonical Agent guidance 和 repository guards。将
`stacks/unicas/README.md` 的仍有效信息合并到当前 owner docs 后删除，并确认
移动完成后的 `sdk/`、`stacks/` 与 `packages/spaces/scripts/` 不再存在。此步骤
形成第三个 coherent commit。

### I-S04: 验证完整 candidate 并发布实施证据

每个 coherent commit 先运行覆盖其边界的最窄检查；三个 commits 完成后运行
repository-wide build、test、typecheck、release artifact、browser 和 deployment
dry-run validation。记录 exact commands、结果、path/command zero-match、byte
preservation 和 primary synchronization evidence 到同世界
`ImplementationEvidence.md`，并据此更新 ledger。

只允许运行 dry-run/plan；不得执行 production deployment、D1 migration、npm
publish、tagging、secret mutation 或 frozen legacy environment 操作。

## Acceptance criteria

### I-AC01: Repository target layout 完整落地

`release/`、`scripts/{git,local}`、package-owned deployment assets 和
`examples/app-user-sdk/` 与 approved `TargetLayout.md` 一致；maintained snapshot
中不存在顶层 `sdk/`、`stacks/`、旧 script paths、unexpected duplicate assets
或 compatibility copies。通过 tracked-file inventory、focused path search 和
workspace tests 证明。

### I-AC02: Deployable packages 独立拥有配置与工具

`@unicas/service-cloudflare`、`@unicas/spaces`、`@unicas/site` 与
`@unicas/docs-site` 各自拥有 package-root Wrangler config 和 Wrangler
devDependency；service/Spaces migrations 位于 owning package，site package
具有有效 metadata、workspace integration 和 package tests。通过 manifest/config
inspection、package boundary tests、package tests 和各 package dry-run 证明。

### I-AC03: Release 与 local commands 原子切换

Root `package.json` 只暴露 approved `local:<action>` 与
`release:<unit>:<action>` entries；旧 `dev`、`deploy:*`、`spaces:*`、`sdk:*`
及相关 release aliases 已删除。Workflow、docs 与 tests 全部使用新命令；
production entries 保持显式 `:production`，plan commands 不产生外部副作用。
通过 command inventory、workflow tests 和 deployment plan/dry-run 证明。

### I-AC04: 产品、schema 与 release evidence 保持不变

App/Space、administrator、service、Spaces、site、docs 和 SDK behavior、公开
exports/contracts、Cloudflare resource identity 与 deployment order 不变。
Migration SQL、SDK declaration baselines、release manifests、examples 和 static
assets 在纯路径迁移中保持 byte-for-byte 一致；必要配置路径变化不改变语义。
通过 Git object/hash comparison、schema tests、SDK/npm release tests、site tests
和 focused diff evidence 证明。

### I-AC05: Package 与 Agent boundaries 保持有效

新增 `@unicas/site` 不引入错误依赖，现有 client/server dependency direction、
single-service boundary、`.agents/` canonical ownership 与 Silvermoon layout
保持有效。通过 `pnpm check:workspace`、`pnpm check:agent-guidance`、package
boundary tests 和 Silvermoon checks 证明。

### I-AC06: Repository-wide validation 通过且无外部副作用

`pnpm validate` 与 `pnpm validate:release` 在最终 candidate 上通过；后者只执行
build、tests、artifact checks、browser coverage 和 deployment dry-runs。证据明确
记录未运行任何 production deployment、D1 migration、npm publish、tagging、
secret mutation 或 `unicas.shazhou.work` 操作。

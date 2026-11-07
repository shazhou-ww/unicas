# 将持续集成收敛到 release 门禁与 main pre-push 保护

## 意图

在 Silvermoon 使 `main` 成为高频同步分支后，停止为每次普通 branch 或
`main` 更新重复购买完整远端 CI。把不可绕过的远端验证集中在 release
candidate 边界，同时用仓库管理的 pre-push hook 在开发端验证即将进入
`main` 的精确 revision，尽早阻止明显无效的更新。

## 背景

当前 `.github/workflows/ci.yml` 对所有 branch push、pull request 和手动
dispatch 启动。普通更新运行 `pnpm validate`；`main` push 还运行
`pnpm check:ideas:remote`。`.github/workflows/security.yml` 也在每次
`main` push 启动 CodeQL。一次 Silvermoon lifecycle 候选通常需要多次独立
primary 同步，因此同一功能会触发多轮耗时相近、结论高度重复的远端验证。

仓库已经有更强的 release 信任边界：`release` revision 必须可从 `main`
到达，受保护 job 会重新安装、重新构建并运行 `pnpm validate:release`，之后
production deployment 才可能进入 protected environment；npm 发布也在
immutable tag 的 protected job 内重新构建和验证。因此，普通 `main` push
CI 不是 release 完整性的唯一或最终证明。

另一方面，仓库目前没有 `.githooks`、Husky、Lefthook 或
`core.hooksPath` 安装机制。直接删除 `main` CI 会失去快速反馈。端侧
pre-push 可以在网络写入前运行同一个 canonical validation command，但 Git
hook 可被 `--no-verify` 绕过、可能未安装，也运行在开发者机器上；它只能减少
错误进入 `main`，不能成为安全或发布信任边界。当前触发与保护盘点见同一理想
世界的 `TriggerInventory.md`。

## 期望结果

- 普通 branch push、pull request 和 `main` push 不再触发完整远端
  `pnpm validate`；高频 Silvermoon 同步不会按提交重复消耗 hosted runner。
  远端完整 repository validation 只由 release candidate 或显式 preflight
  触发，PR 仍可保留 Dependency Review 等只在该事件上有意义的专项检查。
- `release` candidate 仍在干净 hosted runner 上对精确、可从 refreshed
  `main` 到达的 revision 运行 `pnpm validate:release`。任何 production 或
  npm 外部写入继续依赖远端重建、受保护 environment、最小权限和现有
  provenance，不消费端侧 artifact。
- 仓库拥有一个可审查、跨 Git for Windows 与 Unix Git 使用的 pre-push
  入口。它只在待更新 remote ref 包含 `refs/heads/main` 时执行，非 main
  push 立即通过。
- main pre-push 验证待推的精确 local SHA，而不是碰巧验证另一个 checkout
  状态；删除 ref、多个 ref、detached HEAD、dirty worktree、非 HEAD revision
  和 validation failure 都有明确且 fail-closed 的行为。
- hook 调用仓库 canonical script，而不在 shell 文件中复制 test list。安装
  与卸载是幂等、显式、可诊断的；不会静默覆盖已有 `core.hooksPath` 或个人
  hook。
- hook 失败给出实际命令、失败原因和恢复路径。明确说明 `--no-verify` 是可见
  的紧急绕过而非成功证明；release gate 永远重新验证。
- Security workflow 不再因每次普通 `main` push 重复运行 CodeQL。CodeQL
  至少保留定期、手动和 release candidate 证明；Dependency Review 只在存在
  pull request dependency diff 时运行。secret scanning 与其他 GitHub
  repository security capabilities 的责任不被 pre-push 替代。
- 文档和回归测试准确描述 trigger matrix、端侧/远端责任、绕过边界与 release
  前置条件。没有指向高频 `main` CI 的 badge 或陈旧承诺。
- 可量化比较变更前后的 hosted runner 次数与分钟数，并证明普通 `main` push
  为零次完整 validation、release candidate 恰好运行所需 gate。

## 范围

### 范围内

- `.github/workflows/ci.yml` 的 push、pull request、manual 与 release trigger
  设计，以及 `validate`/`deploy-production` job 的依赖关系。
- `.github/workflows/security.yml` 中 CodeQL 与 Dependency Review 的合理
  trigger，重点移除普通 `main` push 重复执行。
- repository-owned pre-push hook、canonical Node.js/PowerShell-neutral
  dispatcher、安装/卸载/状态检查与开发者 onboarding。
- exact pushed revision、cleanliness、多 ref stdin、remote ref 与 bypass
  行为的自动化测试。
- `package.json` validation scripts、workflow regression tests、
  `CONTRIBUTING.md`、根 README 和 validation/release 文档的直接更新。
- GitHub branch/environment/settings 中与新的 required checks、release gate
  和 security schedule 直接相关的受审外部配置及读取验证。
- runner 使用基线、变更后样本与失败恢复证据。

### 范围外

- 降低 `pnpm validate` 或 `pnpm validate:release` 本身的质量门槛。
- 用端侧 hook artifact、cache 或日志作为 production/npm 发布输入。
- 因减少 `main` CI 而取消 protected `Production`/`npm` environments、
  exact revision/ancestry 检查、OIDC、provenance 或 deployment smoke。
- 强迫所有 topic branch push 运行本地完整 validation；hook 只针对目标
  remote ref 为 `main` 的更新。
- 把 Git hook 描述为不可绕过的安全控制，或试图阻止用户使用
  `--no-verify`。
- 在本 idea 中发布 SDK、修改 SDK README badge、deprecate npm 包或执行
  service deployment。
- 迁移到其他 CI provider、引入远端 build cache 或重写全部测试编排，除非
  exact revision hook 无法在现有 Node/pnpm 基础上正确实现。

## 约束

- release candidate 的远端 `pnpm validate:release` 必须保留为外部写入前的
  authoritative gate；端侧通过不允许跳过、缩短或复用该 gate。
- hook 必须支持仓库声明的 Node.js 24+、pnpm 11、Windows Git 与常见 Unix
  Git；不依赖 Bash-only 的业务逻辑。
- hook dispatcher 必须解析 Git `pre-push` stdin 的全部行，以 remote ref 而
  非当前 branch 名决定是否验证；同一 push 只运行一次 canonical gate。
- 对目标 `main` 的更新必须验证精确 local object ID。若无法证明 command
  对应同一 revision，应拒绝 push，而不是用当前 worktree 的成功结果兜底。
- 安装器不得更改 global Git config，不得覆盖非本仓库拥有的 hooksPath；冲突
  必须显式报告并保留用户配置。
- hook 不得读取、记录或发送凭据、token、私钥、客户数据或 production
  environment；验证必须是无外部写入的。
- workflow 继续使用 immutable Action/image 引用与最小权限。schedule/manual
  trigger 不能获得 deployment credentials。
- `main` 高频同步仍需 Silvermoon worktree/staged/remote checks；CI trigger
  改变不能放宽 idea lifecycle 的 validation 与 primary synchronization。
- branch protection API 的当前状态尚无法由当前只读身份确认。Implementation
  必须先审计有效 settings；任何 settings 写入属于 Deployment，并记录前后
  证据与恢复步骤。

# 验证与发布接口评审

Updated: 2026-09-23
Status: Approved

Approved: 2026-09-23（用户明确批准 Interface）

## 评审目标

本评审固定开发者和运维人员可见的命令、触发器与恢复入口。批准后才会修改 root
scripts、GitHub Actions trigger 或运维流程。内部 job 名称可以在不改变本矩阵保证的
前提下调整。

## 支持路径

| 路径 | 触发与规范入口 | 检查与产物 | 权限、环境与写入 | 上游保证 |
| --- | --- | --- | --- | --- |
| 本地聚焦 | 现有 package test selector、`pnpm test:quick`、`pnpm test:packages` 和各 package 的 `test`/`build`/`typecheck` | 只运行受影响范围；不产生可发布产物 | 无 GitHub environment、生产 secret 或外部写入 | 开发者按变更范围选择最窄命令 |
| 本地标准 | 新增一个规范 root 命令 `pnpm validate` | 与普通 CI 完全相同的精简 policy、build、typecheck 和测试集合；每种保证只调用一次 | 无 GitHub environment、生产 secret 或外部写入 | 开发者交付前和普通 CI 共用同一命令，避免本地标准门禁通过而 CI 因测试集合不同失败 |
| 本地发布前 | 新增 `pnpm validate:release`，严格包含 `pnpm validate` | 增加慢速/集成/浏览器测试、文档与 SDK 发布产物检查、全部部署 dry-run 和 release planner | 无生产或 npm secret；Wrangler 仅 dry-run | promotion 前可本地复现的全面门禁 |
| 普通 branch push | `ci.yml` 的 `push`，排除 `release` | 运行规范 `pnpm validate`；不打包发布产物 | `contents: read`，无 environment、secret 或写入 | source branch 与本地标准门禁相同 |
| pull request | `ci.yml` 的 `pull_request` | 运行同一个规范 `pnpm validate`；不复用 branch push 的可执行产物 | `contents: read`，无 environment、secret 或写入 | 合并条件与本地、branch 和 `main` 使用同一测试集合 |
| `main` push | `ci.yml` 的 `push` on `main` | 运行同一个规范 `pnpm validate`，另加协调状态检查 `repoledger check --remote`；不发布、不部署 | `contents: read`，无 environment、secret 或写入 | 测试集合不分叉；额外检查只验证主分支共享 ledger 状态 |
| `release` promotion | 只接受 `main` 历史中的精确 revision，经现有受保护分支流程进入 `release` | 运行 `pnpm validate:release` 全面门禁；受保护 job 从同一 SHA 重建并依次部署 API/Console、Spaces、产品站和文档站，运行服务、Spaces、public-origin、清理验证，最后创建不可变 production tag | `Production` environment；仅 deploy 和 tag job 可写；串行 concurrency | 精确 SHA、主分支祖先关系、全面门禁成功、environment approval |
| npm tag | 仅 `npm/app-user-sdk/v<version>` push | 在一个 `npm` environment job 中从 tag SHA 确定性重建六包，验证版本/依赖/manifest/tarball，完成 registry preflight，再按依赖顺序发布并验证 provenance/consumer | `contents: read`、`id-token: write`、`npm` environment；无长期 token | 规范 tag、tag SHA 属于 `main`、六包版本精确匹配、所有写入前 preflight |
| Spaces 恢复 | 独立 `workflow_dispatch`，显式选择 `provision-deploy` 或 `principals` 并输入精确 revision | 只运行所选 bootstrap/recovery；输出非敏感摘要 | `Production` environment；与正常 promotion 共用串行 concurrency | 操作者显式选择、精确 revision 验证、environment approval |
| npm 新包 onboarding | 文档化的显式维护流程，不属于 tag workflow | 仅创建缺失 package record、trusted publisher 和 bootstrap metadata；正常 tag workflow随后验证 | npm 管理员人工操作；不得使用长期发布 token | 新公共 package 已经单独评审；现有六包不会进入此路径 |

## 命令兼容性

- 保留现有聚焦命令及 package scripts；`pnpm validate` 是本地、branch、PR 和
  `main` 共用的标准门禁，`pnpm validate:release` 是其严格超集。
- `pnpm deploy` 继续拒绝隐式生产部署；计划入口继续使用 `pnpm deploy:plan`
  或直接 Wrangler `--dry-run`。
- 正常生产 promotion 不再接受 `spaces_action`。bootstrap 参数只存在于独立恢复
  workflow，普通 PR、branch、`main`、`release` 和 npm tag 无法设置或误触发。
- npm tag 格式、六包集合、依赖顺序、OIDC trusted publishing、provenance 和
  已存在精确版本的安全幂等语义保持不变。
- 一次性的 App/Space v1 issuer cutover 已完成，不再保留在正常生产 job；Git
  历史和稳定 cutover 文档保留审计记录，但不能重新执行。

## 触发判定

| 场景 | 标准 `validate` | 全面 `validate:release` | Production 写入 | npm 写入 | 恢复写入 |
| --- | --- | --- | --- | --- | --- |
| 普通 branch push | Run | Skip | Deny | Deny | Deny |
| pull request | Run | Skip | Deny | Deny | Deny |
| `main` push | Run | Skip | Deny | Deny | Deny |
| `release` push | Included | Run | Run after approval | Deny | Deny |
| 手动全面验证 | Included | Run | Deny | Deny | Deny |
| 规范 npm tag | Skip | npm 专用验证 | Deny | Run after approval | Deny |
| 非规范 tag | Skip | Skip | Deny | Deny | Deny |
| 手动 Spaces 恢复 | Skip | 恢复专用 preflight | Deny normal promotion | Deny | Run after approval |

## 请求决定

批准本接口表示接受：

1. 本地、branch、PR 和 `main` 统一运行精简后的 `pnpm validate`，不维护不同测试集合；
2. `release` 和手动发布前验证运行严格超集 `pnpm validate:release`，同时保留现有聚焦命令；
3. Spaces bootstrap 移到独立受保护恢复 workflow，v1 issuer cutover 从正常路径删除；
4. npm 发布合并为一个受 `npm` environment 保护的 job，在任何 registry 写入前完成
   一次完整重建和 preflight，并保留每包写入前的即时状态检查；
5. 生产与 npm 受保护 job 不消费不可信 PR 或 branch push 生成的可执行产物。

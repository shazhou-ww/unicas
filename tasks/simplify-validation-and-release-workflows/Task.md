# 精简验证与发布工作流

Created: 2026-09-23
Language: zh-CN

## Goal

将 UniCAS 当前跨本地命令、GitHub CI、`release` 生产发布和 npm tag
发布的验证图整理为一组职责清晰、无失效一次性步骤和无无谓重复工作的稳定路径，
同时完整保留安全检查、精确 revision、不可变产物、provenance、生产 smoke
以及失败关闭保证。

## Context

仓库已经先后建立测试分层、`release` 分支生产边界、生产部署标签、
App/Space v1 一次性切换、Spaces App bootstrap、文档站打包和 App-user SDK
npm 发布。每个任务都在原有工作流上增加了必要保护，但当前正常修改可能重复执行
全仓测试、构建、文档构建、SDK 打包和部署计划；生产工作流还保留了若干为一次性
迁移、bootstrap 或兼容验证增加的条件分支和配置。

这些步骤中既可能存在已经完成使命的历史债，也可能存在为了信任边界、跨平台
确定性、精确提交验证或故障恢复而必须保留的重复。不能仅凭耗时删除检查，需要先
建立可复现的执行图和时间基线，再按触发来源、信任级别、产物所有权及恢复用途
决定保留、合并、移动、缓存或退役。

本任务是 `promote-app-user-api-to-beta` 的前置工作。beta 总任务应消费本任务
交付的稳定验证与发布基线，而不是继续叠加临时步骤。

## Scope

- 盘点根脚本、包脚本、GitHub Actions job、部署编排、npm 发布脚本和 smoke
  工具形成的完整执行图，记录每一步的触发条件、输入、输出、secret/环境边界、
  失败语义、责任来源、重复调用和代表性耗时。
- 将支持路径明确划分为本地聚焦验证、pull request、普通 `main` push、
  `release` 生产 promotion、`npm/app-user-sdk/v*` 不可变 tag 发布和显式恢复；
  为每条路径定义唯一职责及必须满足的上游保证。
- 识别 App/Space v1 cutover、首次 Spaces bootstrap、首次 npm package
  bootstrap、旧兼容探针和其他迁移期步骤；删除已经失效的步骤，或将仍有恢复价值
  的步骤隔离到明确、不可被正常发布误触发的恢复入口。
- 消除同一路径内没有新增保证的重复安装、生成、构建、typecheck、测试、打包、
  dry-run 和 smoke；在不跨越信任边界的前提下复用经过校验的产物或结果，并为
  必须重复执行的步骤记录原因。
- 调整 root/package scripts、工作流 job 依赖、条件、缓存或产物传递、部署与
  发布编排，使快速反馈、穷尽验证、生产保护和 npm 发布各自使用最窄但完整的
  检查集合。
- 保持生产部署只接受受保护 `release` revision，npm 发布只接受规范不可变 tag
  和 OIDC trusted publishing，并在执行外部写入前重新验证精确提交、版本、
  产物和 registry 状态。
- 保持服务与 Spaces smoke、公开 origin 检查、清理验证、生产标签、
  npm provenance、外部 registry consumer 和敏感数据边界；优化只能改变编排，
  不能用较弱的代理检查替代这些结果。
- 增加或更新工作流与脚本回归测试，覆盖每种触发路径、跳过条件、权限、写入入口、
  一次性步骤退役以及失败关闭行为。
- 更新稳定的开发和运维文档，说明支持的验证矩阵、正常 promotion、npm 发布、
  手动恢复、产物信任边界以及以后新增检查时的归属规则。
- 用统一方法记录优化前后的 job/步骤数量、重复执行次数、关键路径耗时和实际
  GitHub Actions 结果，明确每项保留或未优化成本的理由。

## Out of scope

- 为缩短耗时而删除测试、降低断言、跳过生产 smoke、放宽 secret/environment
  边界、允许非精确 revision 发布或取消失败关闭。
- 改变 App/Space HTTP、capability、SDK public API、业务规则、持久化模型或
  Cloudflare 运行时行为。
- 发布新的 npm 版本、移动 live dist-tag、执行新的 beta promotion，或把本任务
  自身当作产品发布授权。
- 更换 GitHub Actions、pnpm、Vitest、Wrangler 或 npm trusted publishing
  平台；只有执行期证据证明现有平台无法满足目标时，才可另行提出评审。
- 引入付费远程缓存、跨仓库构建服务或长期发布 token。
- 激活仍在评审中的 OTLP destination 或非零 production tracing sampling。
- 修改冻结的 `unicas.shazhou.work` 环境。

## Acceptance criteria

- [ ] 一个版本化执行矩阵覆盖本地聚焦验证、pull request、`main`、`release`、
      npm tag 和恢复路径，并逐项记录检查、产物、权限、环境、写入能力和上游保证。
- [ ] 每个保留的构建、测试、typecheck、打包、dry-run、smoke 和外部验证步骤
      都有唯一职责；无新增保证的重复执行已删除或复用，必须重复的信任边界检查有
      明确书面理由。
- [ ] 已完成使命的一次性 cutover/bootstrap/迁移步骤已从正常路径删除；仍需保留
      的恢复操作只能从显式受保护入口触发，且普通 PR、`main`、`release` 和 npm
      tag 不会误触发。
- [ ] pull request 和普通 `main` push 在无生产或 npm secret 的条件下提供
      明显快于当前基线的反馈，同时仍覆盖与变更相关的仓库检查、构建、类型和测试
      失败；完整穷尽门禁仍有一个规范入口。
- [ ] `release` promotion 仍从主分支历史中的精确受保护 revision 构建和部署，
      串行使用 `Production` environment，并通过服务、Spaces、文档、产品站、
      public-origin、清理和不可变 production tag 验证。
- [ ] npm tag 工作流仍只接受 `npm/app-user-sdk/v<version>`，从 tag 精确提交
      重建确定性六包集合，执行 registry preflight，以 OIDC provenance 按依赖
      顺序发布，并对已存在的精确版本保持安全幂等。
- [ ] 工作流和脚本测试证明 PR、普通 branch、`main`、`release`、manual
      recovery、规范/非规范 npm tag、失败验证及重复发布的执行或拒绝路径，且外部
      写入只有经评审的生产和 npm job 能够到达。
- [ ] 优化前后证据采用同一测量方法，至少比较 job/步骤数量、重复执行次数和关键
      路径耗时；结果证明正常开发与发布路径减少了实质性冗余，而不是把成本隐藏到
      未验证路径。
- [ ] 开发与运维文档明确每条支持路径、命令、promotion 和恢复步骤、产物信任
      边界，以及新增验证应归属哪个层级。
- [ ] 聚焦工作流测试、仓库检查、构建、typecheck、规范穷尽测试、全部部署
      dry-run 和发布 planner/registry verifier 在交付 revision 上通过；受保护
      GitHub CI 结果与本地证据一致。
- [ ] `promote-app-user-api-to-beta` 可以引用本任务交付的稳定矩阵和发布路径，
      不需要恢复已退役的一次性步骤或增加重复门禁。

## Constraints

- 先测量和标注保证，再修改编排；不能根据步骤名称、历史时间或单次耗时推断其
  可以删除。
- 保持 Windows 本地开发与 Linux GitHub runner 的支持，避免依赖 shell 特有的
  隐式行为。
- 不在不可信 PR 与受保护 job 之间复用可被篡改的可执行产物；任何跨 job 复用都
  必须记录来源、完整性、精确提交和信任边界。
- 保持管理员平面与 App-user 数据平面、私有应用与公开 SDK 的包和部署边界，
  不引入 `@unidocs/*` 运行时依赖。
- 保持 npm 版本和 release tag 不可变；恢复流程不得覆盖、静默删除或伪造已经
  发布的产物。
- 对外部写入采用计划、预检、精确 revision 验证和失败关闭；优化不得把验证移到
  写入之后。
- 正常 publication 使用非强制 Git 集成，不重写 `main` 或 `release` 历史。

## Human review checkpoints

任务创建只记录计划，不代表批准。每个必需的评审产物都必须发布并获得明确决定，
才能越过对应实施门槛。

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | 用户或负责发布的仓库维护者 | 本任务的路径边界、排除项、保留保证、验收标准以及与 beta promotion 的依赖关系。 | 实质性排查和实现。 |
| Interface | Required | 开发体验与发布运维负责人 | 任务内的命令与触发矩阵，覆盖本地命令、PR、`main`、`release`、npm tag、恢复入口和兼容性。 | 修改开发者命令、workflow trigger 或运维流程。 |
| Business and data model | Not applicable: 本任务只改变验证与发布编排，不改变业务概念、实体、关系、持久化 schema、数据生命周期或迁移。 | Not applicable | Not applicable | Not applicable |
| Architecture | Required | 仓库与发布架构负责人 | 基线驱动的工作流设计，说明 job/脚本职责、依赖图、产物复用、信任边界、权限、并发、失败和恢复。 | 重组 CI job、产物传递、生产部署或 npm 发布编排。 |
| Delivery acceptance | Required | 用户或负责发布的仓库维护者 | 集成 revision、前后对比、完整触发矩阵测试、本地验证和 GitHub Actions 结果。 | 对精确批准的主分支提交运行 `task complete`。 |

## References

- [Root scripts](/package.json)
- [GitHub CI and production workflow](/.github/workflows/ci.yml)
- [npm publication workflow](/.github/workflows/publish-npm.yml)
- [Deployment and local configuration](/packages/docs-site/content/deployment-and-local-configuration.md)
- [npm package release operations](/docs/npm-package-releases.md)
- [Existing test-suite tier task](/tasks/tier-test-suites-and-optimize-slow-tests/Task.md)
- [Existing release-branch task](/tasks/deploy-production-from-release-branch/Task.md)
- [Existing Cloudflare deployment task](/tasks/automate-cloudflare-deployments/Task.md)
- [App-user beta promotion capstone](/tasks/promote-app-user-api-to-beta/Task.md)

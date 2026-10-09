# Implementation evidence

## 范围

本证据对应已批准的 `idealRevision`
`4c206b400a3025f0f244302861cec068c18613f1`，覆盖 `Implementation.md` 中
I-S01 至 I-S06、I-S08、I-S09 和对应 acceptance criteria。I-S07 与 I-AC07
只有在包含 docs-only deployment remediation 的新候选通过 Silvermoon checks、
同步到刷新后的 primary 并重新观察后才再次完成。

候选仍是未发布的统一 `app-user-sdk@0.1.2`。本阶段没有创建 tag、GitHub
Release、npm 版本或 dist-tag，也没有执行旧包 deprecation。

## 仓库内结果

- 根 README、六包 packed README 与文档站提供统一的包选择、quickstart、
  compatibility、versioning、TypeScript API、troubleshooting、changelog、
  support 和 security 入口。
- `examples/app-user-sdk/` 提供离线 Node/browser quickstart、调用者自带凭据的
  opt-in live read，以及 capability、retain、catalog/commit 宿主责任 reference。
- `scripts/sdk-readiness.mjs` 与 `tests/sdk-readiness.test.mjs` 校验 community
  files、package metadata、稳定安装指令、TypeScript snippet 标记、仓库相对
  链接、compatibility、API baseline、changelog 和不可变 workflow 引用。
- `sdk/api/` 保存六包生成声明的可审查 baseline；`sdk/package-matrix.json` 和
  `sdk/release-manifest.json` 保存同一 ESM、Node.js、TypeScript、esbuild、
  Playwright 与 Chromium/Firefox/WebKit 兼容契约。
- `prepare-sdk-release.mjs` 从候选 tarball 安装到 workspace 外，使用 shipped
  declarations typecheck 六包 README、SDK 文档片段和公开 examples，运行 Node
  quickstart，并在三个浏览器引擎运行 browser quickstart。
- 六个 packed README 分别包含对应 npm version 和 npm MIT license badge；
  readiness test 校验 package 名称、链接并拒绝 CI 与 monthly downloads
  badge。12 个实际 npm badge image endpoints 均返回 HTTP 200。本候选没有
  修改 workflow；CI trigger 与 pre-push 端侧保护由独立 idea
  `release-gated-ci`（`01M4FKE63W98QZPQ650SNTNHJN`）跟踪。
- `.github/workflows/deploy-docs.yml` 提供与普通 CI trigger 独立的手动
  docs-only publication。它要求 full lowercase revision，在执行 repository
  code 前证明 checkout 等于 refreshed `origin/main`，使用 `Production`
  environment 和共享 `unicas-production` serialization，只向 docs deploy step
  暴露 Cloudflare credential。它运行 docs unit/type/browser tests、dry-run、
  exact-source deployment，并验证公开 routes 与
  `artifact-manifest.json.sourceRevision`；workflow 没有 service、Spaces、
  product-site、npm、tag 或 GitHub Release write path。
- CONTRIBUTING、Contributor Covenant、SUPPORT、SECURITY、CODEOWNERS、
  Issue forms 和 PR template 已补齐；Dependabot、Dependency Review、CodeQL、
  Action commit SHA 与 gitleaks image digest 已配置。

## 可执行验证

证据日期：2026-10-09。

| 命令 | 结果 |
| --- | --- |
| `pnpm check:sdk-readiness` | 11/11 tests passed |
| 12 个 npm badge endpoint HEAD probes | 全部返回 HTTP 200 |
| `pnpm exec vitest run tests/deploy-plan.test.mjs tests/sdk-readiness.test.mjs` | 2 files、55/55 tests passed；覆盖 docs-only trust boundary 与全部 workflow immutable Action 引用 |
| `deploy-docs.yml` YAML parse | 通过；存在唯一 `deploy-docs` job |
| `pnpm --filter @unicas/docs-site test` | 7/7 tests passed；31 个文档页面可确定性构建 |
| `pnpm --filter @unicas/docs-site typecheck` | 通过 |
| `pnpm --filter @unicas/docs-site test:browser` | Chrome 3/3 tests passed |
| `pnpm deploy:docs:plan` | 通过；73 个静态文件、无 bindings、Wrangler dry-run 未写入 |
| `pnpm sdk:prepare` | 通过；六包两轮 tarball 一致，API baseline 与 release manifest 已刷新 |
| packed external consumer | Node workflow 与公开 Node quickstart 通过；Chromium、Firefox、WebKit browser quickstart 全部通过 |
| `pnpm check:release` | 5 个 test files、40/40 tests passed |
| `pnpm --workspace-concurrency=1 validate:release` | 最终 exit 0；repository 6 files/166 tests、build、typecheck、40 项 release policy、Cloudflare 29 files/268 tests、SDK artifacts、docs 3 browser tests 与四项 deployment dry-run 全部通过 |

首次在 Windows 直接运行 `pnpm validate:release` 时，根 workspace build 与
`service-cloudflare` 内部 build 同时启动 `admin-webui`，两个 Vite 进程争用
`packages/admin-webui/dist/ui/index.html` 并产生 `EPERM`。这发生在未修改的构建
编排中，与 SDK 测试无关；使用同一 `validate:release` 脚本并把本地
workspace concurrency 限为 1 后完整通过。没有为本 idea 修改无关的 build
orchestration。

本次 I-S09 完整验证的前两次单并发运行分别在既有 5 秒 Vitest timeout 上
瞬时超时：一次 App/Space surface scan 为 5.025 秒，另一次临时 Git tag
integration test 为 5.492 秒；两项都在独立复跑中通过且没有 assertion failure。
缓存变热后的同一标准命令完整 exit 0，因此没有为了本变更放宽无关测试 timeout。

提交 I-S09 后，`origin/main` 已并发前进 11 个提交，包含 App/Space capability
contract、Space client、公开 README、API baseline 与 release manifest 变化。
候选通过普通非强制 merge 集成双方历史，生成 merge commit
`5d884a511d22c742df08a76407b1c031109c4304`，没有冲突。针对该 merge commit
重新运行 docs workflow 2 files/55 tests、docs 7 unit/3 browser tests、
typecheck、docs dry-run 和完整
`pnpm --workspace-concurrency=1 validate:release`，全部 exit 0；合并后六包
deterministic artifacts 与更新后的 API/release evidence 一致。只有在该复验
之后才继续同步候选。

## 外部只读核验

2026-10-09 的匿名 npm/GitHub 读取结果：

- 六个当前 SDK 包的 npm `latest` 全部仍为 `0.1.1`；
- `npm/app-user-sdk/v0.1.2` Git tag 与同名 GitHub Release 均不存在；
- `@unicas/tenant-client@0.1.0`、
  `@unicas/tenant-blob-client@0.1.0`、
  `@unicas/tenant-protocol@0.1.0` 仍未 deprecated。

前一轮 Deployment 已按 contract 更新 GitHub description/topics，并在
`outer/DeploymentEvidence.md` 记录 before/after；community health 保持 100%。
它同时发现当前公开 SDK docs routes 为 404，因此没有执行旧包 deprecation、
GitHub Release、tag 或 `0.1.2` 发布。

本次 I-S09 只新增受保护 publication path，没有 dispatch workflow 或产生新的
外部写入。旧包 deprecation、docs deployment、GitHub Release 与最终 `0.1.2`
发布仍需新的 Implementation acceptance、Deployment contract 前置条件及对应
授权；npm publication 继续要求精确 `/publish app-user-sdk 0.1.2`。

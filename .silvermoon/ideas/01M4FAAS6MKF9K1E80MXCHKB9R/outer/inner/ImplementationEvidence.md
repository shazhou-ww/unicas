# Implementation evidence

## 范围

本证据对应已批准的 `idealRevision`
`4c206b400a3025f0f244302861cec068c18613f1`，覆盖 `Implementation.md` 中
I-S01 至 I-S06、I-S08 和对应 acceptance criteria。I-S07 与 I-AC07 只有在
包含 badge 的新候选通过 Silvermoon checks、同步到刷新后的 primary 并重新
观察后才再次完成。

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
- 六个 packed README 分别包含对应 npm version、共享 primary CI 和 npm MIT
  license badge；readiness test 校验 package 名称、链接并拒绝 monthly
  downloads badge。13 个实际 badge image endpoints 均返回 HTTP 200。
- CONTRIBUTING、Contributor Covenant、SUPPORT、SECURITY、CODEOWNERS、
  Issue forms 和 PR template 已补齐；Dependabot、Dependency Review、CodeQL、
  Action commit SHA 与 gitleaks image digest 已配置。

## 可执行验证

证据日期：2026-10-09。

| 命令 | 结果 |
| --- | --- |
| `pnpm check:sdk-readiness` | 11/11 tests passed |
| 13 个 npm/CI badge endpoint HEAD probes | 全部返回 HTTP 200 |
| `pnpm --filter @unicas/docs-site test` | 7/7 tests passed；31 个文档页面可确定性构建 |
| `pnpm sdk:prepare` | 通过；六包两轮 tarball 一致，API baseline 与 release manifest 已刷新 |
| packed external consumer | Node workflow 与公开 Node quickstart 通过；Chromium、Firefox、WebKit browser quickstart 全部通过 |
| `pnpm check:release` | 5 个 test files、40/40 tests passed |
| `pnpm --workspace-concurrency=1 validate:release` | exit 0；standard validation、build、typecheck、40 项 release policy、Cloudflare 29 files/268 tests、SDK artifacts、docs 3 browser tests 与四项 deployment dry-run 全部通过 |

首次在 Windows 直接运行 `pnpm validate:release` 时，根 workspace build 与
`service-cloudflare` 内部 build 同时启动 `admin-webui`，两个 Vite 进程争用
`packages/admin-webui/dist/ui/index.html` 并产生 `EPERM`。这发生在未修改的构建
编排中，与 SDK 测试无关；使用同一 `validate:release` 脚本并把本地
workspace concurrency 限为 1 后完整通过。没有为本 idea 修改无关的 build
orchestration。

## 外部只读核验

2026-10-09 的匿名 npm/GitHub 读取结果：

- 六个当前 SDK 包的 npm `latest` 全部仍为 `0.1.1`；
- `npm/app-user-sdk/v0.1.2` Git tag 与同名 GitHub Release 均不存在；
- `@unicas/tenant-client@0.1.0`、
  `@unicas/tenant-blob-client@0.1.0`、
  `@unicas/tenant-protocol@0.1.0` 仍未 deprecated。

这些结果证明 Implementation 没有越过 Deployment 边界。旧包 deprecation、
GitHub description/topics/community profile 读取、GitHub Release 和最终
`0.1.2` 发布仍需被接受后的 Deployment contract 与相应授权。

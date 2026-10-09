# Implementation

## Steps

### I-S01: 固化公开 SDK 产品与支持契约

以已批准的 `idealRevision`
`4c206b400a3025f0f244302861cec068c18613f1` 为边界，把六包呈现为一个统一的
App-user SDK。补齐根入口、六包 README、文档站导航、compatibility、
versioning、troubleshooting、API reference 和 changelog；英文是公开权威
版本。支持契约固定为 ESM-only、Node.js 24+、TypeScript 5.9+，浏览器支持以
Chromium、Firefox、WebKit 的持续 consumer smoke 为证据；不承诺 CJS、旧
Node、Deno、Bun 或 React Native。

### I-S02: 提供可执行 quickstart 与宿主责任示例

提供从已打包 artifact 安装的 Node 和 browser quickstart，并覆盖 capability
provider、Blob `store` 后 `retain`、File catalog 与 commit 边界、browser
cache 会话清理等不可省略的宿主责任。示例只使用合成数据和调用者提供的可选
live credentials，不托管公共凭据，也不依赖 workspace source 偶然通过。

### I-S03: 建立文档、API 与版本变更门禁

把标记为可编译的 README/文档 TypeScript 片段、相对链接、稳定安装指令和
package-root exports 纳入自动检查。为六包建立可审查的 TypeScript public API
baseline；patch 必须保持向后兼容，breaking API 只能随统一 minor 版本和迁移
说明进入候选。检查应区分预期 baseline 更新与意外破坏，并将 changelog、
release manifest 和候选版本结论关联起来。

### I-S04: 补齐社区、安全与维护入口

新增贡献指南、Contributor Covenant 行为准则、支持政策、Issue forms、PR
template 和 CODEOWNERS，明确普通支持使用 Issues、安全问题使用 private
advisory、维护为 best-effort 且无 SLA；暂不开 Discussions，不要求 CLA 或
DCO。更新 `SECURITY.md` 的支持版本、响应预期和安全发布说明，并让仓库检查
验证这些入口持续存在。

### I-S05: 强化依赖与 workflow 供应链

增加 Dependabot、Dependency Review 和 CodeQL。第三方 GitHub Actions 固定到
完整 commit SHA，容器固定到 digest，同时保留最小权限、protected environment、
OIDC trusted publishing 和 provenance。Scorecard 与额外 SBOM 属于后续增强，
不阻断本 implementation。

### I-S06: 汇总开源就绪检查与候选证据

新增统一的 open-source readiness 检查并接入仓库与 release validation，覆盖
community files、package metadata、文档与示例、compatibility、API baseline、
packed artifact 和 release notes。运行最窄相关测试后运行完整
`pnpm validate:release`，把命令、结果和未执行的外部动作记录到同一 Inner
World 的证据文件。

### I-S07: 同步精确 implementation 候选

通过 Silvermoon worktree/staged checks，提交并以非强制方式同步到 primary，
确认候选从刷新后的 primary 可到达，再以精确 `implementationRevision` 请求
人工验收。验收前不得执行 npm deprecation、GitHub metadata/Release、tag 或
`0.1.2` publish。

### I-S08: 增加可信 package 状态徽章

在六个 packed README 标题下增加各包独立的 npm `latest` version、共享 primary
CI 和 MIT license 徽章。徽章链接必须使用公开 npm/GitHub 地址并由 readiness
检查覆盖；不把下载量、兼容性或 provenance 简化为未经门禁证明的徽章。

## Acceptance criteria

### I-AC01: SDK 入口与六包文档一致

根 README、文档站和六个 packed README 均能引导用户选择正确包，使用稳定安装
指令，并链接 compatibility、versioning、API、changelog、support 和 security；
自动检查证明不存在 SDK 范围内的 beta 安装指令、退役 Tenant 身份或冲突支持
声明。

### I-AC02: Packed quickstart 与浏览器矩阵可执行

干净临时目录只安装候选 tarball 后，Node quickstart 能 typecheck 并运行；
browser quickstart 能 bundle，并在 Chromium、Firefox、WebKit 中运行。测试
同时证明 capability、retain、catalog/commit 和缓存清理 reference 未绕过宿主
责任。

### I-AC03: 文档代码与链接受自动保护

仓库检查会提取全部明确标记为可编译的 TypeScript 片段，以候选 declarations
进行 typecheck，并拒绝断开的仓库相对链接、非稳定 npm 安装命令、未知 export
和未受控占位凭据。

### I-AC04: 兼容、SemVer 与 API baseline 可审查

公开 compatibility matrix 的每个支持单元都有对应 CI/consumer 证据；版本政策
明确 patch 兼容与 minor breaking migration 规则。六包 public API baseline、
统一 changelog、package version 和 release manifest 对 `0.1.2` 给出一致结论，
发布检查会阻断未审查的 surface 变化。

### I-AC05: 社区与安全入口完整

community files、Issue/PR 流程、CODEOWNERS、support 与 security policy 全部
存在并通过自动检查。新贡献者能够从公开仓库找到开发、测试、许可、支持和私密
报告路径；安全政策支持当前 `0.1.x` 而不是声称尚无 tagged release。

### I-AC06: 安全自动化与不可变引用生效

Dependabot、Dependency Review、CodeQL 配置有效；仓库 workflow 不再使用可变
第三方 Action tag 或可变容器 tag。CI 检查证明固定引用、最小权限和 npm OIDC
发布边界未退化。

### I-AC07: 完整候选验证通过且外部状态未改变

新增 readiness gate、相关 package/docs tests、`pnpm validate:release` 与
Silvermoon checks 全部通过，证据记录精确 primary commit 和 artifact 结论。
npm registry、GitHub metadata、GitHub Release、tag 与 dist-tag 在 Deployment
前均未被修改。

### I-AC08: 六包徽章准确且不改变发布边界

六个候选 tarball 的 README 分别链接对应 npm package/version/license，CI
徽章链接同一 primary workflow；自动测试拒绝包名错配和未经决定的 monthly
downloads 徽章。徽章只展示公开状态，不构成兼容、支持或发布授权。

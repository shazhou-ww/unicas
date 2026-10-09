# App-user SDK 开源完备度盘点

## 盘点范围

本盘点覆盖统一发布的六个公开包：

- `@unicas/codec`
- `@unicas/space-protocol`
- `@unicas/space-client`
- `@unicas/space-blob-client`
- `@unicas/space-browser-cache`
- `@unicas/space-file-client`

证据快照日期为 2026-10-09。仓库证据来自 package manifests、README、
文档站、测试 fixture、release scripts、GitHub workflows 和公开 GitHub/npm
metadata。外部基准采用：

- GitHub 的
  [public repository community profile](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)；
- Node.js 的
  [Publishing a TypeScript package](https://nodejs.org/en/learn/typescript/publishing-a-ts-package)；
- npm 的
  [trusted publishers](https://docs.npmjs.com/trusted-publishers/)、
  [provenance](https://docs.npmjs.com/generating-provenance-statements/) 和
  [`npm deprecate`](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/)；
- GitHub 的
  [build-system security guidance](https://docs.github.com/en/code-security/tutorials/implement-supply-chain-best-practices/securing-builds)。

## 已具备的基础

| 维度 | 已有证据 | 判断 |
| --- | --- | --- |
| 法律与身份 | 根目录 MIT `LICENSE`；六包声明 MIT、repository、bugs、homepage、engines 和公开 access | 已具备可信发布的基础身份 |
| 协议与边界 | App/Space v1 TypeScript contract、OpenAPI、固定 exports、package boundary tests | 已有清楚的技术边界 |
| 包质量 | 单元测试、严格 TypeScript、显式 `files` allowlist、无 source/map 泄漏、两轮确定性 pack | 强于一般初始 npm 包 |
| 消费者验证 | tarball 安装到 workspace 外；shipped declarations typecheck；Node workflow smoke；真实 Chrome IndexedDB smoke | 已证明 artifact 可被消费 |
| 发布供应链 | immutable tag、protected `npm` environment、OIDC trusted publishing、最小 `id-token: write`、provenance、registry signature/attestation verification | 核心发布链已经成熟 |
| 安全报告 | 根 `SECURITY.md` 指向 GitHub private advisory，禁止公开披露凭据与 exploit details | 已有私密入口 |
| 使用文档 | App-user HTTP/authorization/scenario 文档；四个 client/cache README 已补充基础流程 | 已有重要内容，但还未形成完整 SDK 产品 |

## 缺口与优先级

优先级定义：

- **发布门禁**：`0.1.2` 发布前必须完成并有自动化或外部证据。
- **首轮完备**：本 idea 应完成，但可在发布候选功能稳定后收尾。
- **后续增强**：不阻断开源就绪，只有在维护成本可持续时采用。

| 维度 | 当前证据 | 主要缺口 | 优先级 |
| --- | --- | --- | --- |
| SDK 产品身份 | 六包统一版本；四个 client README 已扩展 | 根 README 没有 SDK landing/选择路径；GitHub description 仍写 Tenant；topics 为空；package homepage 全部指向同一泛化页面 | 发布门禁 |
| 包级文档 | client/blob/file/cache 有基本场景 | codec/protocol README 仍安装 `@beta` 并写 beta maturity；没有统一 API reference、版本/兼容/故障入口 | 发布门禁 |
| 可执行入门 | release fixture 覆盖 API，但面向发布校验而非用户 | 没有 `examples/` 或用户可直接运行的 quickstart；capability provider、file catalog 和 durable retain/release 缺少受测 reference | 发布门禁 |
| 文档正确性 | 文档站有构建测试，artifact 有 declaration typecheck | README code blocks 未提取/typecheck；占位变量和链接不受验证；公开示例可能在 API 变化后静默过期 | 发布门禁 |
| 兼容承诺 | manifests 声明 Node 24+；README 声明 modern browsers；consumer 跑 Node 24 和 Chrome | “modern browsers”不可验证；没有 TypeScript、浏览器、Web API、bundler 支持矩阵；未说明支持期限 | 发布门禁 |
| API 与 SemVer | exports allowlist、OpenAPI drift 和统一版本检查 | 没有 TypeScript public API baseline/diff；没有统一 versioning policy；breaking change 无自动化门禁和 migration 要求 | 发布门禁 |
| Release 叙事 | npm tag、manifest、provenance 和 registry verification 完整 | 没有 changelog；GitHub Releases 为零；用户无法从一个页面理解版本变化、兼容影响和升级动作 | 发布门禁 |
| 旧包退役 | 仓库和服务已拒绝 Stack/Tenant surface | `@unicas/tenant-client`、`tenant-blob-client`、`tenant-protocol` 均未 deprecate，安装者没有迁移提示 | 发布门禁 |
| Security policy | private advisory 已配置 | `SECURITY.md` 仍称“first tagged release”之前，而 `0.1.1` 已发布；没有当前支持版本、响应预期或安全 release 说明 | 发布门禁 |
| Community health | README、LICENSE、SECURITY 存在；Issues 开启 | GitHub profile 57%；缺少 CONTRIBUTING、CODE_OF_CONDUCT、SUPPORT、Issue forms、PR template；贡献许可和 triage 边界未说明 | 首轮完备 |
| 维护所有权 | npm 有多个 owner；发布环境受保护 | 仓库无 CODEOWNERS/GOVERNANCE；SDK API、workflow、security policy 和 release evidence 的 reviewer 责任不可见 | 首轮完备 |
| CI 广度 | `pnpm validate:release` 很强；gitleaks 扫描历史 | 可见配置中无 Dependabot、Dependency Review、CodeQL 或 Scorecard；只有 Ubuntu/Node 24/Chrome；无 coverage threshold | 首轮完备 |
| Workflow 完整性 | 权限最小化、fresh runner、protected environment | GitHub Actions 使用 `@v4` 等可变 major tag，gitleaks image 使用可变 tag；没有 SHA/digest 固定策略或自动更新机制 | 首轮完备 |
| Package metadata | description、license、repository、bugs、homepage、exports、files、engines 齐全 | 缺少 discoverability keywords；homepage 无包级落点；GitHub topics 为空；缺少维护/支持链接 | 首轮完备 |
| 可选透明度 | npm provenance 已可验证 | 未生成额外 SBOM/Scorecard badge；是否启用 Discussions/FUNDING 未决，但不影响 SDK 正确性 | 后续增强 |

## `0.1.2` 建议发布门禁

在创建 `npm/app-user-sdk/v0.1.2` tag 之前，至少证明：

1. 六个 README、文档站、GitHub metadata 和 package metadata 不再含已退役
   Tenant 身份、beta 安装指令或互相冲突的支持状态。
2. SDK landing page 能让新用户选择正确包；Node 和 browser quickstart 从已
   pack artifact 安装、typecheck 并运行。
3. 所有标记为可编译的 README/文档 TypeScript 片段进入自动校验；文档链接和
   npm install 命令进入 drift check。
4. compatibility、supported versions、versioning、deprecation 和 migration
   policy 已公开，并与 CI matrix 一致。
5. TypeScript public API baseline 已建立，发布检查能区分预期与意外变化。
6. changelog 含 `0.1.0-beta.1`、`0.1.1` 和 `0.1.2`；GitHub Release 生成规则
   与 immutable npm tag、manifest、provenance 一致。
7. `SECURITY.md` 支持矩阵已更新；community health 必需文件与模板存在并通过
   仓库检查。
8. 三个 `tenant-*` 包的精确 deprecation message、替代包和执行/验证步骤已经
   在 Deployment 契约中审查；任何 registry 写入均由 owner 在受控步骤执行。
9. dependency/security/workflow hardening 的必做项已实现；暂缓项有明确风险、
   owner 和复审条件。
10. `pnpm validate:release`、新增 open-source readiness check、匿名 registry
    preflight 和 exact candidate review 全部通过。

满足这些条件只代表“具备发布资格”，不构成发布授权。实际 npm tag 与发布仍需
Implementation acceptance、最新 primary revision、不可变 release plan，以及
显式 `/publish app-user-sdk 0.1.2`。

## 可衡量的完成状态

- GitHub community profile 达到 100%，仓库 description/topics 使用当前
  App/Space 与 SDK 词汇。
- 六包 npm 页面存在一致的稳定安装、支持、API、changelog 和安全入口。
- 用户 quickstart 与 README snippets 在 CI 中从 packed artifact 验证，而不
  从 workspace source 偶然通过。
- compatibility matrix 中每个“支持”单元都有持续运行的 consumer 证据。
- API baseline 和 changelog 对同一候选给出一致 SemVer 结论。
- GitHub Release、npm metadata、provenance、release manifest 和 commit/tag
  能双向追溯。
- 旧 `tenant-*` 包安装时显示明确迁移提示，当前 `space-*` 包没有错误
  deprecation。
- 新贡献者只阅读公开仓库即可找到开发、测试、PR、支持和安全报告路径。

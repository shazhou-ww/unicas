# 让 App-user SDK 成为完备且可信的开源项目

## 意图

让 UniCAS App-user SDK 的六个公开 npm 包形成一个可发现、可理解、可验证、
可安全升级、可持续贡献的开源产品。外部开发者应当能够独立完成选型、安装、
首次成功调用、故障处理和升级判断；贡献者与维护者应当有明确的协作、安全和
发布契约。

## 背景

`@unicas/codec`、`@unicas/space-protocol`、`@unicas/space-client`、
`@unicas/space-blob-client`、`@unicas/space-browser-cache` 和
`@unicas/space-file-client` 已作为一个统一版本的 App-user SDK 发布。
仓库已经具备 MIT 许可、App/Space v1 协议、单元测试、确定性打包、外部
consumer typecheck、Node 与 Chrome smoke、npm trusted publishing、provenance
以及私密漏洞报告入口。

当前能力证明这些包“可以被构建和发布”，但还不能完整证明它们是一个成熟的
开源项目。GitHub community profile 只有 57%；仓库缺少贡献指南、行为准则、
Issue/PR 模板和支持政策。公开仓库描述仍使用已退役的 Tenant 术语，没有
topics 或 GitHub Releases。SDK 没有统一 changelog、明确的版本与兼容策略、
可执行 quickstart、完整 TypeScript API reference 或公开 API 变更门禁。
`@unicas/codec` 与 `@unicas/space-protocol` 的 README 仍引导安装 beta；
三个已经退役的 `tenant-*` npm 包也没有 deprecation 提示。

`0.1.2` 已在源码中形成未发布候选，用于承载改进后的 client README。该版本
不得因为版本号和 tarball 证据已经准备好就直接发布；应先完成并证明本 idea
定义的开源就绪门禁。详细现状、证据和优先级见同一理想世界内的
`ReadinessInventory.md`。

## 期望结果

- 六个包以一个统一的 App-user SDK 产品呈现。仓库首页、文档站、npm README、
  GitHub metadata、package metadata 和发布说明使用一致的 App/Space 名称、
  稳定安装方式、包选择路径和支持状态。
- 每个包明确说明适用场景、非目标、安装、最小初始化、核心读写流程、权限或
  运行时要求、错误与资源生命周期，并链接到统一的 SDK 导航和 API reference。
  至少有一条 Node quickstart 和一条 browser quickstart 能从干净目录安装
  已打包 artifact 后直接 typecheck 和运行；file catalog、capability 获取及
  retain/release 等不可省略的宿主责任有可执行或受测 reference。
- README 与文档中的 TypeScript 示例不再只是未校验的展示文本。发布门禁能够
  发现失效 import、错误签名、错误字段、过期版本标签、断链和与 artifact
  declarations 不一致的示例。
- 支持策略明确列出 Node、TypeScript、浏览器/Web API、模块格式和支持版本。
  “modern browsers”等模糊承诺被可执行的兼容矩阵替代；每项公开兼容声明要么
  有 CI/consumer 证据，要么明确标为未支持。
- 公共导出与 SemVer 形成可审查契约。发布候选具备可比较的 API surface
  baseline；意外删除或破坏类型签名会阻断发布，预期破坏性变更必须附迁移说明
  和正确版本决策。
- 仓库具备完整的开源协作入口：贡献指南、行为准则、支持边界、Issue forms、
  PR template、维护/评审所有权和贡献许可说明。普通支持、缺陷、功能建议和
  私密漏洞报告各自有唯一且清楚的渠道；GitHub community profile 达到完整
  状态。
- 安全政策反映已经存在稳定版本的事实，明确支持版本和响应预期。依赖更新、
  dependency review、代码扫描、secret scanning 和 workflow 依赖固定策略
  均有可见配置或有证据的明确取舍；第三方 Action 和构建镜像不依赖未经审查的
  可变引用。
- 统一 changelog、GitHub Release、npm 版本、不可变 tag、release manifest
  和 provenance 能相互追溯。发布说明区分 breaking、feature、fix、security、
  deprecation 和 migration；退役的 `tenant-*` 包向安装者显示对应
  `space-*` 替代路径。
- 一个自动化的“开源就绪”检查覆盖 community files、package metadata、
  README 稳定安装指令、文档示例、API baseline、packed artifact、兼容矩阵和
  发布说明。`0.1.2` 只有在该检查、现有 `pnpm validate:release`、Implementation
  acceptance 和单独的 `/publish app-user-sdk 0.1.2` 授权全部满足后，才具备
  发布资格。

## 范围

### 范围内

- 六个 App-user SDK 包的 README、package metadata、公开 exports、类型声明和
  packed artifact 契约。
- 文档站中的 SDK 导航、包选择、quickstart、TypeScript API reference、
  compatibility、versioning、migration 和 troubleshooting 内容。
- 可在 CI 中执行的示例、文档片段校验、API surface 比较、package quality
  检查、兼容性 smoke 和必要的测试证据。
- 仓库级 community health files、Issue/PR 流程、支持与维护边界、GitHub
  description/topics/releases，以及与公开 SDK 直接相关的 CODEOWNERS。
- App-user SDK 的 changelog、统一版本门禁、npm/GitHub release 对齐、
  trusted publishing/provenance 保持，以及退役 npm 包 deprecation。
- 与 SDK 发布链直接相关的依赖更新、依赖审查、代码扫描、secret scanning 和
  GitHub Actions 固定/最小权限措施。

### 范围外

- 新增 App/Space API、CAS 存储语义、文件模型或其他用户功能。
- 重构 UniCAS service、Cloudflare adapter、administrator access plane、
  私有 WebUI、CLI 或第一方 Spaces App，除非只为公开 SDK example 或兼容
  smoke 提供最小测试 fixture。
- 为追求表面兼容而承诺 CommonJS、旧 Node、Deno、Bun、React Native 或所有
  浏览器；新增支持必须有明确需求和持续验证成本。
- 将内部部署、客户数据、凭据、私钥或生产诊断材料公开为示例或测试数据。
- 在 Implementation 被接受并获得单独发布授权前创建 npm tag、移动 dist-tag、
  发布 `0.1.2`，或修改任何已发布不可变版本。
- 把 funding、Discussions、翻译数量、下载量或 marketing 指标作为开源就绪的
  必要条件；它们可以是后续增强，但不能替代可用性与维护契约。

## 约束

- 六包继续作为 `app-user-sdk` 统一版本发布单元，内部依赖保持精确同版；
  package semver、HTTP path `v1`、capability claim `ver: 1` 和产品成熟度仍是
  独立版本轴。
- 保持 package boundary 与依赖方向：
  `space-file-client -> space-blob-client -> space-client -> space-protocol`；
  `space-browser-cache -> space-client`；`codec` 不获得 HTTP 或平台职责。
- `space-client` 继续是薄 HTTP transport。示例与文档不能为了简化叙述而把
  canonical encoding、直接上传、blob/file workflow 或 App business catalog
  错归给 transport。
- 只公开 package-root exports 和已经接受的
  `@unicas/space-protocol/openapi.json` subpath。新增 export、runtime 或
  compatibility 承诺必须同时进入 API baseline、文档、测试和版本判断。
- 保留 ESM-only、Node.js 24+、确定性 tarball、外部 consumer、npm OIDC
  trusted publishing、provenance、不可变版本和 protected environment。
  安全增强不得退回长期 npm write token 或把 PR artifact 带入发布边界。
- 以最小且可持续的支持矩阵替代模糊承诺。不能只添加无法长期执行的浏览器、
  bundler 或 runtime 矩阵来追求清单完整。
- community、示例和文档使用合成标识与内容，不含真实 App、Space、Principal、
  token、签名材料、客户数据或生产 endpoint 凭据。
- idea-specific 调研、计划和证据保留在本 idea；只有被接受的稳定共识才进入
  `docs/`。不得创建 provider-specific Agent guidance projection。
- npm deprecation、GitHub metadata、GitHub Release 和最终发布属于可审计的
  外部动作；必须在 Deployment 契约中记录前置条件、执行证据和恢复边界。

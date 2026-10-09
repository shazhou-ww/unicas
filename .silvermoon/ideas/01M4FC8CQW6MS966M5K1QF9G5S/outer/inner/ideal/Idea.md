# 补齐 App-user v1 契约表示缺口

## 意图

让已发布 App/Space v1 API 的 TypeScript contract、生成 OpenAPI、公共 client、
运行时行为和权威文档对同一组公开语义给出一致且可自动验证的表达，关闭当前已知
表示缺口，而不借机增加产品功能或改变存储语义。

## 背景

旧 `promote-app-user-api-to-beta` capstone 创建时，App/Space v1、SDK 打包、
npm 发布、生产 promotion、独立文件 smoke 和退役 surface 仍是分散的前置工作。
这些结果此后已经分别完成：六个公开包的 `0.1.1` 已作为 `latest` 发布并具有
一致 provenance；受保护 production workflow 已多次通过完整 release validation、
canonical service smoke、Spaces file smoke 和 public origin 检查。

因此，把这些已完成结果重新包装成一次“beta promotion”已没有意义。当前真正
没有独立 owner 的剩余问题，是权威 App-user HTTP 文档明确列出的四类契约表示
缺口：

1. `readContent` 的二进制响应没有进入生成 OpenAPI 的 response content；
2. runtime 与 client 支持 byte range，但 TypeScript operation 与 OpenAPI
   没有表达 `Range`、`206`、`416` 和相关响应 header；
3. capability claims 与逐 operation permission 只有描述性文字，没有可自动
   校验的 machine-readable 表达；
4. runtime 的 upload、Root Ref 校验和具体 error code 比公开 contract 更严格，
   normative 与 implementation-specific 边界没有形成可防漂移的清单。

SDK 文档、支持策略、兼容矩阵、API baseline、社区入口和 `0.1.2` 发布门禁已经由
`sdk-open-source-readiness` idea 负责，不在这里重复。旧 capstone 的逐项审计与
替代关系记录在同一理想世界的 `LegacyCapstoneAudit.md`。

## 期望结果

- 二进制 content response、byte range request/response 及公开 header 在
  TypeScript contract、生成 OpenAPI、client 和文档中一致表达。
- capability claim 约束与每个 operation 的 exact permission 具有一个由源码
  生成或校验的 machine-readable 表达；它不得误称 OAuth scope，也不得创建新的
  授权语义。
- 公开且稳定的 runtime validation 与 error code 被提升到权威 contract；仅用于
  实现诊断的细节被明确分类，不再以无说明的漂移存在。
- 自动化 drift checks 能在 contract、OpenAPI、client、runtime 和文档任一侧
  单独变化时失败，并给出可审查的差异。
- 已发布 `0.1.1` 保持不可变；任何 public surface 变化都进入后续候选，按现有
  统一 SemVer、migration 和受保护发布流程判断与交付。

## 范围

### 范围内

- 审计 `readContent`、byte range、capability claims、operation permissions、
  validation 与 error code 的现状和 source of truth。
- 修改 App/Space v1 TypeScript contract、OpenAPI 生成、公共 client 类型与权威
  HTTP 文档，使既有 runtime 行为得到完整表示。
- 为 machine-readable permission/claim 表达选择最小且可生成、可测试的形式；
  OpenAPI 无法原生表达的约束可以使用稳定 vendor extension 或相邻生成 artifact，
  但只能保留一个权威源码。
- 增加 focused contract、OpenAPI drift、client、service 和文档测试，并明确
  public surface 变化的 SemVer 与 migration 结论。
- 在 Implementation 和 Deployment 世界记录精确候选、验证、生产兼容性和公开
  文档结果。

### 范围外

- 重新发布、覆盖、移动 dist-tag 或修改任何已发布 `0.1.1` artifact。
- 发布 `0.1.2`，或重复 `sdk-open-source-readiness` 已拥有的 README、
  quickstart、支持策略、社区文件、API baseline 与开源供应链工作。
- 新增 App/Space route、capability、permission、error semantics、存储行为、
  文件模型或 Admin API。
- 重新执行已经完成的 Stack/Tenant 退役、App/Space v1 cutover、npm 首发或
  production promotion。
- 仅因历史 schema、binding 或 storage key 名称而迁移或删除持久数据。

## 约束

- 生成 OpenAPI 必须继续由权威源码产生，不得手工修补生成文件来隐藏 drift。
- 保持现有 App/Space v1 wire、capability `ver: 1`、exact permission、
  Root Ref 原子更新、错误状态和 authorization denial 行为向后兼容。
- OpenAPI 或附属 machine-readable metadata 不得暗示浏览器、App backend 或
  administrator plane 获得额外 authority。
- Implementation 必须先证明变化属于兼容修正还是需要后续版本迁移，再决定候选
  版本；本 idea 本身不授权 npm publish 或 production deployment。
- 修改 `packages/**` 或 `stacks/unicas/**` 前必须遵守仓库 package boundary
  与 access-plane 约束。
- 验证与证据不得包含 capability、OAuth、npm、Cloudflare 或客户数据凭据。

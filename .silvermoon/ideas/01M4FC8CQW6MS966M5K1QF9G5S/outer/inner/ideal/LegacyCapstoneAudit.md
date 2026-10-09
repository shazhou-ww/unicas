# 旧 beta capstone 审计

## 结论

`promote-app-user-api-to-beta` 的原始目标已被真实发布历史超越。旧 ledger 的
17 项中，没有必要继续执行一次新的整体 beta promotion：

- npm、production、public smoke、退役 surface 与 release validation 已有独立
  成功证据；
- SDK 文档、支持、兼容、API baseline、社区和 `0.1.2` 门禁已由
  `sdk-open-source-readiness` 接管；
- “npm、API、文档必须来自同一 primary revision”的旧假设与已经接受的独立
  package SemVer、HTTP path version、capability version 和 product maturity
  轴不一致；
- 唯一没有独立 owner 的必要剩余项，是权威文档已经公开列出的 App-user v1
  契约表示缺口，本 idea 只接管该边界。

## 已验证的当前状态

审计于 2026-10-09 基于同步后的 `origin/main` 和公开外部状态完成。

- 六个 App-user SDK 包的 npm `latest` 均为 `0.1.1`。在 release tag
  `npm/app-user-sdk/v0.1.1`、commit
  `20641ce349ee913bb35caab622c14becbc71a95c` 上运行
  `node scripts/verify-npm-release.mjs --expect-latest`，验证通过 package
  version、dist-tag、SRI、exports、dependency ranges、SLSA provenance、
  registry tarball、无凭据外部安装、TypeScript declarations、Node/Chrome
  consumer、registry signatures 与 attestations。
- npm 发布由
  [workflow 37751689281](https://github.com/shazhou-ww/unicas/actions/runs/37751689281)
  完成，六包 provenance 指向同一 commit 和同一次 workflow run。
- production release
  `f6b91703e419509f3723acb340aeab7d60bcc0ba` 通过
  [workflow 37874444277](https://github.com/shazhou-ww/unicas/actions/runs/37874444277)
  的 release validation、protected deployment、canonical service smoke、
  Spaces file smoke、API/console/Spaces/product/docs origins 和 immutable tag
  `production-20261009-589`。
- Spaces file smoke 已覆盖 lease、direct upload、Root Ref commit、rename、
  readback、ready-node reuse、permission denial、Space isolation 和幂等 bounded
  cleanup；最终 production 证据记录未过期 active smoke run 为 0。
- `complete-app-space-concept-refactor`、`cut-over-app-space-api-to-v1`、
  `retire-stack-tenant-data-plane`、`prepare-app-user-sdk-beta-packages`、
  `publish-app-user-sdk-beta` 和 `build-file-upload-smoke-app` 均已完成。
  `split-root-ref-update-api` 被明确 abandoned；App/Space v1 保留已发布的单次
  原子 signed-delta Root Ref 更新，而不是等待 directional split。

## 旧 ledger 归类

| 旧 ID | 结论 | 后续 owner |
| --- | --- | --- |
| I-S01 / I-AC01 | 前置项已收口；仅契约表示缺口仍需处理 | `close-app-user-contract-gaps` |
| I-S02 / I-AC04 | SDK guidance、support、versioning 与 recovery 仍有改进，但已有独立 owner | `sdk-open-source-readiness` |
| I-S03 / I-AC03 | `0.1.1` reproducible artifacts 与 registry consumer 已验证 | 已完成 |
| I-S04 / I-AC05 | npm 与 production 各自具有 exact-revision 证据；强制同 revision 的旧模型废弃 | 已完成或不再适用 |
| I-AC02 | App/Space v1 cutover 与 Stack/Tenant/prototype v2 guards 已完成 | 已完成 |
| D-S01 / D-AC01 | 六包已发布并通过完整 registry verification | 已完成 |
| D-S02 / D-AC02 | 受保护 production release、docs 与 public origins 已验证 | 已完成 |
| D-S03 / D-AC03 | canonical API smoke 与独立 Spaces file smoke 已验证 | 已完成 |
| D-S04 / D-AC04 | legacy inventory、retirement guards 与历史名称边界已有 owner | 已完成 |

## 不应从旧 capstone 复制的工作

- 不重发 `0.1.1`，不把现有 `latest` 改回 beta，也不制造追溯性的统一 release。
- 不复制 `sdk-open-source-readiness` 的文档、community、support、API baseline、
  workflow hardening 或 `0.1.2` 发布门禁。
- 不重复已经由 protected release workflow 持续执行的 deployment、smoke、
  origin 和 immutable production tagging。
- 不恢复已废弃的 directional Root Ref 设计。

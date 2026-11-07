# Deployment evidence

## 范围与候选

证据日期：2026-10-09。

本证据执行于已同步的 deployment contract revision
`bd3f2b760f7fb648e703685cf89f3f17ebb3da4b`，其内层边界是已接受的
Implementation revision
`95772046a762bfd8ef3b83d0d99ff19b45f237fd`。

开始 preflight 时：

- clean worktree 的 `HEAD` 与 `origin/main` 均为 contract commit
  `ce430ee95999c71354d3e6b5083584073f4ca290`；
- 实现交付 commit
  `837255ffd626be41635f45345e20957d8371fe20`、Implementation evidence
  commit `5cb0a6c9824795467e147dab906d04e59e062805` 与 acceptance commit
  `1a5c12562ab6628d8b1df1fb867aed11277d8ea8` 均可从该 primary 到达；
- 当前会话没有收到 npm publish、Git tag、GitHub Release、Cloudflare
  production 或 docs production deployment 授权。

本 Deployment 因此只执行 read-only check 与明确标记为 `--dry-run` 的计划。

## D-S01：候选与 authority 边界

`pnpm exec silvermoon check --worktree --audience agent` 与同步前 staged check
均通过。Deployment contract 已通过普通非强制 push 同步到 primary，并由
`silvermoon whats-next close-app-user-contract-gaps --audience agent` 重新观察为
revision `bd3f2b760f7fb648e703685cf89f3f17ebb3da4b`。

该 contract 明确把 package publication、docs publish 和 production promotion
保留给各自 owner、门禁与显式授权。本 idea 不选择版本；其他 idea 以后创建的
package version、tag 或 deployment 不能归因于本证据。

## D-S02：只读 preflight

| 命令 | 结果 |
| --- | --- |
| `pnpm check:openapi` | 通过；1 file、2 drift tests |
| `pnpm check:sdk-release` | 通过；22 SDK tests、2 OpenAPI drift tests、deterministic public package build、packed declarations、Node consumer、Node quickstart 与 Chromium/Firefox/WebKit browser quickstart 全部通过 |
| `pnpm deploy:plan` | 退出码 0；planner 仅打印 service build、D1 migration、Wrangler deploy、public package build 与 smoke 的未来执行顺序，没有执行这些命令 |
| `pnpm deploy:docs:plan` | 退出码 0；构建 31 个文档页面，Wrangler dry-run 读取 73 个 asset 后输出 `--dry-run: exiting now` |
| `git status --short` | 无输出；preflight 未留下受版本控制或未跟踪产物 |
| `git diff --check` | 退出码 0 |

SDK check 使用临时目录安装 packed artifacts，并在完成后清理。没有修改受版本
控制 OpenAPI、API baseline 或 release manifest。

## D-S03：外部状态快照

### Git 与 GitHub

只读查询观察到两个既有 App-user SDK tags：

| Tag | Commit |
| --- | --- |
| `npm/app-user-sdk/v0.1.0-beta.1` | `45c1681e2cfb071ffcc2be694bae48ad2e267514` |
| `npm/app-user-sdk/v0.1.1` | `20641ce349ee913bb35caab622c14becbc71a95c` |

`gh release list --repo shazhou-ww/unicas --limit 20` 返回空数组。当前会话未创建或
移动 tag，也未创建 draft、prerelease 或正式 GitHub Release。

### npm registry

匿名 `npm view` 读取的六包 `latest` 都是 `0.1.1`，且 dist-tags 都是：

- `bootstrap: 0.0.0-bootstrap.0`
- `beta: 0.1.0-beta.1`
- `latest: 0.1.1`

| Package | 观察到的 versions |
| --- | --- |
| `@unicas/codec` | `0.0.0-bootstrap.0`、`0.1.0-beta.1`、`0.1.1` |
| `@unicas/space-protocol` | `0.0.0-bootstrap.0`、`0.1.0-beta.1`、`0.1.1` |
| `@unicas/space-client` | `0.0.0-bootstrap.0`、`0.1.0-beta.1`、`0.1.0`、`0.1.1` |
| `@unicas/space-blob-client` | `0.0.0-bootstrap.0`、`0.1.0-beta.1`、`0.1.1` |
| `@unicas/space-browser-cache` | `0.0.0-bootstrap.0`、`0.1.0-beta.1`、`0.1.1` |
| `@unicas/space-file-client` | `0.0.0-bootstrap.0`、`0.1.0-beta.1`、`0.1.1` |

这些值只是执行时快照，不为本 idea 选择后续 version。当前会话没有执行
`npm publish`、`npm deprecate`、dist-tag 修改或 registry 写入。

### Public source 与 live docs

匿名 HTTP 结果：

| URL | HTTP | 分类 |
| --- | ---: | --- |
| `https://raw.githubusercontent.com/shazhou-ww/unicas/ce430ee95999c71354d3e6b5083584073f4ca290/packages/docs-site/content/app-user-api/http-api.md` | 200 | 已接受且可按 immutable commit 审查的 source candidate |
| `https://raw.githubusercontent.com/shazhou-ww/unicas/ce430ee95999c71354d3e6b5083584073f4ca290/packages/space-protocol/openapi/app-space-v1.openapi.json` | 200 | 已生成且可按 immutable commit 审查的 OpenAPI candidate |
| `https://docs.unicas.work/app-user-api/http-api/` | 200 | live docs，尚未部署本候选 |

live 页面仍包含旧的 `Contract gaps` 段落，声称 OpenAPI `200` content 为空、
未声明 `Range`、`206`、`416` 和 response headers。immutable source candidate
已改为列出 binary/range contract、`416 INVALID_REQUEST`、稳定 error catalog、
capability claim schema 与 operation authority。因此本证据明确结论为：

- repository source 与 generated artifact 已验收并公开可审查；
- live docs 可用，但尚未包含该 source candidate；
- 本会话没有执行 docs deployment，不把 source availability 描述成 production
  docs publication。

既有 production runtime 已在本 idea 之前提供 full/range/unsatisfiable read、
capability permission、Root Ref validation 与稳定 wire error。本实现只统一其
契约表示和授权 policy source；没有 schema/storage migration，也没有因本会话
发生 production runtime 变化，因此不需要 runtime rollback。

## D-S04：无写入与验收边界

本次执行没有：

- npm publication、deprecation 或 dist-tag 写入；
- Git tag 或 GitHub Release 写入；
- D1 migration；
- service、Spaces、site、docs 或其他 Cloudflare production deployment；
- capability、OAuth、npm、Cloudflare credential 或客户数据持久化。

唯一外部变更是按 Silvermoon workflow 将本 contract 与证据通过普通非强制 Git
同步到 primary。若未来要发布 package、docs 或 production service，仍需独立
owner、contract、validation、protected workflow 和显式授权。

## 验收结论

- D-AC01：满足；accepted Implementation、contract revision 与 primary commits
  可追溯。
- D-AC02：满足；OpenAPI、SDK consumer、service plan 与 docs Wrangler dry-run
  全部通过且 worktree clean。
- D-AC03：满足；source candidate、live docs 旧状态和未部署边界被准确区分，
  production wire 不需要 migration。
- D-AC04：满足；没有扩大 publication 或 deployment authority，也没有执行外部
  release/deployment 写入。
- D-AC05：满足；本证据记录精确命令、公开快照、边界和异常分类，不含 secret 或
  客户数据。

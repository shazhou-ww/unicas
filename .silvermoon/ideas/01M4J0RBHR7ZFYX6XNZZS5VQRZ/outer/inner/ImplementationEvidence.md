# Implementation evidence

## Candidate scope

本实现严格落地已批准的 Ideal revision
`59b17057b6ea469e0b976fd029742f23ed76d05b`，没有修改 Ideal contract。
代码 candidate `5ac7b747767f5af8ef3b895c71113a09e7716106` 已通过普通非
force push 发布到 `origin/main`，发布后 local HEAD 与 remote primary 精确一致。

实现由以下 commits 组成：

- `788d699`：定义 Implementation contract；
- `9504bb9`：将 deployment assets 归还 owning packages；
- `41770cd`：建立 `release/` ownership 与新 command namespace；
- `ce3d8c8`：收敛 local/Git tooling 并删除旧 ownership roots；
- `5ac7b74`：让 retired API guard 扫描新的 `release/` maintained surface，
  不再读取已按批准方案删除的 `stacks/`。

## Package ownership evidence

### I-S01 / I-AC02

`@unicas/service-cloudflare`、`@unicas/spaces`、`@unicas/site` 与
`@unicas/docs-site` 均拥有 package-root Wrangler config，并在各自 manifest
中独立声明 `wrangler: ^4.20.0`。其中：

| Package | Package-owned config | 其他 ownership |
| --- | --- | --- |
| `@unicas/service-cloudflare` | `wrangler.toml` | `migrations/app-space/0001_baseline.sql` |
| `@unicas/spaces` | `wrangler.jsonc` | `migrations/`、Worker/UI source 与 package tests |
| `@unicas/site` | `wrangler.jsonc` | private package metadata、`public/`、tests 与 TypeScript config |
| `@unicas/docs-site` | `wrangler.jsonc` | docs source、build、tests 与 browser tests |

`@unicas/site` 是 private assets-only workspace package，没有引入 runtime
workspace dependency。Workspace inventory、TypeScript references、CODEOWNERS、
lockfile、package docs 与直接 config consumers 已同步。

Service schema tests 从新的 package-owned migration path 建库并通过；Spaces
repository、worker 与 D1 catalog tests 从 package-owned migrations/config
运行并通过；site package tests 验证 Wrangler assets directory 和公开静态文件。
四个 package 的最终 deployment checks 全部使用 package-local config。

## Release and command evidence

### I-S02 / I-AC03

Tracked release ownership root 的精确 children 为：

```text
README.md
app-user-sdk/
docs/
service/
shared/
site/
spaces/
```

Root supported interface 已原子切换为：

- `local:{dev,keys}`；
- `release:service:{plan,production,smoke}`；
- `release:spaces:{plan,production,bootstrap-deploy,bootstrap-data,smoke,issuer-proof}`；
- `release:site:{plan,production}`；
- `release:docs:{plan,production}`；
- `release:sdk:{prepare,artifacts,check,readiness,npm-check,npm-verify}`。

对 root manifest 的可执行 inventory 检查确认，旧 `dev`、`keys:local`、
`deploy`、`deploy:*`、`smoke`、`spaces:*`、`sdk:*`、`check:sdk-release`、
`check:sdk-readiness`、`check:npm-release` 与 `verify:npm-release` 均无匹配。
Workflow、docs、tests、hooks 与 repository-owned callers 均使用新命令；没有
compatibility alias、旧 path wrapper 或 symlink。

Service、Spaces、site 与 docs wrappers 只接受显式 dry-run/plan 或 production
mode。最终 validation 执行的四个 entrypoints 均为 dry-run；service plan 中
显示的 remote migration 和 production deploy commands 只是计划文本，没有
执行。

## Layout and boundary evidence

### I-S03 / I-AC01 / I-AC05

`scripts/` 的精确 children 为 `git/` 与 `local/`。Git hook lifecycle 与
pre-push gate 位于 `scripts/git/`；local runtime、mock OIDC、argument
forwarding、key generation、Dockerfile 与 Compose input 位于
`scripts/local/`。

Tracked-file inventory、filesystem check 与 workspace guards 共同证明：

- 顶层 `sdk/` 不存在；
- 顶层 `stacks/` 不存在；
- `packages/spaces/scripts/` 不存在；
- `release/` 与 `scripts/` 没有 unexpected child；
- `examples/app-user-sdk/` 保持顶层 external-consumer fixture；
- maintained source、config、docs 与 Agent guidance 不引用旧 ownership paths；
- `.agents/` 仍是唯一 canonical Agent guidance root；
- package dependency direction、single-service boundary 和禁止
  `@unidocs/*` dependency 的规则全部通过。

`tests/workspace-boundaries.test.mjs` 固定 accepted roots、package dependency
direction 与 zero-match；`tests/local-tooling.test.mjs` 固定 Docker argument
forwarding、Compose plan、Dockerfile command 及 root local/hook namespace。

## Preservation evidence

### I-S04 / I-AC04 / I-AC06

纯路径迁移使用 Git objects 逐项比较；下表左右 revision 的 object ID 完全相同：

| Artifact | 相同 Git object ID |
| --- | --- |
| Service migration tree | `5b41d605b661d3a347a1acf3ae1320203bb31b88` |
| Spaces migrations tree | `023a9ec38efc21491844636704a2c428774ab827` |
| Site `public/` tree（commit `9504bb9` 的纯移动） | `1a3e822f5dd6779c1f4fb8972fdfd428b44dd275` |
| SDK `codec.d.ts` | `dd0038310230e93edc0569f934b6915c0e02e151` |
| SDK `space-blob-client.d.ts` | `070a19b2443e6845d7b0c11104be523fa52b6783` |
| SDK `space-browser-cache.d.ts` | `dd5738544498a02a9136dd33b758c26a06d93750` |
| SDK `space-client.d.ts` | `195efb75234cfde44059e18c5fe55b125c587446` |
| SDK `space-file-client.d.ts` | `c1481aea5965a03fc5610ed2a62f4b79ece31c81` |
| SDK `space-protocol.d.ts` | `70645f1c8619ab0ff67c62b6f108eebc8e62cc3f` |
| SDK package matrix | `d69df8ecfb133a8bbaa9f7826a7621687f2a030d` |
| SDK release manifest | `dc791fcfdfcdf7431ebf4b2b3bd6a344219ad048` |
| `examples/app-user-sdk/` tree | `14ac79810b0ceb6d126af9ec5319fda994e4c248` |

Site assets 在 commit `9504bb9` 中为完整 byte-preserving tree move。后续唯一
产品静态内容差异是 `packages/site/public/index.html` 将公开支持命令
`pnpm dev` 更新为 `pnpm local:dev`；其余 moved assets 未改变。

Schema tests、API/OpenAPI drift tests、SDK/npm release policy、packed external
consumer、Node quickstart、Chromium/Firefox/WebKit quickstart、site tests 与 docs
browser tests 全部通过。Deployment plan tests 固定 Cloudflare resource identity、
binding、config path、deployment order 和显式 mode；dry-run 输出继续使用既有
service、D1、R2、KV、Spaces 与 public-origin resources。

## Validation commands

| Command | Result |
| --- | --- |
| `pnpm check:agent-guidance` | 通过；1 file，7 tests。 |
| `pnpm exec vitest run tests/workspace-boundaries.test.mjs tests/deploy-plan.test.mjs tests/local-tooling.test.mjs tests/stack-tenant-retirement.test.mjs --maxWorkers=1 --testTimeout=30000` | 通过；4 files，158 tests。 |
| `pnpm --filter @unicas/service-cloudflare test` | 通过；29 files，268 tests。 |
| `pnpm --filter @unicas/spaces test` | 通过；12 files，58 tests。 |
| `pnpm --filter @unicas/site test` | 通过；1 file，2 tests。 |
| `pnpm check:release` | 通过；7 files，50 tests。 |
| `pnpm exec vitest run tests/app-space-v1-cutover.test.mjs` | 通过；1 file，1 test，证明 retired API guard 扫描 `release/`。 |
| `pnpm validate` | 在最终 `pnpm validate:release` 的第一步通过；包含 Silvermoon worktree check、repository tests、全部非 service-cloudflare package tests、workspace build 与 typecheck。 |
| `pnpm validate:release` | 通过；在 `pnpm validate` 之上完成 50 项 release tests、268 项 service-cloudflare tests、SDK deterministic artifacts、packed external consumer、Node/browser quickstarts、3 项 docs browser tests与四个 deployment dry-run。 |
| `git diff --check` | 通过。 |
| Git object comparison 与 executable inventory | 通过；migrations、SDK baseline/manifest、初始 site move 和 example tree 等同，旧 roots/commands 零匹配。 |
| `pnpm check:ideas` | 通过。 |
| `pnpm exec silvermoon check --staged --audience agent` | 通过。 |

## Validation iterations

- 第一次最终 `pnpm validate:release` 在 `check:release` 发现 retired API guard
  仍扫描已删除的 `stacks/`。Commit `5ac7b74` 将 maintained roots 精确改为
  `packages/`、`docs/`、`release/` 与 `scripts/`；targeted test 和完整
  `pnpm validate:release` 随后均通过。
- 早期并行运行多组 Miniflare-heavy suites 时出现默认 5 秒 timeout；改为
  package 间串行后全部通过，未出现 assertion failure。
- 最终 focused `pnpm check:workspace` 重复运行时，Windows I/O 竞争使 Git tag
  fixture 与全仓扫描各一次超过默认 5 秒。Canonical `pnpm validate` 已在默认
  配置下通过；同一 158 项断言随后以单 worker 和 30 秒 CLI timeout 全部通过。
  Repository test timeout、断言和产品行为均未放宽或修改。
- Release-owned Spaces bootstrap tooling 初次从新目录运行时无法解析三个
  workspace clients；private root manifest 随后显式声明
  `@unicas/space-client`、`@unicas/space-file-client` 与
  `@unicas/space-protocol` devDependencies，lockfile、release tests 与完整
  validation 全部通过。

以上验证没有执行 production deployment、remote D1 migration、npm publish、
Git tag、secret mutation、production smoke 或 `unicas.shazhou.work` frozen
legacy environment 操作。实际 Wrangler 调用全部带 `--dry-run`。

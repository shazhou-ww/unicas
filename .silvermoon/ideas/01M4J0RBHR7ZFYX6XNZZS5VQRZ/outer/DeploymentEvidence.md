# Deployment evidence

证据时间：`2026-10-10T06:48:14.3235746Z`。

## 固定合同与 authoritative primary

- 已验收 Implementation revision：
  `26b3d4e72ca42e02adee354f0111f3e9151f28d9`
- Deployment contract revision：
  `5e6ed5bfa38ed9866ebd8cfa4662d8f53f2838a2`
- Contract primary commit：
  `c2d6195105ba94acd0bde14c34d54982260b6697`
- GitHub commit：
  [c2d6195105ba94acd0bde14c34d54982260b6697](https://github.com/shazhou-ww/unicas/commit/c2d6195105ba94acd0bde14c34d54982260b6697)

GitHub repository API 返回 default branch `main`、repository 未 archived；GitHub
commit API、`git ls-remote origin refs/heads/main` 与 local HEAD 均返回上述
contract primary。以下 commits 均可从该 primary 到达：

- code candidate `5ac7b747767f5af8ef3b895c71113a09e7716106`；
- Implementation evidence `39c10b7855a7ef372aef68904f653bd38cdd5fac`；
- Implementation acceptance `e433f4ff0efeaa36836c067bed2e7f8afe675718`。

## Remote ownership tree

GitHub recursive tree API 对 exact contract primary 返回 `truncated: false`。
Top-level tree 中包含 `.agents/`、`.githooks/`、`.github/`、`.silvermoon/`、
`docs/`、`examples/`、`packages/`、`release/`、`scripts/` 与 `tests/` 等
maintained roots。

Remote tree 的 accepted ownership inventory 为：

- `release/{app-user-sdk,docs,service,shared,site,spaces}`；
- `scripts/{git,local}`；
- `examples/app-user-sdk/`；
- `packages/service-cloudflare/wrangler.toml`；
- `packages/service-cloudflare/migrations/app-space/0001_baseline.sql`；
- `packages/spaces/wrangler.jsonc`；
- `packages/site/wrangler.jsonc`；
- `packages/docs-site/wrangler.jsonc`。

同一完整 tree 查询对顶层 `sdk/`、顶层 `stacks/` 与
`packages/spaces/scripts/` 返回零匹配。没有 compatibility copy 或 unexpected
ownership root。

## Remote commands 与 live workflow consumers

通过 GitHub Contents API 读取 exact primary 的 root `package.json`。Remote
supported command inventory 为：

- `local:{dev,keys}`；
- `release:service:{plan,production,smoke}`；
- `release:spaces:{plan,production,bootstrap-deploy,bootstrap-data,smoke,issuer-proof}`；
- `release:site:{plan,production}`；
- `release:docs:{plan,production}`；
- `release:sdk:{prepare,artifacts,check,readiness,npm-check,npm-verify}`。

旧 `dev`、`keys:local`、`deploy`、`deploy:*`、`smoke`、`spaces:*`、`sdk:*`
及旧 SDK check/verify aliases 的 remote inventory 为零。

同样通过 GitHub Contents API 读取 default-branch live workflows，结果为：

| Workflow | 新 ownership references |
| --- | --- |
| CI | `release/shared/*`、`release/service/*`、`release:{service,spaces,site,docs}:production` |
| Deploy documentation | `release:docs:{plan,production}` |
| Publish npm package | `release:sdk:artifacts`、`release/app-user-sdk/*`、`release:sdk:npm-verify` |
| Recover Spaces production | `release:spaces:bootstrap-deploy`、`release:spaces:bootstrap-data` |

四个 workflow 对 `stacks/unicas`、`packages/spaces/scripts`、旧 root release
script paths 及旧 `pnpm deploy|spaces:*|sdk:*|dev|keys:local` commands 均为零
匹配。本 Deployment 没有触发这些 workflows。

## Actions 与 deployment 查询

按 exact SHA 查询 GitHub Actions 与 deployments：

| Primary SHA | Repository-owned workflow runs | Dependency dynamic checks | GitHub deployments |
| --- | ---: | --- | ---: |
| `5ac7b747767f5af8ef3b895c71113a09e7716106` | 0 | 2，均 success | 0 |
| `39c10b7855a7ef372aef68904f653bd38cdd5fac` | 0 | 0 | 0 |
| `e433f4ff0efeaa36836c067bed2e7f8afe675718` | 0 | 0 | 0 |
| `c2d6195105ba94acd0bde14c34d54982260b6697` | 0 | 0 | 0 |

Code candidate 上的两项 `event=dynamic` dependency checks 为：

- [run 38031264945](https://github.com/shazhou-ww/unicas/actions/runs/38031264945)；
- [run 38031265093](https://github.com/shazhou-ww/unicas/actions/runs/38031265093)。

两项均由 GitHub dependency update service 创建并成功完成，不是
repository-owned CI、Security、docs deployment、npm publication 或 Spaces
recovery workflow，因此没有把它们误记为本 idea deployment。

Proof 前后 ref snapshot 一致：

- `release` ref：
  `14739e8e45bd86d4b9100108fc7af837f8e8beaa`；
- 完整 remote tags listing 的 snapshot hash：
  `d5f4b9c6ff5a9b4ecdf9fecf5432d7aab69e70cf`。

没有 workflow dispatch、release push、production deployment、remote D1
migration、npm publication、tag creation、secret mutation、repository settings
mutation或 frozen legacy environment 操作。

## 执行证据

| Read-only command/API | Result |
| --- | --- |
| `pnpm exec silvermoon whats-next repository-cleanup --audience agent` | 固定 Deployment contract revision 与 exact primary。 |
| `pnpm check:ideas:remote` | 通过；remote contract snapshot 有效。 |
| `gh api repos/shazhou-ww/unicas` 与 `gh api repos/shazhou-ww/unicas/commits/main` | default branch 与 exact head 符合合同。 |
| `gh api repos/shazhou-ww/unicas/git/trees/<sha>?recursive=1` | 完整 tree 未截断；accepted layout 存在，removed roots 零匹配。 |
| GitHub Contents API：root manifest 与四个 workflows | 新 commands/paths 可见，旧 commands/paths 零匹配。 |
| `gh run list --commit <sha>` | 除两项已区分的 dependency dynamic checks 外，无 idea SHA 关联 run。 |
| GitHub Deployments API：四个 exact SHAs | 全部返回空列表。 |
| `git merge-base --is-ancestor` | code、evidence 与 acceptance commits 均可从 contract primary 到达。 |
| `git ls-remote` ref/tag snapshots | proof 前后 `release` ref 与 tags listing hash 不变。 |
| `pnpm check:ideas` | 通过。 |
| `pnpm exec silvermoon check --staged --audience agent` | 通过。 |

首次 tree API 的数据读取成功，但 PowerShell 在把嵌套引号转交给 `gh --jq` 时
破坏了 filter expression；没有发生远端写入。随后对同一 GET 响应使用
PowerShell 结构化过滤，得到上述完整、`truncated: false` 的结果。

## 结论与恢复判断

Repository cleanup 已作为 authoritative `main` tree 发布；remote layout、
commands、workflow consumers 和 Silvermoon snapshot 与已验收实现一致。观测
期间没有出现 product、Cloudflare、npm、tag、settings 或 frozen legacy
副作用，不需要恢复动作。

若后续复读发现 remote drift、旧 path 回归或 idea SHA 关联 production side
effect，应保留 immutable query/run evidence 并停止 Deployment acceptance。
实现缺陷必须返回 Inner World 形成新 implementation revision 并重新验收；不得
通过 workflow dispatch、补部署、settings mutation 或 force push 恢复。

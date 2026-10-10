# Deployment evidence

## Evidence basis

- Stable Deployment contract revision:
  `ca09f21023190e053132df221c615ba1696be6ea`
- Contract commit on primary:
  `6276f76c16d95a40e11d126d7adb1e2184a97dd8`
- Accepted Implementation revision:
  `e3de9e727abd40070127055de5b45922fe54b8e7`
- Acceptance status commit:
  `95d62f6ba0df78e8c0aa562adafb73f131ba9edb`

本次 Deployment 只验证 accepted candidate 的外部可追溯性、registry
可用性与 dry-run deployability。没有收到 `/publish app-user-sdk 0.2.0`、
Spaces/docs/UniCAS production deployment 或 legacy environment 修改授权。

## Primary traceability

`origin/main` 刷新后精确指向
`6276f76c16d95a40e11d126d7adb1e2184a97dd8`。Git ancestry 与 remote object
检查证明：

- acceptance commit `95d62f6...` 是 `origin/main` ancestor；
- primary `status.yaml` 记录
  `implementationAcceptedRevision:
  e3de9e727abd40070127055de5b45922fe54b8e7`；
- `ImplementationEvidence.md`、`sdk/api/space-client.d.ts` 与
  `sdk/release-manifest.json` 都从 `origin/main` 可读；
- `pnpm check:ideas:remote` 对 commit `6276f76...` 通过。

## Read-only npm candidate plan

执行：

```text
node scripts/prepare-npm-release.mjs --candidate \
  --tag npm/app-user-sdk/v0.2.0 \
  --commit 6276f76c16d95a40e11d126d7adb1e2184a97dd8 \
  --output <session-files>/sdk-release-plan.json
```

planner 以零退出完成，输出
`Prepared app-user-sdk@0.2.0 from
6276f76c16d95a40e11d126d7adb1e2184a97dd8`。session artifact 的 SHA-256 为：

```text
1d609aa7c593977d4d6826c7fd46160fb46393186223c177f196dbc6cfcea476
```

PowerShell JSON assertion 证明 plan 与 committed release manifest 的
`name`、`order`、`version`、`tarball`、`integrity` 逐项一致，全部内部
`@unicas/*` dependency 都是 exact `0.2.0`。

| Order | Package | Tarball integrity |
| ---: | --- | --- |
| 1 | `@unicas/codec@0.2.0` | `sha512-l0VjwwoHQcOOUxf23p2qjY/XKNo50hc5y9t5+UwpGjrPlhjOSQ3QIxgGLmGDrIYnHP0hk0xSUmV/4mWlH8NXrQ==` |
| 2 | `@unicas/space-protocol@0.2.0` | `sha512-Qh+gzcdyrO0Jc+lFG3f7qKVdoOuehOvtGva/ZosvhzU5Puzv2na9hjhqO9dGJuiJqEdtPCQ6Iz5g/o2fLbDAwA==` |
| 3 | `@unicas/space-client@0.2.0` | `sha512-NvuPMGKXrD670PywMfrnE8QLD1aihBwBpyWEoC8xdBpvrrYpIM3//luTdbZ/0yRRnTJY1+ALN/TOyzHXDH9S4g==` |
| 4 | `@unicas/space-blob-client@0.2.0` | `sha512-XSBLSBtfzYp5Egm3kGOnSX/j3WorC+0Pace4fWJpQf8x8Pm95T4hpDlEOfLQ59AnbriGal4zrrtRJWSASU6jzg==` |
| 5 | `@unicas/space-browser-cache@0.2.0` | `sha512-bfdQpoae3K8dB0SG9QvsZZoU1Ki4QXHaR25ciquQBNdljht4PWWkHS9kEtVRx0ZM5B1g3dtuz+2efFXEeszOTA==` |
| 6 | `@unicas/space-file-client@0.2.0` | `sha512-OHB0kMQ8DbGq0Xmwr7TAP54V4jJWC2YXbQ8Z1TqGlnfIYciAi62STgIL+LM/CuCOW4DSOoU1ZXJ83Ui9oU01eg==` |

plan 中六个 action 均为 `publish`，这里表示 registry preflight 判定该 immutable
version 可用；本 session 没有执行该 action。

## Registry and GitHub state

逐包 `npm view` 查询结果：

| Package | `0.2.0` | Current `latest` |
| --- | --- | --- |
| `@unicas/codec` | absent (`E404`) | `0.1.1` |
| `@unicas/space-protocol` | absent (`E404`) | `0.1.1` |
| `@unicas/space-client` | absent (`E404`) | `0.1.1` |
| `@unicas/space-blob-client` | absent (`E404`) | `0.1.1` |
| `@unicas/space-browser-cache` | absent (`E404`) | `0.1.1` |
| `@unicas/space-file-client` | absent (`E404`) | `0.1.1` |

read-only Git/GitHub 查询结果：

- `npm/app-user-sdk/v0.2.0` remote tag：不存在；
- 同名 GitHub Release：不存在；
- `publish-npm.yml` 中该 tag 的 workflow runs：`0`。

因此没有 npm version collision，`latest` 未移动，也没有 publication 触发事实。

## Deployment dry-runs

### Spaces

`pnpm deploy:spaces:plan` 以零退出完成：

- `@unicas/spaces` TypeScript 与 Vite build 成功；
- Wrangler `4.123.0` 读取 4 个 UI asset；
- 命令使用
  `wrangler deploy --dry-run --config ../../stacks/unicas/spaces/wrangler.jsonc`；
- 最终输出 `--dry-run: exiting now.`。

命令只显示 repository 内的 production placeholder/config shape，没有写入
Cloudflare resource。Node 同时报告既有 shell-argument deprecation warning，
不影响 dry-run 成功。

### Docs

`pnpm deploy:docs:plan` 以零退出完成：

- 构建 31 个 documentation pages；
- Wrangler `4.123.0` 读取 73 个 static assets；
- 命令使用 `wrangler deploy --dry-run --config wrangler.jsonc`；
- 最终输出 `--dry-run: exiting now.`。

没有执行 docs production deployment。

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm check:ideas:remote` | 通过；remote commit `6276f76c16d95a40e11d126d7adb1e2184a97dd8`。 |
| primary ancestry/status/object verification via `git fetch`, `git merge-base --is-ancestor`, `git show`, and `git cat-file -e` | 通过；accepted revision 与三个 required artifact 可从 primary 追溯。 |
| `node scripts/prepare-npm-release.mjs --candidate --tag npm/app-user-sdk/v0.2.0 --commit 6276f76c16d95a40e11d126d7adb1e2184a97dd8 --output <session-files>/sdk-release-plan.json` | 通过；六包 `0.2.0` candidate plan。 |
| PowerShell plan/manifest/dependency assertion | 通过；6 packages 匹配，内部 dependencies 为 exact `0.2.0`。 |
| `pnpm deploy:spaces:plan` | 通过；build + Wrangler dry-run，零 production write。 |
| `pnpm deploy:docs:plan` | 通过；31 pages + Wrangler dry-run，零 production write。 |
| six-package `npm view <package>@0.2.0 version --json` and `npm view <package> dist-tags.latest --json` | 通过；`0.2.0` 全部 absent，`latest` 全部 `0.1.1`。 |
| `git ls-remote --tags origin refs/tags/npm/app-user-sdk/v0.2.0` | 通过；无匹配。 |
| `gh release view npm/app-user-sdk/v0.2.0 --repo shazhou-ww/unicas` | expected not-found；Release 不存在。 |
| `gh run list --repo shazhou-ww/unicas --workflow publish-npm.yml ...` | 通过；candidate tag runs 为 `0`。 |
| `git status --short --branch` after all checks | clean；local branch 与 `origin/main` 同步。 |

## No-write conclusion

本次只执行 read-only registry/GitHub 查询、本地 build/planner 和 Wrangler
`--dry-run`。没有创建 tag、GitHub Release、npm package version，没有修改
dist-tag，没有执行 Cloudflare production deploy，也没有修改
`unicas.shazhou.work`。

辅助一致性检查的第一次 Node `-e` one-liner 因 PowerShell 引号传递产生本地
syntax error；随后使用原生 PowerShell JSON assertion 成功。该失败发生在读取
本地 JSON 前，没有外部或 repository 写入，也没有降低验证标准。

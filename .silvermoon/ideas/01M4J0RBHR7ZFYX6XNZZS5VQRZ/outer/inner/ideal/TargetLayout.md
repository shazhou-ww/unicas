# Target layout

## 目标目录

```text
release/
├── README.md
├── app-user-sdk/
│   ├── README.md
│   ├── api/
│   ├── package-matrix.json
│   ├── release-manifest.json
│   ├── prepare-sdk-release.mjs
│   ├── prepare-npm-release.mjs
│   ├── sdk-api-baseline.mjs
│   ├── sdk-readiness.mjs
│   └── verify-npm-release.mjs
├── docs/
│   └── deploy.mjs
├── service/
│   ├── deploy.mjs
│   ├── smoke.mjs
│   ├── cas-app-space-smoke.mjs
│   ├── smoke-target.mjs
│   ├── reset-smoke.mjs
│   ├── mcp-oauth-smoke.mjs
│   ├── cut-over-app-space-v1-issuers.mjs
│   ├── ensure-encryption-secrets.mjs
│   └── sync-manual-tracing-secrets.mjs
├── shared/
│   ├── manual-tracing.mjs
│   ├── tag-production-deployment.mjs
│   └── verify-release-revision.mjs
├── site/
│   └── deploy.mjs
└── spaces/
    ├── deploy.mjs
    ├── deployment-config.mjs
    ├── bootstrap.mjs
    ├── preflight.mjs
    ├── smoke.mjs
    └── sign-issuer-challenge.mjs

scripts/
├── git/
│   ├── git-hooks.mjs
│   └── pre-push-main.mjs
└── local/
    ├── dev.mjs
    ├── runtime.mjs
    ├── mock-oidc-worker.mjs
    ├── forward-local-args.mjs
    ├── run-local-compose.mjs
    ├── generate-local-capability-keys.mjs
    ├── Dockerfile
    └── compose.yaml

packages/
├── service-cloudflare/
│   ├── wrangler.toml
│   └── migrations/
│       └── app-space/
│           └── 0001_baseline.sql
├── spaces/
│   ├── wrangler.jsonc
│   └── migrations/
└── site/
    ├── package.json
    ├── wrangler.jsonc
    ├── public/
    ├── tests/
    └── tsconfig.json

examples/
└── app-user-sdk/
```

`release/docs/` 与 `release/site/` 的 deploy wrappers 只负责编排显式 plan 或
production mode。Wrangler config、source 和 tool dependency 始终由对应 package
拥有。

## Root command 映射

| Current command | Target command | 说明 |
| --- | --- | --- |
| `pnpm dev` | `pnpm local:dev` | 本地 Worker、mock OIDC 与 admin UI |
| `pnpm keys:local` | `pnpm local:keys` | 本地 capability key generation |
| `pnpm deploy` | 删除 | 不提供 implicit production replacement |
| `pnpm deploy:plan` | `pnpm release:service:plan` | Service dry-run |
| `pnpm deploy:production` | `pnpm release:service:production` | Service production |
| `pnpm smoke` | `pnpm release:service:smoke` | Service production/local smoke |
| `pnpm deploy:spaces:plan` | `pnpm release:spaces:plan` | Spaces dry-run |
| `pnpm deploy:spaces` | `pnpm release:spaces:production` | Spaces production |
| `pnpm deploy:spaces:bootstrap` | `pnpm release:spaces:bootstrap-deploy` | Recovery/initial bootstrap deployment |
| `pnpm spaces:bootstrap` | `pnpm release:spaces:bootstrap-data` | Post-deploy Principal/Space/root data bootstrap |
| `pnpm spaces:smoke` | `pnpm release:spaces:smoke` | Spaces smoke |
| `pnpm spaces:issuer-proof` | `pnpm release:spaces:issuer-proof` | Issuer activation proof |
| `pnpm deploy:site:plan` | `pnpm release:site:plan` | Product site dry-run |
| `pnpm deploy:site` | `pnpm release:site:production` | Product site production |
| `pnpm deploy:docs:plan` | `pnpm release:docs:plan` | Docs site dry-run |
| `pnpm deploy:docs` | `pnpm release:docs:production` | Docs site production |
| `pnpm sdk:prepare` | `pnpm release:sdk:prepare` | Rebuild SDK baseline/evidence |
| `pnpm sdk:artifacts` | `pnpm release:sdk:artifacts` | Check deterministic packed artifacts |
| `pnpm check:sdk-release` | `pnpm release:sdk:check` | SDK release suite |
| `pnpm check:sdk-readiness` | `pnpm release:sdk:readiness` | Community/readiness suite |
| `pnpm check:npm-release` | `pnpm release:sdk:npm-check` | npm publication policy suite |
| `pnpm verify:npm-release` | `pnpm release:sdk:npm-verify` | Registry/provenance verification |

`build`、`test`、`validate`、`validate:release`、`check:release`、`docs:build`、
`docs:check`、`hooks:*` 与 Silvermoon commands 保持原名。Package-local build、
test 和 typecheck scripts 保持 package ownership；package-local direct deploy
scripts 被 release wrappers 取代。

## Path migration rules

- 使用 Git rename 保留 history；不 copy-and-delete。
- 不保留旧 path wrappers、symlinks 或 compatibility copies。
- Migration SQL、SDK declaration baseline 和 static assets 在纯路径移动中必须
  byte-for-byte 不变；必要的 config/schema reference 更新单独显示在 diff。
- Historical Silvermoon evidence 中的旧路径不重写；maintained source、config、
  docs 与 guidance 必须全部更新。
- Root command names 是 supported repository interface；internal `.mjs` paths
  不提供 external compatibility。

## Implementation commits

### Commit 1：Package ownership

- 创建 private `@unicas/site` package，迁移 product apex assets/config/tests。
- 将 service migration 移到
  `packages/service-cloudflare/migrations/app-space/`。
- 将 Spaces Wrangler config/migrations 移到 `packages/spaces/`。
- 为 `@unicas/site` 与 `@unicas/spaces` 增加独立 Wrangler devDependency。
- 更新 package inventory、workspace/TypeScript references 与 package boundary
  tests。

最窄验证覆盖 workspace boundaries、service schema migration、Spaces package
tests、site package tests 与 deployment config parsing。

### Commit 2：Release ownership

- 创建 `release/` tree 和 ownership README。
- 迁移 `sdk/` contract/evidence、root release scripts、旧 service/Spaces deploy
  scripts 和 Spaces operational scripts。
- 新增 docs/site explicit-mode deploy wrappers。
- 原子切换 root commands、workflow、release tests、CODEOWNERS、gitattributes、
  docs links 与 package callers。

最窄验证覆盖 deploy plan、issuer cutover、SDK readiness/release、npm release、
release-gated CI 与四个 deployment dry-run entrypoints。

### Commit 3：Tooling cleanup

- 创建 `scripts/git/` 与 `scripts/local/`，移动 hook/local tooling 及 private
  Docker/compose inputs。
- 更新 README、package docs、canonical Agent guidance 和 repository guards。
- 将 `stacks/unicas/README.md` 的仍有效内容合并到当前 owner docs 后删除。
- 证明 maintained repository 中不存在旧 `sdk/`、`stacks/`、旧 script paths
  或旧 root commands。

最窄验证覆盖 local command plan/argument forwarding、Git hooks、
Agent guidance、workspace/retirement guards 与 docs links。

## Final validation

Implementation contract 应给出精确 commands；至少覆盖：

- Silvermoon worktree 与 staged checks；
- `pnpm check:agent-guidance`；
- `pnpm check:workspace`；
- `pnpm --filter @unicas/service-cloudflare test`；
- `pnpm --filter @unicas/spaces test`；
- `pnpm --filter @unicas/site test`；
- SDK/npm/release focused suites；
- `pnpm validate`；
- `pnpm validate:release`，只执行 build、tests、artifact checks、browser coverage
  和 deployment dry-runs，不允许 production side effect；
- old paths、old commands 与 unexpected duplicate assets 的零匹配检查。

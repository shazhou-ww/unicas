# Progress

Updated: 2026-09-21

## Current state

The approved Spaces file App is implemented as the private
`@unicas/spaces` package with deployment composition under
`stacks/unicas/spaces`. Worker authentication, App-owned capability issuance,
D1 catalog and recovery state, public file-client workflows, responsive UI,
non-interactive smoke, bootstrap/preflight tooling, protected release ordering,
and stable operations documentation pass local validation. The production App,
catalog, issuer, Principals, dedicated Google client, capability-v3 service, and
R2 signing credentials are provisioned. The normal release deployed the service
and Spaces Worker but exposed a smoke CLI argument-forwarding defect before a
smoke session was created; the tested fix awaits release rerun and user
acceptance.

## Decisions

- Keep App implementation in `packages/spaces` and only Wrangler, D1 migration,
  and deploy composition in `stacks/unicas/spaces`, per the requesting user's
  package-placement amendment during implementation.
- Keep the App independently deployed from `@unicas/service-cloudflare` and
  mechanically prohibit service, administrator-client, UniDocs, private D1/R2,
  KV, Durable Object, and service-binding dependencies.
- Use Google OIDC only for admitted browser Principals. The dedicated smoke
  Principal has no external identity and owns one temporary Root only during an
  active run.
- Keep capabilities, presigned upload URLs, signing keys, and uploaded bytes in
  Worker memory. Browser requests use opaque App sessions plus same-origin CSRF.
- Consume the integrated capability v3 operation vocabulary. GET routes receive
  only `cas:nodes:read`; file mutations receive node read/lease and Root Ref
  read/update. Spaces never receives usage or GC authority.
- Configure the public file client with 1 MiB chunks so a bounded 2 MiB smoke
  payload proves multi-node direct upload without a large Worker buffer.
- Persist old-manifest release intent in the same D1 batch as catalog revision,
  reconcile it with stable public Root Ref requests, and retry from bounded
  scheduled work after interruption.
- Require production bootstrap preflight and explicit one-time bootstrap mode.
  Normal production always deploys service, deploys Spaces, runs its smoke, and
  only then promotes the product and documentation sites.

## Human approvals

| Checkpoint | Status | Review artifact and decision evidence |
| --- | --- | --- |
| Scope | Approved | Requesting user reviewed the task-local proposal contained in authoritative primary revision `4f88af14826be8dca5c8d019bf11715193b7f36b` and stated on 2026-09-21 that the design had no issues. |
| Architecture | Approved | Requesting user, 2026-09-21: approved [Architecture.md](./Architecture.md), then explicitly selected App source under `packages/` with deployment composition under `stacks/`. |
| Business and data model | Approved | Requesting user, 2026-09-21: approved [BusinessDataModel.md](./BusinessDataModel.md). Implementation adds only the documented ephemeral smoke Root and pending-release recovery records within that retention model. |
| Interface | Approved | Requesting user, 2026-09-21: approved [InterfaceReview.md](./InterfaceReview.md) and the task-local visual review. |
| Delivery acceptance | Pending | Requires the exact integrated primary revision, authorized production bootstrap/deployment, live Google and release-smoke evidence, and the requesting user's explicit delivery decision. |

## Validation

- `pnpm build`: all 14 workspace packages passed; Admin WebUI emitted only its
  existing third-party sourcemap warnings.
- `pnpm typecheck`: all 14 workspace packages passed.
- `pnpm test:packages`: every package suite passed, including 56 Spaces tests
  across D1, OAuth, capability, file lifecycle, HTTP, UI, bootstrap, preflight,
  isolation, smoke retry, and recovery behavior.
- `pnpm deploy:spaces:plan`: Vite built the responsive UI and Wrangler completed
  a real dry-run with only App-owned `SPACES_DB` and `ASSETS` bindings.
- Documentation build, workspace-boundary tests, deployment-plan tests, OpenAPI
  drift tests, task checks, and editor diagnostics pass. The repository's
  repoledger patch test also passes when run alone with a 15-second timeout; on
  this Windows host it exceeds the root suite's unrelated 5-second default.
- Playwright fixture checks at 1440x900 and 390x844 found no document horizontal
  overflow. Long names did not overlap actions; the right-side mobile sheet,
  bottom-right trigger, Google-only login, and long-name rename dialog remained
  inside the viewport. Escape dismissal and focus restoration have component
  coverage.
- Main CI exposed a Linux-only path bug in the Spaces boundary test. The test
  now converts file URLs with Node's `fileURLToPath` rather than stripping a
  Windows-style leading slash; the same focused test passes on Windows and is
  ready for the required Linux CI rerun.
- Production bootstrap now runs only as a manual `release`-branch workflow
  behind the existing `Production` reviewer gate. It idempotently provisions
  D1, deploys issuer metadata with smoke disabled, and separately bootstraps
  user/smoke Principals after issuer activation. Normal production remains
  disabled until `SPACES_RELEASE_ENABLED=true` and never skips live smoke.
- Authorized production bootstrap created the dedicated D1 database and
  deployed the issuer/UI Worker with smoke disabled. The first Principal
  bootstrap exposed that Node cannot spawn the Windows `pnpm.cmd` shim with
  `shell:false` (`EINVAL`); bootstrap and preflight now use the portable pnpm
  invocation while Linux behavior remains unchanged.
- Wrangler `--file --json` returns execution summaries rather than SELECT rows.
  Bootstrap and preflight now start the installed Wrangler JS CLI directly,
  use `--command` for state reads, and retain protected temporary files only
  for mutation batches.
- The first real empty-catalog row reports `COUNT(*) = 0` alongside null entity
  fields. Bootstrap now recognizes that exact D1 shape as fresh state rather
  than a partial-state conflict.
- The authorized capability-v3 service deployment initially failed canonical
  smoke because production lacked R2 S3 signing credentials. The service was
  rolled back, an account-owned Object Read & Write token scoped only to
  `unicas-content` was installed as Worker and protected GitHub secrets, and the
  configured v3 version then passed the complete canonical production smoke.
- The Production workflow now synchronizes both R2 signing credentials before
  deploying the service, so a clean deployment or credential rotation cannot
  silently publish a Worker that returns `503` for direct uploads.
- Production catalog verification reports two active Principals, one external
  identity, two Principal-to-Space mappings, one persistent user Root, and zero
  smoke Roots, open smoke runs, or pending Root releases. Least-privileged
  production preflight also passes against the activated issuer.
- The dedicated `spaces-production` Google Web client is restricted to the
  Spaces callback. The replacement Cloudflare deployment token is restricted
  to Worker scripts, D1, account reads, and Worker routes on `unicas.work`; live
  Workers and D1 calls verified it before storage in the protected environment.
- Protected release run `35568230939` passed full validation, secret sync,
  service deployment, canonical service smoke, D1 migration/preflight, and
  Spaces deployment. Its Spaces smoke stopped before authentication with
  `invalid_arguments` because pnpm forwarded a redundant bare `--`; no run ID
  or temporary smoke state was created. The deploy plan now passes
  `--base-url` directly, with 40 focused deployment and smoke tests passing.

## Blockers

- The corrected release must be integrated and rerun through the protected
  Production workflow.
- Real-provider checks, the canonical Spaces smoke, and
  [UserAcceptance](./UserAcceptance.md) remain external gates. Delivery
  acceptance cannot be requested until that evidence is attached to the exact
  integrated primary revision.

## Outcome

The repository now contains a production-shaped external App that exercises
public UniCAS upload, immutable reuse, Root Ref retention, readback, isolation,
and bounded cleanup without private service access. The task remains ongoing
until authorized live deployment and explicit delivery acceptance complete.
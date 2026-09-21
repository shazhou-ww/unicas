# Progress

Updated: 2026-09-21

## Current state

The approved Spaces file App is implemented as the private
`@unicas/spaces` package with deployment composition under
`stacks/unicas/spaces`. Worker authentication, App-owned capability issuance,
D1 catalog and recovery state, public file-client workflows, responsive UI,
non-interactive smoke, bootstrap/preflight tooling, protected release ordering,
and stable operations documentation pass local validation. The next action is
to publish and integrate this source revision, then complete the separately
authorized production bootstrap, deployment, live smoke, and user acceptance.

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
- Use the current public v2 `cas:read`/`cas:write` vocabulary because the
  operation-permission task is not integrated. GET routes receive read only;
  mutations receive read plus write. No future permission string was invented.
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
- No production deployment, App/issuer activation, production D1 bootstrap,
  real Google callback, or live Spaces smoke was run without explicit release
  authorization and credentials.

## Blockers

- Production resources and protected values must be provisioned through
  [Spaces file App operations](/docs/spaces-smoke-app.md), including the App,
  issuer activation, dedicated D1, Principal mappings, Google client, signing
  keys, smoke credential, and Cloudflare deployment credentials.
- The live deployment, real-provider checks, canonical Spaces smoke, and
  [UserAcceptance](./UserAcceptance.md) remain external gates. Delivery
  acceptance cannot be requested until that evidence is attached to the exact
  integrated primary revision.

## Outcome

The repository now contains a production-shaped external App that exercises
public UniCAS upload, immutable reuse, Root Ref retention, readback, isolation,
and bounded cleanup without private service access. The task remains ongoing
until authorized live deployment and explicit delivery acceptance complete.
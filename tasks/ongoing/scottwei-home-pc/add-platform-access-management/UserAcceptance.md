# Operator acceptance

Updated: 2026-09-16

This records human-only environment verification, not final delivery approval.
Record actual results and delivery decisions separately in [Progress](./Progress.md).

## Purpose

Verify production cutover and real-provider behavior that local mock testing
cannot establish, without treating deployment as implicitly authorized.

## Test target

- Target: deployed revision `955ec4c9690d820966c5aae942a1223a554c275d`, tagged
   `production-20260916-99`, at `https://console.unicas.work/admin/`.
   Local mock and production release evidence are documented in [Progress](./Progress.md).

## Preconditions

- Reviewer: the requesting user or an authorized UniCAS production operator.
- Follow the [Platform Access runbook](/docs/cas-operations.md#platform-access-bootstrap-and-migration).
  Production deployment/bootstrap requires a separately authorized release window,
   verified backup, exact verified OIDC Principals, and an App/Space-compatible
   rollback version. For this one prelaunch test-data reset only, the user
   explicitly waived backup; no data-restoration guarantee is claimed.
   Do not post identity values, tokens, keys, SQL containing
  identities, invitation URLs, or private profile information in this task.

## Steps

1. Review the schema-only preflight and confirm that App/Space physical cutover
   is complete. If legacy Stack tables are authoritative, stop; do not apply
   the Platform Access procedure to them.
2. In an authorized release window, execute the runbook's two-phase bootstrap
   and deployment procedure. Verify at least one active Platform Admin using
   the count-only check, then establish a second through the protected workflow.
3. With approved test accounts, verify real-provider Console login and CLI/MCP
   access. Confirm a member without `apps.create` cannot create an App or use
   Platform administration; verify an unentitled identity is denied admission.
4. Use an email-bound test invitation with the real provider. Verify acceptance
   grants only the intended App membership or platform authorities, and that
   subsequent login works without relying on the static allowlist.
5. Verify a revoked test grant/membership stops authorizing the next browser/MCP
   request. Retain the rollback secret and key material for the documented window;
   do not exercise destructive disaster recovery just to complete this checklist.

## Expected results

1. The target has the supported App/Space schema and a reviewed backup/rollback.
2. Initial access is established without an admission gap or implicit email grants.
3. Console, CLI and MCP enforce current authority, independently of OAuth scopes.
4. Invitation scope and real-provider verified identity rules are respected.
5. Revocation meets the task's bound and the rollback window remains operable.

## Report outcome

Report `Accepted` with the reviewed/deployed revision and date, or
`Failed at step <number>: <non-secret observation>`. If no release window is
authorized, report `Not run: awaiting authorized release`; this is not a pass.
Final delivery approval must be explicit and separate from these test results.

## Status

Update, 2026-09-16: the user authorized clearing all prelaunch test data,
explicitly waived backup, and selected both initial administrator authorities.
The authenticated Google account was verified without storing its identity
values. The one-time reset completed under a maintenance Worker: application
tables were recreated empty, R2/KV were verified empty, and DOs had no persistent
data. Fresh audited bootstrap and the CI smoke fixture were then verified;
all old sessions were removed. [Release PR #2](https://github.com/shazhou-ww/unicas/pull/2)
was merged after required checks. [Production CI](https://github.com/shazhou-ww/unicas/actions/runs/35077282282)
attempt 1 failed its immediate post-deploy health check with HTTP 503. Health
subsequently returned HTTP 200; retrying the failed jobs passed canonical smoke,
all deployments, four public-origin checks, and production tagging on attempt 2.
Maintenance has ended and the Console login page renders correctly.

Post-release real-provider login and the remaining operator tests are pending.
Log in again because the old session was intentionally invalidated. The initial
bootstrap blocker is resolved, but production CI is not evidence of successful
human invitation, revocation, CLI/MCP, or final delivery acceptance. Playground
layout polish remains [backlog](/tasks/backlog/refine-playground-layout/Task.md).
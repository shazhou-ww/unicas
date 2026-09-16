# Operator acceptance

Updated: 2026-09-16

This records human-only environment verification, not final delivery approval.
Record actual results and delivery decisions separately in [Progress](./Progress.md).

## Purpose

Verify production cutover and real-provider behavior that local mock testing
cannot establish, without treating deployment as implicitly authorized.

## Test target

- Target: the reviewed implementation on `origin/main`, with the exact deployed
  revision recorded by the operator. No production deployment occurred in the
  coding session. Local mock acceptance is documented in [Progress](./Progress.md).

## Preconditions

- Reviewer: the requesting user or an authorized UniCAS production operator.
- Follow the [Platform Access runbook](/docs/cas-operations.md#platform-access-bootstrap-and-migration).
  Production deployment/bootstrap requires a separately authorized release window,
  verified backup, exact verified OIDC Principals, and an App/Space-compatible
  rollback version. Do not post identity values, tokens, keys, SQL containing
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

Blocked before release on 2026-09-16. The user accepted the current management
Console and requested release, with further Playground layout polish deferred
to [backlog](/tasks/backlog/refine-playground-layout/Task.md). This is separate
from production test execution.

Agent read-only production schema preflight found `cas_apps` and
`cas_app_members`, but no `cas_platform_principals`. The operator must complete
the backup and out-of-band bootstrap before the enforcing release can proceed.
No production writes/deployment or real-provider acceptance test was performed;
no successful operator result has been reported.
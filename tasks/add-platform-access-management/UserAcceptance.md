# Operator acceptance

Updated: 2026-09-16

This records human-only environment verification, not final delivery approval.
Record actual results and delivery decisions separately in [Progress](./Progress.md).

## Purpose

Verify production cutover and real-provider behavior that local mock testing
cannot establish, without treating deployment as implicitly authorized.

## Test target

- Target: deployed revision `19dd7ef122c55953505ac4f2610b6b3536327277`, tagged
   `production-20260916-108`, at `https://console.unicas.work/admin/`.
   Local mock and production release evidence are documented in [Progress](./Progress.md).

## Preconditions

- Reviewer: the requesting user or an authorized UniCAS production operator.
- Follow the [Platform Access runbook](/packages/docs-site/content/cas-operations.md#platform-access-bootstrap-and-migration).
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

Accepted: the user accepted the final operator result on 2026-09-16 with the
documented operational waiver for a second Platform Admin.

## Evidence

The final operator result at the end of this section supersedes earlier
chronological statements that individual checks were pending.

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
layout polish remains [backlog](/tasks/replace-playground-with-reference-app/Task.md).

Acceptance resumed on 2026-09-16: the production restricted-login page loaded
and redirected to the real Google account identifier prompt. Authentication is
awaiting direct user interaction in the browser; no identity or OAuth values
were retained in this record. After login, resume at step 3.

The initial administrator then passed real-provider Console login. Live CLI
login/read checks and an authenticated stdio MCP `get_current_principal` call
also passed against production, with consistent current authorities and no
write. A secondary-account attempt in the VS Code embedded Electron browser was
rejected by Google before the UniCAS callback with a generic JavaScript-disabled
message even though JavaScript execution was confirmed. This is not a UniCAS
deny-by-default result. Resume step 3 in ordinary Chrome or Edge with the
secondary account, then continue invitation and revocation checks.

Steps 3 through 5 then passed with the secondary account in an ordinary browser.
Before invitation, the real provider returned to UniCAS and admission was
denied. An email-bound App invitation granted exactly one App membership and no
platform authority. The Console omitted App creation and Platform Administration;
live MCP calls independently denied both operations. After membership removal,
the Principal had no effective access, and the next browser and MCP requests
from existing sessions were denied.

The revocation operation exposed a production edge defect: Brotli weakened the
strong revision ETag, causing a conditional CLI write to fail before a local
client compatibility fix was applied. Source fixes now normalize only numeric
revision ETags weakened in transit, prohibit edge transformation of BFF revision
responses, and show a dedicated no-management-access page with an account-switch
action. These fixes passed focused and package validation and are published as
`c171901`. PR #3 merged them to `release` as `19dd7ef`; production run
35099365111 passed and tagged the deployment as `production-20260916-108`.
Post-release checks confirmed both the dedicated no-management-access page and
the strong revision ETag with `no-transform` at the production edge. Step 2
still requires establishing a second Platform Admin through the protected
workflow; do not report overall acceptance until that item completes.

The user explicitly declined to grant Neko persistent `platform.admin`
authority on 2026-09-16. This defers step 2 rather than failing it. Keep the task
ongoing unless a second administrator is established through the protected
workflow or the acceptance requirement is explicitly revised.

Final operator result, 2026-09-16: **Accepted with an explicit operational
waiver for a second Platform Admin.** The user subsequently confirmed that a
second administrator is not required for now and asked to close the remaining
work. At least one verified Platform Admin remains active, recovery is
documented, and steps 1 and 3 through 5 passed against production. Production
audit reads confirmed denied App creation and the invitation/acceptance/removal
lifecycle without exposing invitation token fields.

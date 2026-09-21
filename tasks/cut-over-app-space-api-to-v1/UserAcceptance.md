# App/Space v1 acceptance

Updated: 2026-09-21

This records human-only deployed-environment verification, not design review
or implicit delivery approval. Record only non-secret results. Final delivery
approval remains a separate explicit decision for the exact primary revision.

## Purpose

Verify the deployed App/Space v1 contract, prototype rejection, frozen
Stack/Tenant isolation, and the maintained Spaces consumer where local tests
cannot establish production routing or issuer behavior.

## Test target

- Target revision: pending primary integration and authorized deployment.
- UniCAS API: the authorized deployment target.
- Spaces App: the corresponding authorized deployment target.

## Preconditions

- The release window, target environment, and test App/Space resources are
  explicitly authorized.
- The App issuer has been inspected or replaced so its audience is the target
  public origin plus `/v1/apps/{appId}` and it emits Space claim `ver: 1` with
  exact operation permissions.
- Do not record capabilities, credentials, issuer keys, presigned URLs,
  customer identifiers, object keys, hashes, or uploaded content here.

## Steps

1. Run `pnpm smoke:v1` against the configured frozen Stack/Tenant test target
   and confirm its behavior is unchanged.
2. Run `pnpm smoke` against the App/Space target. Confirm all seven v1
   operations, mixed-sign Root Ref update, idempotent replay, Space isolation,
   and cleanup pass.
3. Run `pnpm spaces:smoke -- --base-url <target>` and confirm capability
   issuance, direct upload, commit, readback, denial probes, and cleanup pass.
4. Probe one representative prototype HTTP request and confirm it returns
   `404` without redirect or alias behavior.
5. Present prototype Space claim versions 2 and 3 to a released v1 route and
   confirm both return `401 invalid_token`; confirm a broad prototype
   permission also returns `401 invalid_token`.
6. Confirm deployed configuration has no prototype capability cutoff and that
   logs and artifacts contain no secret material.

## Expected results

1. Frozen Stack/Tenant v1 behavior is unchanged.
2. App/Space v1 and its mixed-sign Root Ref update pass end to end.
3. The maintained Spaces consumer passes issuance, storage, denial, and cleanup.
4. The prototype HTTP route returns `404` without redirect or alias behavior.
5. Prototype claims and broad permissions fail closed with `401 invalid_token`.
6. No cutoff remains configured and no secret material appears in evidence.

## Report outcome

Report `Accepted` with the reviewed revision and date, or
`Failed at step <number>: <non-secret observation>`. If no authorized target or
credentials are available, report `Not run: awaiting authorized release`;
this is not a pass.

## Status

Pending

# First-party OAuth issuer retirement

UniCAS Apps use external OAuth issuers. The former first-party issuer is
removed in two deployments so that its one-hour access tokens can expire
before verification material is withdrawn. This procedure changes only the
retired control-plane issuer state and deployment secret. It does not modify
CAS nodes, Root Refs, Spaces, content, leases, usage accounting, or garbage
collection.

## Required approvals

Production deployment, D1 deletion, and secret revocation are separate
operations. An operator must receive explicit approval for each operation.
Do not combine database or secret cleanup with a normal deployment.

## Procedure

1. Deploy Revision A from main commit `6228714`. Do not deploy Revision B in
   the same operation.
2. Confirm the deployment is healthy and record the successful deployment
   timestamp as the issuance cutoff. Revision A disables automatic issuer
   provisioning and all new first-party token issuance while preserving
   verification of tokens issued before the cutoff.
3. Wait at least 3,660 seconds after the recorded cutoff: the 3,600-second
   maximum token lifetime plus the 60-second verifier hard-stale boundary.
   Restart the wait from a later timestamp if there is evidence that the old
   signing path remained reachable.
4. Obtain explicit approval to deploy Revision B. Deploy the final cleanup
   revision and verify external issuer discovery, JWKS retrieval, and
   capability verification. Confirm former first-party metadata, JWKS,
   authorization, and token URLs return the normal not-found response.
5. Keep the retired D1 rows and signing secret during the deployment rollback
   window. Rolling back only to Revision A restores verification; it does not
   restore provisioning or issuance.
6. After Revision B is healthy and rollback is no longer required, obtain
   explicit approval for a standalone D1 operation. Back up or export the
   affected rows according to the production retention policy, then drop
   `cas_managed_issuers_by_status` and `cas_app_managed_issuers`. Verify the
   external issuer table and all App and Space records are unchanged.
7. Obtain separate explicit approval to revoke and delete the retired signing
   key secret and key identifier from the production runtime.

Do not run production garbage collection as part of this procedure.

## Rollback boundaries

- Before Revision B, roll back to Revision A and continue serving old
  verification material. Do not restore an older revision that can issue
  first-party tokens.
- After the D1 cleanup, Revision A requires restoring the retired table from
  backup before it can be used for verification.
- After key revocation, restoring Revision A also requires restoring the key.
  Prefer correcting Revision B instead of crossing either destructive
  boundary.

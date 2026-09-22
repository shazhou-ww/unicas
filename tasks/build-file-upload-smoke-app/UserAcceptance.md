# Spaces App acceptance

Updated: 2026-09-21

This records human-only production and product verification, not design review
or implicit delivery approval. Record only non-secret results. Final delivery
approval remains a separate explicit decision for the exact primary revision.

## Purpose

Verify the deployed Spaces App, real Google identity boundary, and protected
release smoke where local fixtures cannot establish production behavior.

## Test target

- Target revision: pending integration and production deployment.
- App: `https://spaces.unicas.work`.
- Runbook: [Spaces file App operations](/packages/spaces/README.md).

## Preconditions

- The protected release uses dedicated non-customer App, Space, Principals,
  catalog, keys, credentials, and test content.
- Production bootstrap and issuer activation pass without posting subjects,
  email addresses, tokens, private keys, capabilities, URLs, hashes, object
  keys, or uploaded bytes in this record.
- The release workflow identifies the exact revision under review and its
  Spaces smoke run by non-secret run ID.

## Steps

1. Confirm `spaces.unicas.work` serves the independently deployed App and the
   Google callback uses the dedicated Spaces OAuth client.
2. Sign in with an admitted Google test identity. Verify folder creation,
   breadcrumb navigation, upload into the selected folder, file rename without
   another content upload, exact-byte download, delete confirmation, logout,
   and mobile navigation.
3. Confirm an unknown Google identity receives the admission-denied state and
   does not create a Principal, mapping, Space, session, or file Root.
4. Review the protected workflow evidence. The Spaces smoke must report
   authenticate, hash, lease, upload, commit, verify, and cleanup; require a
   multi-node first upload, zero-upload ready-node reuse, positive Root Ref,
   exact readback, authority denial, Space denial, and two successful cleanup
   confirmations.
5. Confirm no incomplete smoke run, temporary smoke Root, pending Root release,
   credential, capability, presigned URL, object key, or uploaded content was
   retained in logs or artifacts.

## Expected results

1. The dedicated custom domain serves Spaces and returns through the configured
   Google callback without sharing the Console session boundary.
2. The approved desktop and mobile file workflow completes with exact downloaded
   bytes and without exposing UniCAS credentials or upload URLs.
3. Unknown identities fail closed and create no durable App or UniCAS state.
4. The release smoke proves all required stages, ready-node reuse, Root retention,
   exact readback, both isolation denials, and idempotent cleanup.
5. App D1, UniCAS Root Refs, logs, and workflow artifacts contain no stale smoke
   state or secret material after the run.

## Report outcome

Report `Accepted` with the reviewed revision and date, or
`Failed at step <number>: <non-secret observation>`. If no authorized release
window or credentials are available, report `Not run: awaiting authorized
release`; this is not a pass.

## Status

Pending.

No authorized production bootstrap or release has been run yet.
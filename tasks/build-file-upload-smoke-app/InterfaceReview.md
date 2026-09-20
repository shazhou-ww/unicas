# Interface review

Status: Pending requesting-user approval.

## Decision requested

Approve the Google-first browser workflow, App HTTP surface, and non-interactive
release smoke contract below. The visual proposal is illustrated in
[UiReview.html](./UiReview.html); this document is the normative behavior
contract.

## Browser workflow

1. An unauthenticated visitor sees the Spaces identity and one enabled
   `Continue with Google` action. Microsoft and GitHub are not enabled in MVP.
2. Successful Google callback opens the file list for the admitted Principal.
   Unknown identities see an admission denial with sign-out and retry actions;
   no Space is created.
3. `Upload file` accepts one bounded file, shows determinate progress by
   workflow stage, and adds the committed file only after positive Root Ref and
   catalog commit succeed.
4. Each file row exposes download and delete. Download preserves exact bytes
   and a safe filename. Delete requires confirmation and remains retryable until
   release is confirmed.
5. Empty, loading, authorization, upload, readback, and cleanup failure states
   are explicit. Errors show a stable code and correlation ID, never secret or
   uploaded content.

The MVP is a compact file utility, not a drive. It has no folders, previews,
sharing, drag reordering, bulk operations, or account-linking UI.

## App HTTP surface

| Method and route | Authentication | Success | Material failure behavior |
| --- | --- | --- | --- |
| `GET /auth/google/start` | None | Redirect to Google with state, nonce, and PKCE | Configuration failure returns generic `503`; no secret detail. |
| `GET /auth/google/callback` | OAuth state cookie | Set App session and redirect to `/files` | Invalid callback returns stable `auth_invalid`; unknown identity returns `principal_not_admitted`. |
| `POST /auth/logout` | App session | Revoke session, clear cookie, return `204` | Idempotent when already logged out. |
| `POST /api/smoke/session` | Protected smoke credential | Short-lived session for the dedicated smoke Principal | Disabled outside the protected deployment; rejects invalid credentials without logging them. |
| `GET /api/session` | App session | Principal display data and enabled provider | `401 session_required` or `403 principal_suspended`. |
| `GET /api/files` | App session | Principal-owned committed catalog rows | Never accepts App, Space, Principal, or ref-domain override. |
| `POST /api/files` | App session, multipart body | `201` committed file summary | Reject size/type framing before work; report stage and correlation ID; reconcile retained partial commit. |
| `GET /api/files/{fileId}` | App session | Stream exact bytes with safe content headers | `404` for absent or non-owned identifier; range support follows accepted implementation capability. |
| `DELETE /api/files/{fileId}` | App session plus explicit UI confirmation | `204` after release or accepted idempotent absence | Retry-safe; cleanup-pending response does not claim deletion completed. |
| `GET /.well-known/openid-configuration` | None | Stable issuer metadata for UniCAS discovery | Public metadata contains no private material. |
| `GET /.well-known/jwks.json` | None | Active and overlap-window public signing keys | Cache policy must not outlive key rotation overlap. |

Mutation routes require same-origin checks and CSRF protection in addition to
the session cookie. API responses are JSON except redirects, downloads, and
empty `204` responses. Unknown routes do not fall back to the SPA under `/api`,
`/auth`, or `/.well-known`.

## Upload stage contract

The UI and smoke command may report only these coarse stages:

```text
authenticate -> hash -> lease -> upload -> commit -> verify -> cleanup
```

Progress never exposes node hashes, upload URLs, capabilities, object keys, or
file content. Cancellation before commit stops new work; cancellation after a
positive Root Ref enters cleanup rather than pretending the upload vanished.

## Non-interactive smoke command

```text
pnpm spaces:smoke -- --base-url https://spaces.unicas.work
```

`SPACES_SMOKE_CREDENTIAL` is supplied only through the protected CI secret
store. The command:

1. authenticates as the dedicated smoke Principal through an App-owned,
   non-browser exchange;
2. uploads deterministic, uniquely named multi-node bytes through the App;
3. verifies the committed catalog entry, positive Root Ref, download length,
   and exact digest;
4. uploads identical bytes again and requires public lease results to confirm
   immutable ready-node reuse;
5. requires one denied operation lacking authority and one denied request for a
   different Space;
6. releases both test roots and repeats cleanup to prove idempotency; and
7. exits nonzero at the first failed stage after attempting bounded cleanup.

Successful output is one non-secret summary containing run ID and completed
stages. Failed output contains run ID, stage, stable App/UniCAS error code, and
HTTP status when available. It never prints request headers, response bodies,
tokens, signed URLs, node identifiers, uploaded bytes, or secret-derived values.

## Automation behavior

The release workflow obtains the smoke credential from its protected
environment, invokes the command after Spaces deployment, and blocks all later
promotion on nonzero exit. Retries are bounded and limited to documented
idempotent operations. Cleanup failure is itself a smoke failure even when
upload and readback passed.

## Compatibility

Microsoft and GitHub later implement the same start/callback contract under
provider-specific routes and resolve to the same App session. Their absence in
MVP does not change file APIs, Principal IDs, Space mappings, or catalog keys.
The smoke interface remains independent of social login availability.

## Review question

Approve this Google-only MVP user workflow, Worker HTTP contract, coarse progress
and error model, and release-smoke command behavior?

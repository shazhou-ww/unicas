# Interface review

Status: Approved by the requesting user on 2026-09-21.

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
3. The root and each folder show directories before files, with a breadcrumb
   from `Files` to the current location. Selecting a folder navigates into it;
   breadcrumb segments navigate back without a full-page reload.
4. `New folder` creates one valid child directory. `Upload file` targets the
   currently displayed folder, shows determinate progress by workflow stage,
   and appears only after the replacement manifest and Root Ref commit succeed.
5. A file row provides download, rename, and delete. Rename is inline or
   dialog-based and preserves unchanged bytes. Delete requires confirmation and
   remains retryable until the replacement manifest commits.
6. Empty, loading, authorization, name conflict, optimistic conflict, upload,
   readback, and cleanup failure states
   are explicit. Errors show a stable code and correlation ID, never secret or
   uploaded content.

The MVP is a compact file utility, not a general drive. It has no previews,
sharing, drag reordering, bulk operations, cross-folder copy, or account-linking
UI.

## App HTTP surface

| Method and route | Authentication | Success | Material failure behavior |
| --- | --- | --- | --- |
| `GET /auth/google/start` | None | Redirect to Google with state, nonce, and PKCE | Configuration failure returns generic `503`; no secret detail. |
| `GET /auth/google/callback` | OAuth state cookie | Set App session and redirect to `/files` | Invalid callback returns stable `auth_invalid`; unknown identity returns `principal_not_admitted`. |
| `POST /auth/logout` | App session | Revoke session, clear cookie, return `204` | Idempotent when already logged out. |
| `POST /api/smoke/session` | Protected smoke credential | Short-lived session for the dedicated smoke Principal | Disabled outside the protected deployment; rejects invalid credentials without logging them. |
| `GET /api/session` | App session | Principal display data and enabled provider | `401 session_required` or `403 principal_suspended`. |
| `GET /api/entries?path=/...` | App session | Current directory entries and Root revision | Reject invalid paths; never accepts App, Space, Principal, or ref-domain override. |
| `POST /api/folders` | App session, `{ parentPath, name, revision }` | `201` directory summary and next revision | Reject invalid/reserved names, absent parents, duplicates, and stale revisions. |
| `POST /api/files` | App session, multipart body with `parentPath` and `revision` | `201` committed file summary and next revision | Reject size/path framing before work; reconcile a retained partial commit. |
| `GET /api/files/content?path=/...` | App session | Stream exact bytes with safe content headers | `404` for absent/non-file path; range support follows accepted implementation capability. |
| `PATCH /api/files` | App session, `{ path, name, revision }` | Renamed file and next revision | Reject non-file paths, duplicates, invalid names, and stale revisions; does not re-upload file bytes. |
| `DELETE /api/files?path=/...` | App session plus revision and explicit UI confirmation | `204` after replacement manifest commit | Reject non-file paths; deletion is retry-safe. |
| `GET /.well-known/openid-configuration` | None | Stable issuer metadata for UniCAS discovery | Public metadata contains no private material. |
| `GET /.well-known/jwks.json` | None | Active and overlap-window public signing keys | Cache policy must not outlive key rotation overlap. |

Mutation routes require same-origin checks and CSRF protection in addition to
the session cookie. API responses are JSON except redirects, downloads, and
empty `204` responses. Unknown routes do not fall back to the SPA under `/api`,
`/auth`, or `/.well-known`. All paths are normalized absolute paths; names are
single path segments and cannot contain separators, control characters, `.`,
or `..`. The client sends the last observed Root revision with every mutation.

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
2. creates a uniquely named folder and navigates/list-checks it;
3. uploads deterministic, uniquely named multi-node bytes into that folder;
4. renames the uploaded file and verifies the old path is absent, the new path
   resolves, the committed Root Ref is positive, and downloaded bytes have the
   exact length and digest;
5. uploads identical bytes again and requires public lease results to confirm
   immutable ready-node reuse without a content upload caused by rename;
6. requires one denied operation lacking authority and one denied request for a
   different Space;
7. removes the smoke file and folder through the App's bounded cleanup path,
   releases the test Root when dedicated, and repeats cleanup to prove
   idempotency; and
8. exits nonzero at the first failed stage after attempting bounded cleanup.

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

Approve this Google-only MVP workflow with folder creation, breadcrumb
navigation, folder-targeted upload, file rename, the Worker HTTP contract, and
release-smoke behavior?

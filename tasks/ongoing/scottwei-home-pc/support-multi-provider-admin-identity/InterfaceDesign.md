# Interface review

Status: Approved with pre-launch replacement amendment

## Governing amendment

The requesting user's 2026-09-17 [rollout decision](./RolloutReview.md)
supersedes compatibility-period requirements below. Do not retain deprecated
Principal projections, legacy routes or tool aliases, compatibility redirects,
sunset mechanisms, or old-credential upgrades in the affected administrator
surface. Update consumers to the current Account contract and fresh login.
Configured provider selection, profile/linking flows, and privacy/error rules
remain unchanged. The HTML comparison is historical review material, not a
requirement to ship both old and new interfaces.

## Decision requested

Approve the administrator wire types, HTTP/BFF routes, Console account and login
flows, CLI/MCP presentation, compatibility policy, and privacy/error semantics
below. Approval permits implementation of these interfaces after the business
and data model and architecture checkpoints are also approved.

## Visual change prototype

[Open the before/after HTML prototype](./InterfaceDesign.html) to compare the
planned Sign in, Account, and People surfaces with the current interaction
shape. The prototype illustrates information hierarchy and workflow changes;
the contracts and behavior in this document remain normative.

## Interface principles

- `accountId` is the only durable administrator relationship key.
- Exact provider identity remains authentication and audit evidence, not a
  membership or authority key.
- Email is shown only as verified Account contact data or an explicitly labeled
  display hint. It never links Accounts or grants authority.
- Provider selection chooses a server-configured adapter, never an endpoint,
  issuer, algorithm, or scope supplied by the browser.
- Login, callback, invitation, challenge, and linking failures disclose no
  Account existence, other Account identifier, invitation validity, provider
  token, challenge value, or private provider email list.
- Existing clients receive an explicit compatibility period; the final v2
  relationship contracts are Account-keyed.

## Protocol types

The administrator protocol adds the following conceptual types. Exact schema
names may follow current package naming, but their fields and authority meaning
are part of this review.

```ts
type AccountId = string;
type ProviderKind = "google" | "microsoft" | "github";

interface ExternalIdentitySummary {
  externalIdentityId: string;
  provider: ProviderKind;
  accountHint: string | null;
  linkedAt: number;
  lastAuthenticatedAt: number | null;
  currentLogin: boolean;
}

interface ExternalIdentityDetail extends ExternalIdentitySummary {
  issuer: string;
  subject: string;
}

interface PrimaryVerifiedEmail {
  normalizedEmail: string;
  source: "google-oidc" | "github-emails-api" | "unicas-email-challenge";
  verifiedAt: number;
}

type AccountAvatar =
  | { kind: "image"; url: string }
  | { kind: "fallback"; initials: string; colorIndex: number };

interface AccountSummary {
  accountId: AccountId;
  displayName: string | null;
  primaryVerifiedEmail: PrimaryVerifiedEmail | null;
  avatar: AccountAvatar;
}

interface AccountSelf extends AccountSummary {
  blockedAt: number | null;
  platformAuthorities: readonly PlatformAuthority[];
  identities: readonly ExternalIdentitySummary[];
}

interface PlatformAccountSummary extends AccountSummary {
  blockedAt: number | null;
  platformAuthorities: readonly PlatformAuthority[];
}
```

Ordinary Platform People and App Members use the same `AccountSummary`.
Platform People enrich it as `PlatformAccountSummary`; self-service Account
reads include the one primary verified contact, platform authorities, and masked
active identity summaries. Only platform-administrator identity detail and
privileged audit results expose `ExternalIdentityDetail` with exact issuer and
subject. Provider access tokens, raw claims, challenge data, prior emails, and
unverified email values have no wire type. `credentialVersion` is carried only
inside server-managed credentials and is not a general API resource revision.

`AppAdminMeResponse` becomes:

```ts
interface AppAdminMeResponse {
  account: AccountSelf;
  authenticatedIdentity: ExternalIdentitySummary;
  memberships: readonly AppMembership[];
}
```

During the compatibility window, deprecated `principal` and `profile` fields
remain additive aliases for old clients. `principal` describes only the exact
identity used for this session; it is never accepted as an authorization target.
`profile.emailForDisplay` aliases
`account.primaryVerifiedEmail.normalizedEmail` only when a verified primary
exists and is otherwise null.

`AppMembership`, AccountPlatformAuthority, People rows, Playground cache
identity, and audit target projections replace Principal relationship fields
with `accountId`/`AccountSummary`. Privileged audit events additionally expose
the exact authenticated ExternalIdentity summary used by the event.

## Administrator API

### Self Account

| Method and path | Purpose |
| --- | --- |
| `GET /admin/account` | Return the current Account, primary verified contact, platform authorities, masked active identities, and link capabilities. |
| `PATCH /admin/account/profile` | Update display name or avatar choice under CSRF and origin checks. |
| `GET /admin/account/identities` | Return masked active linked identity summaries for the current Account. |

Profile PATCH uses field-level last-write-wins semantics and never accepts an
email value. Provider avatar URLs cannot be supplied directly; a caller selects
an already sanitized provider image or the deterministic fallback. Changing
the primary verified contact requires a separate fresh-verification workflow;
no such general contact-change route is introduced by this task.

Link and unlink commits are BFF-authentication workflows rather than bearer JSON
mutations because both require fresh interactive proof. The Account APIs may
expose read-only operation status, but never accept provider tokens.

### Relationship routes

Final v2 relationship operations use Account IDs:

- App member remove targets `(appId, accountId)`.
- Platform authority grant/revoke targets `(accountId, authority)` and is
  idempotent; there is no whole-authority-set replacement operation.
- Account block/restore targets `accountId`.
- Platform People return `PlatformAccountSummary`; App Members return
  `AccountSummary`.
- Audit filters may accept `accountId`; exact identity is a result detail, not a
  relationship locator.

Authority and block commands enforce the last-platform-administrator and
self-block rules in one service transaction. They do not use client-visible
resource revisions or `If-Match`.

Legacy issuer/subject request shapes remain available only behind the migration
compatibility stage. They resolve through the permanent one-to-one map, emit
standard deprecation/sunset headers, and are removed from final v2 generated
contracts after all in-repository clients migrate. They never accept email as a
locator.

A separate platform-administrator identity-detail operation may return exact
issuer/subject for a known `accountId` when required for security investigation.
It is not used by ordinary People/Member tables, login failures, linking
conflicts, CLI output, or MCP consent pages.

All source contracts, Zod schemas, TypeScript exports, client operations, and
both generated OpenAPI documents change together; drift tests remain mandatory.

## Browser authentication routes

The BFF owns these presentation routes outside the administrator OpenAPI:

| Method and path | Behavior |
| --- | --- |
| `GET /admin/auth/login` | Render configured provider choices and generic prior error state. |
| `GET /admin/auth/start/{provider}` | Start normal login using a closed provider name and sealed continuation. |
| `GET /admin/auth/callback/{provider}` | Console and CLI browser callback per configured provider; state must bind the same provider and purpose. |
| `GET /oauth/callback/{provider}` | Remote MCP OAuth callback per configured provider; state must bind the same provider and purpose. |
| `GET /admin/auth/cli/authorize` | Validate CLI request, then render provider choices or honor a valid provider preference. |
| `POST /admin/auth/link/{provider}` | CSRF-protected start of current-Account reauthentication and target-provider linking. |
| `POST /admin/auth/unlink/{externalIdentityId}` | CSRF-protected start of reauthentication before guarded unlinking. |
| `GET /admin/auth/email-challenge` | Render the invitation-bound Microsoft challenge page. |
| `POST /admin/auth/email-challenge/verify` | Verify a code against sealed session state; never accepts an arbitrary destination. |
| `POST /admin/auth/email-challenge/resend` | Rate-limited resend to the same invitation address. |

`{provider}` is accepted only when present and enabled in the server registry.
The callback rejects any mismatch among route, sealed state, purpose, redirect,
and provider. Retired `/admin/auth/oidc`, `/admin/auth/callback`, and
`/oauth/{provider}/callback` routes return `404`; no compatibility aliases are
retained.

Sensitive continuation data remains encrypted server-side or in the existing
opaque session store. URLs carry only opaque state and provider-independent
error classes. Invitation and challenge tokens never appear in redirect query
parameters or logs.

## Login experience

The restricted login page presents one button for each configured provider:

- Continue with Google
- Continue with Microsoft
- Continue with GitHub

Unavailable providers are omitted rather than rendered as broken controls. A
failed provider returns the same authentication-failed state. A successfully
authenticated but unadmitted identity returns the existing no-management-access
state and allows another provider login. The page does not reveal whether the
identity or invitation exists.

An invitation link enters the same provider selector. Google and GitHub proceed
only when the fresh callback supplies matching verified evidence. A Microsoft
personal-account callback with an email-constrained invitation moves to the
email challenge page. The page may display the already-invited destination in
masked form, offers a six-digit code input and resend command, and never lets the
caller edit the destination. Generic failure text covers wrong, expired, used,
or nonexistent challenges.

## Console Account view

The user menu gains an Account command opening a full-width Account view within
the existing Console shell. It contains:

- Account profile: editable display name and avatar/image fallback plus the
  read-only primary verified contact and its verification source.
- Login methods: one row per linked provider with provider name, masked provider
  identity hint when safe, linked date, latest authentication date, and Current
  session marker.
- Link login method: provider menu excluding active links, followed by explicit
  explanation that matching email does not transfer access.
- Unlink command: icon action with tooltip and a confirmation dialog; disabled
  when it would remove the last usable identity.

The link flow first says that the current Account and new login will both be
authenticated. It never promises linking based on email. On success, all prior
sessions are rotated and the user returns to Account view. If the new identity
belongs elsewhere, show:

> This login is already attached to another UniCAS account. Linking cannot
> combine accounts or access. Account merge is not available here.

No other Account ID, profile, email, membership, or authority is displayed.
There is no Merge button, preview, endpoint, or undo language in this task.

To unlink the current login identity, the view requires choosing and freshly
authenticating another linked method that will remain. Memberships, authorities,
Playground files, and Account audit history do not change after unlinking.

Avatar fallback is stable across providers: server-returned initials plus
palette index. The UI does not derive fallback color from email and loads image
avatars with no referrer. Missing/broken images fall back without changing
layout.

## CLI behavior

`unicas login` continues to open the Console authorization page and defaults to
the provider selector. An optional convenience flag is allowed:

```text
unicas login --provider google|microsoft|github
```

The value selects only a configured registry entry. Unsupported or disabled
values fail locally/server-side without accepting a URL. The loopback callback,
CLI state, PKCE challenge, one-time exchange, and credential-store format remain
provider-neutral.

Successful output identifies the stable Account display name, primary verified
email when present, and `accountId`; it does not print provider tokens or private
email lists. Existing stored sessions are migrated in place. `unicas logout`
continues to revoke the current session.

Account linking remains a browser-confirmed workflow. If exposed through a CLI
command, the command only opens the same Console Account flow; it never accepts
provider credentials in the terminal.

## MCP behavior

### Stdio MCP

The stdio server uses the same stored CLI session and Account-keyed admin client.
`get_current_principal` remains as a deprecated compatibility alias during the
client migration; its replacement is `get_current_account`, returning
`AccountSummary`, current ExternalIdentity summary, authorities, and
memberships. Member/platform tools accept `accountId`, not issuer/email keys.

### Remote MCP OAuth

The OAuth authorization page presents the configured provider choices using the
same registry and callback policy as Console login. The resulting OAuth grant is
bound to `accountId`, exact authenticated identity, and `credentialVersion`.
Provider selection is not added to token endpoints, dynamic client registration,
or MCP tool inputs.

Consent and denial pages show Account-level profile data only after successful
login. A blocked/revoked Account invalidates every linked provider's grants
within the existing check bound.

## Error and privacy contract

Administrator JSON errors use stable codes and generic messages:

| HTTP | Code | Meaning exposed to authenticated caller |
| --- | --- | --- |
| 401 | `AUTHENTICATION_REQUIRED` | No current valid Account session. |
| 403 | `ACCOUNT_ACCESS_DENIED` | Current Account is blocked or has no admission grant. |
| 409 | `IDENTITY_LINK_CONFLICT` | Target identity cannot be linked; it may require a future Merge. No owner details. |
| 409 | `FINAL_IDENTITY_CANNOT_BE_UNLINKED` | Operation would leave no usable login. |
| 409 | `AUTHENTICATION_STATE_CHANGED` | Credential state changed; restart the fresh-auth operation. |
| 428 | `FRESH_AUTHENTICATION_REQUIRED` | Interactive recent proof is required. |
| 400 | `EMAIL_CHALLENGE_FAILED` | Challenge is invalid, expired, used, or over its attempt limit. |
| 503 | `AUTH_PROVIDER_UNAVAILABLE` | Chosen configured provider is temporarily unavailable. |

Public login redirects collapse protocol, provider, account lookup, and
invitation lookup failures into the existing generic states. Detailed causes go
only to redacted structured telemetry. Responses and URLs never include:

- another Account's identifier or existence confirmation;
- invitation validity before successful admission;
- provider authorization codes, access/refresh/ID tokens, or raw claims;
- email challenge value/hash;
- GitHub private or unverified email lists;
- Microsoft raw email/UPN as verified evidence.

Rate limits apply per opaque flow handle, source signal, provider, and Account
where known. Error timing and text must not intentionally distinguish missing
from already-consumed invitations or challenges.

## Compatibility and release behavior

1. Add Account fields and new self endpoints while old client fields remain.
2. Update Console, admin client, CLI, stdio MCP, and remote MCP to Account fields.
3. Migrate member mutations to `accountId` and platform-authority commands to
  `(accountId, authority)`; keep legacy identity locators only under the
  documented migration stage with sunset headers.
4. Switch login page to the provider registry with Google enabled first.
5. Enable Microsoft/GitHub and challenge UI after Account migration passes.
6. Enable link/unlink UI last. Once used, old identity-keyed binaries are outside
   the supported rollback path.
7. Remove compatibility routes/types only after generated-contract, client, and
   deployment checks show no in-repository use.

## Required interface validation

- source contract and generated OpenAPI drift tests;
- admin-client request/response tests for every Account-keyed route;
- login selector keyboard, focus, mobile layout, and configured-provider tests;
- callback route/provider/state mismatch and generic-error tests;
- Account profile field-update and primary-verified-contact projection tests;
- link success, same-Account idempotence, other-Account conflict privacy, replay,
  cancellation, timeout, and session-rotation tests;
- unlink final-identity, current-identity handoff, race, and unchanged-grant tests;
- Microsoft challenge masked destination, resend limits, generic failure, and
  no-edit destination tests;
- CLI selector/default/`--provider` and one-time exchange tests;
- stdio and remote MCP Account identity, revocation, and compatibility tests;
- screenshots and accessibility checks for login, Account, conflict, challenge,
  and confirmation states at desktop and mobile widths;
- response, redirect, log, and audit scans for prohibited secrets and PII.

## References

- [Task](./Task.md)
- [Business and data model](./BusinessDataModel.md)
- [Architecture](./Architecture.md)
- [Current protocol types](/packages/admin-protocol/src/types.ts)
- [Current administrator contracts](/packages/admin-protocol/src/contract.ts)
- [Current administrator client](/packages/admin-client/src/client.ts)
- [Current administrator BFF](/packages/service-cloudflare/src/admin-bff/bff.ts)
- [Current CLI login](/packages/admin-cli/src/oauth/login.ts)
- [Current Console user menu](/packages/admin-webui/src/ui/user-menu.tsx)
- [Current MCP authorization](/packages/service-cloudflare/src/mcp/auth.ts)

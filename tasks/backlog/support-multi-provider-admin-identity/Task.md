# Support linked multi-provider administrator login

Created: 2026-09-16

## Goal

Allow one human administrator to use Google, a personal Microsoft account, or
GitHub to authenticate to the UniCAS Console, CLI, and MCP surfaces, claim an
email-constrained invitation using trustworthy email evidence, and retain the
same App memberships and platform access across explicitly linked login
identities through one stable UniCAS account.

## Context

The administrator BFF currently runs one Google OIDC authorization-code flow.
The authenticated Principal and all App membership, platform access, session,
Playground ownership, and audit references are keyed by the external
`(issuer, subject)` pair. `Profile.emailForDisplay` is deliberately
non-authoritative, while an invitation may constrain acceptance to a normalized
email address.

That model safely supports one identity provider but gives the same person a
different Principal when they use another provider. It also cannot assign one
meaning to provider email claims: Google supplies `email_verified`, GitHub
requires the Emails API to distinguish verified addresses, and Microsoft does
not provide an equivalent reliable `email_verified` claim for personal
accounts. Treating matching email text as an automatic account link would make
email changes, address reuse, and provider differences privilege-transfer
paths.

Email remains a first-class UniCAS identity attribute because administrators
invite people by email. It establishes whether a caller may claim a particular
invitation; it does not by itself establish the durable owner of memberships or
authority. A stable UniCAS account must own those grants, with one or more
separately authenticated external identities attached to it.

This work follows the Google-only invitation admission and deny-by-default
platform authorization established by
[Rebuild the Console with platform access management](/tasks/ongoing/copilot-unicas-standalone/add-platform-access-management/Task.md).
Finish and publish that task before changing its identity and invitation
boundaries here.

## Scope

- Introduce a stable UniCAS account identifier and persistence model that can
  own App memberships, platform access, sessions, Playground ownership, and
  durable audit attribution independently of an external login identity.
- Store each external identity as a unique provider/issuer/subject binding to
  one account. Preserve the exact authenticated external identity alongside the
  stable account in security-sensitive audit evidence.
- Migrate each existing `(issuer, subject)` Principal to its own account without
  merging records by email, changing its grants, or breaking active ownership
  semantics. Define session transition and rollback behavior for the migration.
- Replace the single Google BFF configuration with a server-side provider
  registry and adapters shared by Console, CLI authorization, and MCP login.
- Support Google through OIDC authorization code + PKCE, nonce, and strict
  issuer/audience verification, retaining `sub` as the external account key.
- Support personal Microsoft accounts through the `consumers` OIDC authority,
  retaining the verified token issuer and pairwise `sub` as the external
  account key. Keep tenant-template issuer validation for a future `common`
  authority outside this initial provider configuration.
- Support GitHub through its OAuth authorization-code flow with PKCE, then read
  the authenticated user's durable numeric ID and the Emails API. Request only
  the scopes required for identity and verified email retrieval, and do not use
  mutable GitHub login names as identity keys.
- Represent invitation-claim evidence explicitly in the authenticated service
  context rather than inferring verification from `Profile.emailForDisplay`.
  Evidence records the normalized email, verifier/source, and verification
  time needed by the acceptance policy; display profile fields remain
  non-authoritative.
- Allow Google and GitHub evidence only for provider-asserted verified email
  addresses. For personal Microsoft accounts, verify control of the invitation
  address with a short-lived, single-use UniCAS email challenge before allowing
  an email-constrained invitation to be accepted.
- Preserve exact, case-insensitive `trim().toLowerCase()` comparison for current
  invitation addresses unless a separately reviewed normalization contract is
  adopted. Do not infer equivalence from Gmail dots, plus-addressing, aliases,
  Unicode lookalikes, or provider-specific mailbox behavior.
- Add user-initiated account linking from an authenticated account. Require
  fresh proof of both the current account and the external identity being
  attached; matching email may suggest linking but must never perform it
  automatically.
- Reject linking when the external identity already belongs to another account.
  Do not silently merge accounts, grants, audit history, or stored data.
- Add guarded unlinking that requires fresh authentication and leaves at least
  one usable login identity. Blocking or revoking a UniCAS account must apply to
  every linked identity within the existing revocation bound.
- Update administrator protocol types, service ports, Cloudflare persistence,
  BFF/session composition, CLI and MCP login presentation, Console account UI,
  generated contracts, terminology, operations documentation, and focused
  security tests required by the settled account model.

## Out of scope

- Using Cloudflare Access as the durable UniCAS account or membership authority;
  it may remain an optional outer gate for internal or operational endpoints.
- Password authentication, passkeys, email-only primary login, open
  registration, or automatic authorization based on an email domain.
- Automatic account linking or permission transfer because two providers report
  the same email address.
- Merging two already-established UniCAS accounts. Conflicts require a separate
  reviewed recovery or merge workflow.
- Microsoft work/school multi-tenant `common` login, Entra tenant federation,
  SCIM provisioning, organization/group synchronization, or customer-managed
  identity providers.
- Retaining provider access or refresh tokens after the callback unless a
  provider operation demonstrably requires them beyond identity resolution.
- Changes to App-owned end-user identity, App OAuth issuers, Space/data-plane
  capability verification, or the frozen `unicas.shazhou.work` environment.

## Acceptance criteria

- [ ] A new or migrated administrator has one stable UniCAS account whose App
      memberships, platform access, Playground ownership, and authorization do
      not change when a linked external login identity is used.
- [ ] Existing Google Principals migrate one-to-one without email-based merges,
      grant changes, orphaned memberships, or loss of durable audit attribution.
- [ ] Console, CLI, and MCP login offer the configured Google, personal
      Microsoft account, and GitHub methods and resolve all three through the
      same account-binding service before issuing a UniCAS session or grant.
- [ ] Google tokens are accepted only after signature, issuer, audience, expiry,
      nonce, and subject validation; only `email_verified=true` addresses can
      satisfy an email-constrained invitation.
- [ ] Personal Microsoft account tokens are accepted only from the configured
      `consumers` flow after strict token validation, and their raw `email` or
      `preferred_username` claims cannot satisfy an invitation without the
      separate UniCAS email challenge.
- [ ] GitHub login revalidates the authenticated user for every callback, keys
      the identity by durable numeric user ID, and allows only an address marked
      `verified` by the Emails API to satisfy an invitation.
- [ ] Invitation acceptance receives explicit, fresh verified-email evidence,
      compares only the canonical invitation address, atomically consumes the
      invitation, and grants membership to the stable account rather than to a
      display email or raw provider identity.
- [ ] A caller cannot use an unverified, absent, stale, mismatched, public-only,
      or display-only email value to cross the invitation admission gate.
- [ ] Two unlinked provider identities reporting the same email remain separate;
      the product may suggest linking but does not combine accounts or inherit
      authority automatically.
- [ ] Linking requires fresh successful authentication of both identities,
      rejects an identity already bound elsewhere, rotates affected sessions,
      and emits audit evidence without provider tokens or invitation secrets.
- [ ] Unlinking requires fresh authentication, cannot remove the final usable
      identity, and does not alter the account's memberships or audit identity.
- [ ] Blocking an account or removing its final admission grant denies all
      linked identities on browser, CLI, and MCP paths within the accepted
      revocation bound.
- [ ] Login, callback, linking, email challenge, and migration failures fail
      closed without exposing account existence, invitation validity, provider
      tokens, email challenge values, or private email lists in responses,
      URLs, logs, or audit records.
- [ ] Protocol, service, Cloudflare adapter, BFF, CLI/MCP, Console, migration,
      and security tests cover successful and denied flows for all providers,
      and the relevant package and repository validation commands pass.

## Constraints

- External provider subject identifiers remain immutable authentication facts;
  profile names, email strings, GitHub login names, UPNs, and Cloudflare Access
  email-derived subjects are never durable authorization keys.
- Verified email is authoritative only for the narrowly scoped invitation or
  account-recovery decision whose policy consumes it. Email changes never move
  existing membership, platform access, storage ownership, or audit history.
- Account linking is a privilege-bearing mutation and must use state, nonce
  where applicable, PKCE, short expirations, one-time continuations, session
  rotation, CSRF/origin protection, optimistic concurrency, and durable audit.
- Provider issuer, discovery, authorization, token, JWKS, and API endpoints are
  operator-configured or provider-pinned server-side values. Callback input
  must never select trust endpoints or algorithms.
- Keep browser code free of provider client secrets, session encryption keys,
  email-provider credentials, provider access tokens, and account-link tokens.
- Keep administrator and data access planes separate. Human login changes must
  not make administrator sessions valid on App/Space data-plane routes.
- Preserve the cloud-neutral service boundary: provider/BFF IO and Cloudflare
  bindings remain in presentation/platform adapters, while account,
  invitation, linking, and authorization invariants live behind explicit
  service ports.
- Minimize stored personal data. Document retention and redaction for verified
  email evidence, provider profile data, email challenges, and authentication
  audit events before production rollout.
- Use forward migrations and an explicitly tested rollback/compatibility plan;
  do not rewrite immutable audit history or merge existing accounts by email.

## Human review checkpoints

Task creation and this checkpoint plan do not record approval. Each required
artifact must be prepared during execution, published with a pending decision,
and explicitly approved before the protected work begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable owner | This task's goal, scope, out of scope, constraints, acceptance criteria, provider set, and dependency on the platform-access task. | Substantive implementation. |
| Business and data model | Required | User or delegated identity/security owner | Task-owned account model and migration design covering Account, ExternalIdentity, verified-email evidence, invitation ownership, membership and platform grants, audit attribution, linking conflicts, retention, one-to-one migration, and rollback. | Changing persistent schemas, ownership keys, migration code, invitation rules, linking semantics, or authorization records. |
| Architecture | Required | User or delegated architecture owner | Task-owned architecture and sequencing design covering provider adapters, `control-auth`, cloud-neutral service ports, Cloudflare persistence and BFF composition, session/account resolution, revocation, deployment order, and compatibility boundaries. | Changing module responsibilities, dependencies, provider composition, session architecture, or deployment wiring. |
| Interface | Required | User or delegated product/API owner | Task-owned interface design for Console login and account management, callback and linking routes, administrator API contracts, CLI and MCP login behavior, error/privacy semantics, and compatibility with existing clients. | Implementing or changing affected GUI flows, HTTP contracts, CLI commands, or MCP behavior. |
| Delivery acceptance | Required | User or accountable owner | Integrated revision, provider and migration test matrix, security and privacy evidence, validation results, deployment/rollback rehearsal, and required Console, CLI, and MCP manual test results. | Marking the task completed and archiving it. |

## References

- [UniCAS terminology](/docs/terminology.md)
- [Current control authentication client](/packages/control-auth/src/index.ts)
- [Current administrator BFF](/packages/service-cloudflare/src/admin-bff/bff.ts)
- [Current authenticated service context](/packages/service/src/control-plane.ts)
- [Current invitation acceptance](/packages/service/src/control-admin.ts)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Microsoft ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [Microsoft OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub Emails API](https://docs.github.com/en/rest/users/emails)
- [Cloudflare Access application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
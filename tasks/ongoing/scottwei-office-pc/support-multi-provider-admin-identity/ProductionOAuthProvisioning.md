# Production OAuth and email provisioning

Use this guide to obtain the production credentials needed for Google,
Microsoft personal-account, and GitHub administrator login, plus Microsoft
invitation email challenges. It intentionally contains no credential values.

## What to apply for now

| Provider | What is needed | Apply now? |
| --- | --- | --- |
| Google | One Web OAuth client with two exact redirect URIs | Yes. A client ID is already present in `wrangler.toml`; first confirm that the team controls its Google Cloud project and secret. |
| Microsoft | One Entra app registration for personal Microsoft accounts, with one client secret | Yes. |
| GitHub | One OAuth App with two exact callback URLs | Yes. GitHub now supports multiple callback URLs per OAuth App. |
| Cloudflare | Email Sending onboarding for `unicas.work` and the existing Worker `EMAIL` binding | Yes. |
| Resend | Nothing in the current implementation | No. There is no Resend adapter or `RESEND_API_KEY`; do not buy or create a Resend key for this code path. |
| UniCAS encryption | Two independently generated 32-byte keys | Generate locally; these are not provider-issued credentials. |

The person doing this work needs:

- Google Cloud project access that can configure Google Auth Platform;
- at least Application Developer access in a Microsoft Entra tenant;
- GitHub account or organization admin access for OAuth Apps;
- Cloudflare account access to the `unicas.work` zone, Email Service, and the
  `unicas` Worker;
- repository admin access to configure the GitHub `Production` Environment.

## Current deployment requirements

Production login must not be enabled until these requirements are met:

1. The GitHub `Production` Environment contains all three new client ID
   variables and all five Worker secrets listed below. Names using the retired
   `GOOGLE_OIDC_*`, `MICROSOFT_OIDC_*`, or `GITHUB_OAUTH_*` contract are ignored.
2. The release deployment synchronizes Worker secrets before deployment and
   injects all three client IDs as Wrangler variables. Missing values fail the
   deployment closed.
3. Cloudflare email delivery to a mailbox that was not pre-verified in the
   account must pass before Microsoft invitation login is accepted for
   production. Binding existence alone is insufficient evidence.

## Credential inventory

### Non-secret variables

| Runtime name | Source |
| --- | --- |
| `OAUTH_GOOGLE_CLIENT_ID` | Google Web OAuth client ID |
| `OAUTH_MICROSOFT_CLIENT_ID` | Microsoft Application (client) ID |
| `OAUTH_GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `ADMIN_EMAIL_FROM` | Sender on the onboarded Cloudflare domain, currently `no-reply@unicas.work` |

### Secrets

| Runtime name | Source |
| --- | --- |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Google Web OAuth client secret |
| `OAUTH_MICROSOFT_CLIENT_SECRET` | Microsoft client secret **Value**, not its Secret ID |
| `OAUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `SESSION_ENCRYPTION_KEYS` | Versioned JSON map of key ID to base64url 32-byte AES key |
| `OAUTH_STATE_ENCRYPTION_KEY` | A different base64url 32-byte AES key |

Never put a secret in tracked files, repository variables, commit messages,
issues, task documents, chat, or command arguments. Provider portals often show
a new secret only once; enter it into the approved secret stores before leaving
the creation page.

## Google setup

Official references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
and [Google OAuth client management](https://support.google.com/cloud/answer/15549257).

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview)
   and select the production project. If the client ID currently committed in
   `wrangler.toml` is retained, first locate that client under **Clients** and
   confirm ownership.
2. Under **Branding**, configure:
   - application name: `UniCAS`;
   - user support and developer contact addresses owned by the team;
   - homepage: `https://unicas.work`;
   - privacy-policy and terms URLs when publishing externally;
   - authorized domain: `unicas.work`.
3. Under **Audience**, choose **External** if personal Google accounts must sign
   in. While testing, add only the named acceptance-test accounts as test users.
4. Under **Data Access**, request only `openid`, `email`, and `profile`. UniCAS
   does not need Drive, Calendar, Gmail, or other Google API scopes.
5. Open **Clients** > **Create client** and select **Web application**.
6. Name it `UniCAS production` and add these exact authorized redirect URIs,
   without a trailing slash:

   ```text
   https://console.unicas.work/admin/auth/callback/google
   https://api.unicas.work/oauth/callback/google
   ```

7. Create the client. Record the client ID and immediately store the newly
   displayed client secret. Google may not show the complete secret again.
8. Put the client ID in `OAUTH_GOOGLE_CLIENT_ID` and the secret in
   `OAUTH_GOOGLE_CLIENT_SECRET`.
9. Complete Google branding/verification if Google requests it before changing
   the app from Testing to Production. Basic OIDC scopes normally avoid
   sensitive API verification, but branding and domain verification can still
   be required.

The redirect URI must match exactly, including scheme, host, path, case, and
trailing-slash absence. `redirect_uri_mismatch` means the provider registration
does not match the runtime URL.

## Microsoft personal-account setup

Official references: [register an Entra application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
and [redirect URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Select the tenant that will own the registration, then open **Entra ID** >
   **App registrations** > **New registration**.
3. Enter `UniCAS production` as the name.
4. For **Supported account types**, select **Personal Microsoft accounts only**.
   UniCAS deliberately uses the `consumers` authority; do not select a
   work/school-only audience.
5. Select **Register** and record the **Application (client) ID**. The Directory
   (tenant) ID is not the UniCAS client ID.
6. Open **Authentication** > **Add a platform** > **Web**, then add both exact
   redirect URIs:

   ```text
   https://console.unicas.work/admin/auth/callback/microsoft
   https://api.unicas.work/oauth/callback/microsoft
   ```

7. Leave implicit grant and hybrid-flow token checkboxes disabled. UniCAS uses
   authorization code flow with PKCE.
8. Open **Certificates & secrets** > **Client secrets** > **New client secret**.
   Choose the shortest operationally practical expiry, assign an owner and
   rotation date, and create it.
9. Immediately copy the secret **Value**. Do not copy the Secret ID. Store the
   client ID as `OAUTH_MICROSOFT_CLIENT_ID` and the value as
   `OAUTH_MICROSOFT_CLIENT_SECRET`.
10. Do not add Mail, Contacts, Files, or other Microsoft Graph permissions.
    UniCAS requests only OIDC `openid email profile`. Microsoft email-like token
    claims are display hints and never satisfy an email-constrained invitation;
    the separate UniCAS email challenge does that.

No tenant admin consent should be required for the intended personal-account
OIDC scopes. If the portal adds `User.Read` by default, UniCAS does not call
Microsoft Graph and does not depend on that permission.

## GitHub OAuth App setup

Official references: [create an OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app),
[web authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps),
and [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

As of the current GitHub OAuth App UI, one App can hold up to ten callback URLs.
Use one production App and one credential pair for both UniCAS surfaces.

1. Decide whether the App is owned by the organization or a team-controlled
   service account. Organization ownership is preferred over a personal owner.
2. Open GitHub **Settings** > **Developer settings** > **OAuth Apps** >
   **New OAuth App** (or the organization's developer settings).
3. Enter:
   - Application name: `UniCAS`;
   - Homepage URL: `https://unicas.work`;
   - Description: a short public description of administrator sign-in;
   - Authorization callback URLs:

     ```text
     https://console.unicas.work/admin/auth/callback/github
     https://api.unicas.work/oauth/callback/github
     ```

4. Keep wildcard callback matching disabled. Exact callbacks are available and
   materially safer.
5. Do not enable Device Flow; UniCAS Console, CLI, and MCP all use the server
   web application flow.
6. Register the application, then select **Generate a new client secret**.
7. Store the client ID as `OAUTH_GITHUB_CLIENT_ID` and the new secret as
   `OAUTH_GITHUB_CLIENT_SECRET`.
8. No repository or organization permissions are needed. Runtime requests only:
   - `read:user` to read the authenticated profile;
   - `user:email` to read provider-verified email addresses.

The provider access token is used only to call `/user` and `/user/emails` during
the callback, then discarded. Do not create a Personal Access Token, GitHub App
private key, webhook secret, or repository token for this login flow.

## Cloudflare Email Sending setup

Official references: [Email Sending onboarding](https://developers.cloudflare.com/email-service/get-started/send-emails/),
[Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/),
and [send binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/).

The current implementation uses Cloudflare Email Service directly through the
Worker `send_email` binding. It does not use Resend, SMTP, or an email API key.

1. In the Cloudflare dashboard, open **Compute** > **Email Service** >
   **Email Sending**.
   If **Email Sending** or **Onboard Domain** is unavailable for the account,
   request product access through Cloudflare support before continuing; a
   Resend account does not enable the existing Worker binding.
2. Select **Onboard Domain** and choose `unicas.work`.
3. Review and apply the Cloudflare-managed DNS records for the `cf-bounce`
   subdomain and the SPF, DKIM, and DMARC records. `unicas.work` must use
   Cloudflare DNS for this service.
4. Wait until Email Sending reports the domain as active. DNS commonly settles
   in minutes but can take up to 24 hours.
5. Confirm that `no-reply@unicas.work` is accepted as a sender and set
   `ADMIN_EMAIL_FROM=no-reply@unicas.work`.
6. Confirm the production Worker configuration contains:

   ```toml
   [[send_email]]
   name = "EMAIL"
   ```

   This binding is already present in `packages/service-cloudflare/wrangler.toml`.
7. In a non-production test deployment, send a Microsoft invitation challenge
   to a test mailbox that has **not** been added as a pre-verified Cloudflare
   destination. Verify delivery, spam placement, sender authentication, and the
   challenge expiry flow.

Cloudflare may enforce destination, daily, or rate limits depending on account
and product status. A successful send to only a pre-verified destination does
not prove that arbitrary invitation recipients work. Treat
`E_RECIPIENT_NOT_ALLOWED`, `E_SENDER_NOT_VERIFIED`,
`E_SENDER_DOMAIN_NOT_AVAILABLE`, or quota errors as provisioning blockers.

For least privilege, a later hardening change may add
`allowed_sender_addresses = ["no-reply@unicas.work"]` to the binding. Do not add
`allowed_destination_addresses`; invitations must reach the user-supplied,
verified challenge address.

### When Resend would be needed

Do not request Resend access for the current code. If Cloudflare Email Sending
cannot deliver to the required recipients or its production limits are
insufficient, first implement and review a Resend-backed `EmailChallengeSender`
adapter, domain verification, `RESEND_API_KEY` secret handling, failure
semantics, and tests. A Resend key alone cannot be consumed by the current
Worker.

## Generate UniCAS encryption keys

Generate two different random 32-byte base64url values on a trusted machine.
For example, run this command twice and do not reuse either output:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

- Put one value into a versioned JSON keyring, for example
  `{"2026-09":"<first-value>"}`, and store the entire JSON value as
  `SESSION_ENCRYPTION_KEYS`.
- Store the second value directly as `OAUTH_STATE_ENCRYPTION_KEY`.

Keep old session-key entries during rotation until browser sessions and pending
platform-invitation replay receipts sealed with them have expired. Never reuse
the OAuth-state key as a session key.

## Store values in GitHub

1. Open the repository on GitHub and select **Settings** > **Environments**.
2. Create or open the case-insensitive environment named `Production`.
3. Add required reviewers and restrict deployments to the release branch as
   appropriate for the repository.
4. Under **Environment variables**, add the four non-secret runtime values from
   the inventory above.
5. Under **Environment secrets**, add the five secret runtime values.

GitHub Environment values are available only to jobs that declare
`environment: Production`. The release deploy job synchronizes the five
secrets through Wrangler standard input and injects the three client IDs with
`--var`; ordinary CI cannot read them.

## Materialize Worker configuration manually

The release workflow performs this synchronization. Use the following commands
only for an explicitly approved emergency rotation or pre-deployment setup:

1. Enter each secret interactively with Wrangler or in the Cloudflare dashboard
   under the `unicas` Worker's variables and secrets. Never place the value in
   a command argument.

   ```powershell
   pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_GOOGLE_CLIENT_SECRET
   pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_MICROSOFT_CLIENT_SECRET
   pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_GITHUB_CLIENT_SECRET
   pnpm --filter @unicas/service-cloudflare exec wrangler secret put SESSION_ENCRYPTION_KEYS
   pnpm --filter @unicas/service-cloudflare exec wrangler secret put OAUTH_STATE_ENCRYPTION_KEY
   ```

   Type or paste exactly one value at each Wrangler prompt. Do not pipe a
   secret from a tracked file.
2. Verify the deployed Worker has these secret names without reading their
   values back:

   ```text
   OAUTH_GOOGLE_CLIENT_SECRET
   OAUTH_MICROSOFT_CLIENT_SECRET
   OAUTH_GITHUB_CLIENT_SECRET
   SESSION_ENCRYPTION_KEYS
   OAUTH_STATE_ENCRYPTION_KEY
   ```

3. Ensure the non-secret names exactly match the runtime inventory. GitHub
   reserves the `GITHUB_*` prefix for Actions; those names are not valid
   Environment variables and are not read by the Worker.
4. Use `wrangler secret list` or the Cloudflare dashboard to verify names only;
   never attempt to print secret values.
5. Run a Wrangler dry-run before any production deployment.

## Acceptance checklist

Do not mark production provider provisioning complete until all items pass:

- [ ] Google Console login succeeds and returns to the exact Console callback.
- [ ] Google MCP authorization succeeds and returns to the exact API callback.
- [ ] Microsoft personal-account Console and MCP login both succeed.
- [ ] A Microsoft email-constrained invitation delivers to a non-preverified
      external mailbox; the code works once and replay fails.
- [ ] GitHub Console and MCP login both succeed with the single OAuth App.
- [ ] GitHub consent shows only profile/email access, not repository access.
- [ ] CLI browser login completes through each configured provider required for
      acceptance.
- [ ] Account linking keeps one stable `accountId`; matching email alone does
      not merge two Accounts.
- [ ] Blocking an Account invalidates sessions and MCP grants for every linked
      provider.
- [ ] No provider token, client secret, email challenge code, or invitation
      token appears in URLs after callback handling, Worker logs, Actions logs,
      task files, or chat.
- [ ] Secret owners and rotation/expiry dates are recorded in the approved
      operational system, not this repository.

If any provider secret is copied outside the provider portal, GitHub
Environment secret form, Cloudflare secret input, or the approved secret
manager, rotate or revoke it immediately.
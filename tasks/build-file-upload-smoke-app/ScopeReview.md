# Scope review

Status: Pending requesting-user approval.

## Decision requested

Approve the updated [task contract](./Task.md) for a small file service with
these product boundaries:

- a separately deployed Cloudflare full-stack App at `spaces.unicas.work`;
- a responsive file workflow using the UniCAS Console visual language;
- provider-neutral identity bindings for Google, Microsoft, and GitHub, with
  Google as the only enabled MVP login provider; and
- a release-blocking smoke path through public UniCAS App/Space interfaces.

Approval permits the architecture, model, interface, and UI proposal in this
task to proceed to implementation. It does not authorize production deployment
or production credential creation.

## Included MVP

1. An admitted Google user signs in, sees their files, uploads one bounded
   file, downloads exact bytes, and deletes the file.
2. The App maps that Principal to a pre-provisioned Space, issues short-lived
   least-privileged capabilities, and maintains its own file-root catalog.
3. The App Worker uses only published UniCAS clients and public HTTPS routes;
   it has no UniCAS D1, R2, Durable Object, administrator-session, or service
   implementation access.
4. A dedicated non-interactive smoke Principal runs a multi-node upload twice,
   verifies ready-node reuse, commits and reads a positive Root Ref, proves one
   denied authority and one denied Space request, and cleans up idempotently.
5. A scheduled bounded sweeper releases stale smoke roots left by interruption.
6. The protected release path deploys UniCAS, deploys the Spaces App, runs its
   smoke, and only then promotes the product and documentation sites.

## Explicitly deferred

- Microsoft and GitHub login implementation, provider credentials, and account
  linking UI. The data model may accept those provider identifiers, but the MVP
  exposes no enabled login path for them.
- Self-service signup, runtime Space provisioning, sharing, folders, previews,
  collaboration, synchronization, version history, and general drive features.
- Direct browser possession of UniCAS capabilities or presigned upload URLs.
- Production deployment, DNS mutation, App/Space bootstrap, and secret creation
  before reviewed implementation and an explicit deployment decision.

## Governing constraints

- `spaces.unicas.work` is an App boundary, not a new UniCAS service route.
- Unknown Google identities fail closed; App runtime never uses administrator
  credentials to create or discover their Spaces.
- Google authenticates a user to the App. The App's own external issuer signs
  the Space capability that UniCAS verifies.
- No credential, capability, private key, presigned URL, object key, or uploaded
  content may enter source control, browser storage, logs, or CI artifacts.
- The final permission vocabulary follows
  [Split App Space operation permissions](../split-app-space-operation-permissions/Task.md)
  if that task lands first; otherwise tests use the current public vocabulary
  without inventing future wire strings.

## Review question

Approve this scope, including Google-only MVP login, the Worker-mediated file
path, pre-provisioned Principal-to-Space mappings, and release-blocking smoke?

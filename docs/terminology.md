# UniCAS terminology

Status: accepted terminology

## Core resources

| Term | Definition |
| --- | --- |
| **App** | The top-level application, trust, administration, issuer, audit, and storage namespace |
| **Space** | An App-scoped logical boundary for data ownership, isolation, authorization, and usage accounting |
| **Account** | The stable opaque UniCAS administrator subject that owns access, memberships, profile, sessions, and resource relationships |
| **External Identity** | One immutable provider `(issuer, subject)` login bound to an Account; exact identity remains privileged audit evidence |
| **Principal** | Deprecated administrator compatibility projection keyed by `(issuer, subject)`; new contracts use Account |
| **Profile** | Mutable, non-authoritative Account display metadata such as display name and avatar |
| **Member** | An Account granted equal administrator authority over an App |
| **Platform Access** | Administrator-plane admission for an Account; active authority or App membership grants admission, while `blockedAt` denies every linked identity |
| **Platform Admin** | An Account with the independent `platform.admin` authority, permitted to manage Platform Access and platform invitations |
| **App Creator** | An Account with the independent `apps.create` authority, permitted to create Apps |

App replaces the earlier public term Stack. Space replaces the earlier public
term Tenant in the new API contract.

## Space semantics

A Space does not imply a user, organization, billing account, physical shard,
deployment region, storage device, or free capacity. Mapping a Space to one
user, many users, a service, or a shared business object belongs to the
integrating App.

Valid mappings include:

```text
one Account -> one personal Space
one Account -> multiple Spaces
multiple Accounts -> one shared Space
service Principal -> one automation Space
```

Use **Space** as a capitalized UniCAS resource name. For storage measurements,
use `capacity`, `stored bytes`, `reserved bytes`, or `remaining quota`; do not
use “space” to mean free disk capacity in product text.

## Identity boundary

Account answers “which stable administrator owns access.” External Identity
answers “which provider credential authenticated this request.” Space answers
“which isolated data unit may be accessed.” They are deliberately independent.

Only `(issuer, subject)` identifies an External Identity, and it binds to one
opaque `accountId`. Email never links Accounts or moves authority. Profile and
primary-contact fields may change and never alter App membership, Space
ownership, authorization, or historical audit attribution.

Platform authorities are independent. `platform.admin` does not imply
`apps.create`, and App membership implies neither. An email may constrain an
invitation or an out-of-band bootstrap procedure, but it is never the durable
authorization key.

Capability authorization preserves these invariants:

1. An issuer resolves to exactly one App authority.
2. The issuer-derived App matches the requested App.
3. The capability Space matches the requested Space.
4. The permission authorizes the exact Space and operation.

App identity is therefore issuer-derived rather than trusted from an arbitrary
caller claim.

## Resource hierarchy

```text
App
├── App administrators (Account memberships)
├── OAuth issuer configuration
├── control audit
└── Spaces
    ├── immutable CAS nodes
    ├── leases and upload reservations
    ├── Root Ref balances and events
    ├── usage accounting
    └── garbage collection

Platform administration
├── Account access state and authorities
├── linked External Identities
├── verified-email platform invitations
└── platform authorization audit
```

Every data-plane operation is scoped by both App and Space. Root Ref revision
ordering remains App/refDomain-scoped while each event and balance retains the
Space dimension.

## Naming guidance

Use these forms in new public contracts:

```text
appId
spaceId
AppMembership
AppOAuthIssuer
AppAuditEvent
SpaceUsage
Account { accountId, blockedAt, credentialVersion }
ExternalIdentity { provider, issuer, subject }
Profile { displayName, avatarUrl }
```

Do not use Identity, User, or Profile as a synonym for Space. Do not use
Partition, Namespace, Scope, Realm, Domain, Zone, Bucket, Container, or Vault
as the public resource name.

The legacy `unicas.shazhou.work` environment retains its Stack/Tenant v1
terminology and wire behavior. New terminology does not reinterpret legacy
records or tokens.
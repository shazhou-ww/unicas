# UniCAS terminology

Status: accepted terminology

## Core resources

| Term | Definition |
| --- | --- |
| **App** | The top-level application, trust, administration, issuer, audit, and storage namespace |
| **Space** | An App-scoped logical boundary for data ownership, isolation, authorization, and usage accounting |
| **Principal** | An authenticated human or service identity, keyed by `(issuer, subject)` |
| **Profile** | Non-authoritative display metadata such as display name and email |
| **Member** | A Principal granted equal administrator authority over an App |

App replaces the earlier public term Stack. Space replaces the earlier public
term Tenant in the new API contract.

## Space semantics

A Space does not imply a user, organization, billing account, physical shard,
deployment region, storage device, or free capacity. Mapping a Space to one
user, many users, a service, or a shared business object belongs to the
integrating App.

Valid mappings include:

```text
one Principal -> one personal Space
one Principal -> multiple Spaces
multiple Principals -> one shared Space
service Principal -> one automation Space
```

Use **Space** as a capitalized UniCAS resource name. For storage measurements,
use `capacity`, `stored bytes`, `reserved bytes`, or `remaining quota`; do not
use “space” to mean free disk capacity in product text.

## Identity boundary

Principal answers “who was authenticated.” Space answers “which isolated data
unit may be accessed.” They are deliberately independent.

Only `(issuer, subject)` is authoritative Principal identity. Profile fields
may change and never alter App membership, Space ownership, authorization, or
audit identity.

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
├── App administrators (Principal memberships)
├── OAuth issuer configuration
├── control audit
└── Spaces
    ├── immutable CAS nodes
    ├── leases and upload reservations
    ├── Root Ref balances and events
    ├── usage accounting
    └── garbage collection
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
Principal { issuer, subject }
Profile { displayName, emailForDisplay }
```

Do not use Identity, User, or Profile as a synonym for Space. Do not use
Partition, Namespace, Scope, Realm, Domain, Zone, Bucket, Container, or Vault
as the public resource name.

The legacy `unicas.shazhou.work` environment retains its Stack/Tenant v1
terminology and wire behavior. New terminology does not reinterpret legacy
records or tokens.
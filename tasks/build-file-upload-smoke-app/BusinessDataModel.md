# Business and data model review

Status: Pending requesting-user approval.

## Decision requested

Approve these target business rules:

- Google, Microsoft, and GitHub identities bind to an App-owned Principal;
  Google is the only enabled MVP provider.
- A Principal maps to an explicitly provisioned Space. Provider identity,
  email, and Console membership never derive Space identity or authority.
- The App owns a hierarchical file-system Root, path names, catalog state,
  smoke-run cleanup, and capability issuance; UniCAS owns opaque canonical
  nodes and Root Ref retention.

Approval permits the App-owned D1 persistence and Root Ref lifecycle described
below after the other protected reviews are approved.

## Material changes

| Current | Proposed | Why |
| --- | --- | --- |
| No maintained file App or App-owned catalog exists. | Spaces D1 stores admitted Principals, provider bindings, Space mappings, one file-system Root per Principal, sessions, and smoke cleanup records. Paths and directories live in the Root's immutable manifest. | Business identity and file discovery belong to the App, while the public file client owns canonical manifest encoding. |
| Live smoke configuration supplies a capability externally. | The App authenticates a dedicated smoke Principal and issues the same bounded capability class used by its backend workflow. | Exercise real issuer and mapping boundaries without an admin session. |
| Provider support is unspecified. | External identity keys are `(provider, provider_subject)`; Google is enabled first and Microsoft/GitHub remain unavailable. | Add providers later without changing Principal or Space identity. |

## Target model

```mermaid
erDiagram
  PRINCIPAL {
    string principal_id PK
    string status
    string display_name
  }

  EXTERNAL_IDENTITY["EXTERNAL_IDENTITY &lt;&lt;EI&gt;&gt;"] {
    string provider PK
    string provider_subject PK
    string principal_id FK
  }

  SESSION["SESSION &lt;&lt;EI&gt;&gt;"] {
    string session_id_hash PK
    string principal_id FK
    datetime expires_at
  }

  PRINCIPAL_SPACE {
    string principal_id PK, FK
    string app_id
    string space_id UK
    string ref_domain UK
  }

  FILE_SYSTEM_ROOT {
    string root_id PK
    string principal_id FK
    string manifest_hash
    int revision
  }

  PATH_ENTRY {
    string root_id PK, FK
    string absolute_path PK
    string entry_type
    string blob_hash
  }

  SMOKE_RUN["SMOKE_RUN &lt;&lt;EI&gt;&gt;"] {
    string run_id PK
    string principal_id FK
    datetime expires_at
    string cleanup_state
  }

  SMOKE_RESOURCE["SMOKE_RESOURCE &lt;&lt;EI&gt;&gt;"] {
    string run_id PK, FK
    string root_id FK
    string absolute_path PK
  }

  SPACE {
    string app_id PK
    string space_id PK
  }

  ROOT_REF {
    string app_id PK
    string space_id PK
    string ref_domain PK
    string root_id PK
    string manifest_hash
    int positive_count
  }

  PRINCIPAL ||--o{ EXTERNAL_IDENTITY : authenticates_as
  PRINCIPAL ||--o{ SESSION : holds
  PRINCIPAL ||--|| PRINCIPAL_SPACE : is_assigned
  PRINCIPAL_SPACE }o--|| SPACE : selects
  PRINCIPAL ||--|| FILE_SYSTEM_ROOT : owns
  FILE_SYSTEM_ROOT ||--o{ PATH_ENTRY : snapshots
  FILE_SYSTEM_ROOT ||--|| ROOT_REF : retains_with
  PRINCIPAL ||--o{ SMOKE_RUN : executes
  SMOKE_RUN ||--o{ SMOKE_RESOURCE : tracks
  SMOKE_RESOURCE }o--|| FILE_SYSTEM_ROOT : cleans_from
  SPACE ||--o{ ROOT_REF : contains
```

`SPACE` and `ROOT_REF` are UniCAS-owned business entities shown to explain the
boundary. `PATH_ENTRY` is a logical projection of the current immutable file
manifest and is not a D1 table: explicit directories and files are encoded by
the published file client, while file entries reference immutable blob hashes.
Canonical nodes, leases, edges, and content remain entirely inside UniCAS and
are intentionally absent from App D1. Capabilities and presigned URLs are
request-scoped values and are not durable entities.

## Lifecycle semantics

| Entity | What can change | How validity ends | Deletion |
| --- | --- | --- | --- |
| `EXTERNAL_IDENTITY <<EI>>` | Provider and subject never change; linking creates a new binding. Display claims may refresh on Principal. | Principal suspension or an explicit future unlink policy. | No self-service unlink in MVP. |
| `SESSION <<EI>>` | Identity and expiry are fixed after issue. | Logout, expiry, Principal suspension, or server revocation. | Expired/revoked rows are pruned. |
| `PRINCIPAL_SPACE` | Bootstrap or an explicit operator migration may replace the mapping; login cannot. | Principal suspension or mapping removal. | Operator-controlled; Root Refs must first be reconciled. |
| `FILE_SYSTEM_ROOT` | Root identity is stable; manifest hash and optimistic revision advance atomically after each committed path mutation. | Principal deprovisioning or complete smoke cleanup. | Operator or smoke lifecycle only, after Root Ref release. |
| `PATH_ENTRY` | A directory create, file write, file rename, or remove operation produces a replacement immutable manifest. File blob hashes remain stable when only names change. | Removal in a committed replacement manifest. | User file mutation or bounded smoke cleanup; root `/` is immutable. |
| `SMOKE_RUN <<EI>>` | Run identity, Principal, and expiry are fixed; cleanup state advances idempotently. | All tracked roots are released, or an actionable cleanup failure remains. | Pruned after bounded evidence retention. |
| `SMOKE_RESOURCE <<EI>>` | Binding is fixed after insertion. | Parent run cleanup releases the referenced root. | Removed after confirmed cleanup. |
| `ROOT_REF` | Positive count changes only through UniCAS atomic Root Ref updates. | Positive count reaches zero. | UniCAS retention and GC semantics apply. |

## Governing invariants

1. `(provider, provider_subject)` identifies at most one Principal; email is not
   a key and cannot authorize account linking.
2. MVP admission is pre-provisioned. Login cannot create a Principal, Space, or
   Principal-to-Space mapping and cannot call the UniCAS admin plane.
3. A Principal's file catalog resolves only through its assigned App, Space,
   and Root Ref domain. Cross-Space identifiers are rejected before data access.
4. Each Principal owns exactly one file-system Root. Within a manifest, each
  normalized absolute path is unique, its parent must be a directory, and a
  path cannot be moved into itself or its descendant. The root `/` cannot be
  renamed or deleted.
5. A successful Root catalog revision references one positively retained
  manifest Root Ref. Folder creation, upload, rename, and removal become
  visible together only after commit; optimistic conflicts cannot overwrite a
  concurrent revision.
6. Renaming a file or folder changes manifest paths and reuses every unchanged
  file blob hash; it does not upload identical content again.
7. Deletion and smoke cleanup are idempotent and converge through retry; stale
   smoke records carry an expiry so scheduled cleanup is bounded and discoverable.
8. Signing keys, Google credentials, smoke credentials, capabilities, signed
   upload URLs, and uploaded bytes are never stored in App D1.

## Migration impact

This is a new App-owned database with no customer or Playground migration. The
initial schema is additive. Bootstrap inserts only dedicated non-customer App,
Space, Principal, identity-binding, and mapping identifiers after those
resources are explicitly created through supported control-plane operations.
Microsoft and GitHub enablement adds identity bindings and provider secrets; it
does not rewrite existing Principal, Space, file, or Root Ref identity.

## Review question

Approve this provider-neutral Principal model, one Principal-to-Space mapping
and file-system Root, immutable hierarchical manifest, and idempotent retention
lifecycle?

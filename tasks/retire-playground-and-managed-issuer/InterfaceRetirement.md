# Interface retirement review

Status: Proposed

## Decision requested

Approve removal of all managed issuer and residual Playground interfaces, with
standard external OAuth issuer and App/Space administration remaining as the
only supported management experience.

The visual comparison in [UiReview.html](./UiReview.html) is illustrative. This
document and the task contract are normative.

## Interface disposition

| Surface | Current | Target |
| --- | --- | --- |
| Console App overview | Managed issuer card plus custom OAuth authorization-server card. | One OAuth authorization-server card for the standard external issuer. |
| Admin HTTP | `GET/PATCH /admin/apps/{appId}/managed-issuer` and `POST /admin/apps/{appId}/managed-capabilities`. | Routes absent; requests receive the normal unmatched-route `404`. |
| Admin client | `getAppManagedIssuer`, `patchAppManagedIssuer`, `mintManagedSpaceCapability`. | Methods and managed capability type absent. |
| Stdio/remote MCP | `get_app_managed_issuer`, `update_app_managed_issuer`, `mint_managed_space_capability`. | Tools absent from discovery and dispatch. |
| Public OAuth | `/managed-issuers/{appId}/.well-known/oauth-authorization-server` and `/managed-issuers/{appId}/jwks.json`. | Present only in Revision A for token drain; absent in final Revision B and returns `404`. |
| Protected-resource metadata | External issuer first, managed issuer fallback. | Active external issuer only; `404 OAUTH_ISSUER_NOT_ACTIVE` when none is active. |
| OpenAPI | Managed Issuer operations/type plus stale Playground description/tag. | External OAuth issuer operations only; no Playground or Managed Issuer tag/text. |
| Playground legacy checks | Skipped UI suite, CSS selectors, explicit retired-route/tool/table assertions. | Removed unless a generic compatibility assertion protects a still-supported boundary. |

## External issuer behavior retained

- `GET /admin/apps/{appId}/oauth-issuer`
- `POST /admin/apps/{appId}/oauth-issuer/inspections`
- `PUT /admin/apps/{appId}/oauth-issuer`
- RFC 8414/OpenID discovery, signed activation proof, ETag preconditions, unique
  issuer ownership, hardened JWKS fetching, App suspension handling, and
  capability verification
- Console loading, inspection error, proof entry, activation, replacement, and
  configured/unconfigured states

The remaining issuer response drops the obsolete `mode` field rather than
returning a constant `"external"` discriminator. This is an intentional
compile-time client break aligned with removal of managed mode; the URL,
audience, metadata, JWKS, status, lifetime, and revision fields are unchanged.

## Console states

- **Configured:** the single card shows status, metadata type, revision, issuer,
  JWKS URL, resource audience, and maximum capability lifetime.
- **Unconfigured:** the same card offers issuer inspection and activation.
- **Loading:** existing controls remain unavailable until the external issuer
  request resolves.
- **Error:** the existing inline error treatment applies to external issuer
  load, inspection, and activation failures.

There is no replacement prompt, migration wizard, managed issuer disabled state,
or personal Space affordance. Production drain is an operator workflow, not an
App administrator workflow.

## Playground cleanup boundary

Current product code and current documentation must contain no Playground label,
style, route, OpenAPI tag, test fixture, deployment reset expectation, or
management workflow. Historical task artifacts remain unchanged because they
record prior decisions rather than advertise an active product surface.

No file storage interface is added in this task.

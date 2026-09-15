# Physical cutover inventory

Captured: 2026-09-15

This record contains aggregate evidence only. It intentionally omits resource
IDs, Principal/Profile data, issuer URLs, session contents, object keys, and
database rows. No reset, delete, deploy, or restore operation was executed.

## Backups

Both remote D1 databases were exported to the gitignored directory
`.wrangler/cas-deploy/backups/2026-09-15-app-space-gate/` and verified non-empty:

| Export | Bytes | SHA-256 |
| --- | ---: | --- |
| `unicas-control.sql` | 13,865 | `b415efd7f9c9019ff164b07c6151ee97ce35e2059b5a471726fcd9f3e9b46d74` |
| `unicas-tenant.sql` | 3,780 | `745017ba9d5bc014b756de0fd7367d33d2ac9119d22579f358a3d2651998ca2e` |

The exports are local working backups, not the final off-machine retention
copy required immediately before production execution.

## Control D1

Aggregate read-only inventory:

| Metric | Count |
| --- | ---: |
| Apps | 1 |
| Apps named `Production Smoke` | 1 |
| Non-smoke Apps | 0 |
| Operator identities | 1 |
| Memberships | 1 |
| Invitations | 0 |
| Playground roots | 0 |
| External issuers | 0 |
| Managed issuers | 1 |
| Issuer inspections / keys | 0 / 0 |
| Control audit events | 6 |
| Idempotency rows | 0 |
| Admin session rows | 15 |

The identity, membership, audit, and session rows are administrative state for
the sole smoke App. A clean rebuild will intentionally invalidate those
sessions and recreate the smoke membership; they are not application data.

## Data D1

Aggregate read-only inventory:

| Metric | Count |
| --- | ---: |
| Nodes / edges | 2 / 1 |
| Root Ref requests / events | 4 / 4 |
| Root Ref balances / revision rows | 0 / 1 |
| Upload reservations / direct sessions | 0 / 0 |

Every non-empty data table has exactly one physical App scope and one Space
scope. All rows are in the dedicated `deploy-smoke` Space; every
outside-smoke aggregate count is zero.

## R2, KV, and Durable Objects

- Production R2 contains 2 objects totaling 237 bytes.
- The two unique canonical keys derived from D1 were each fetched through R2
  with content discarded. The bucket object count is also 2, proving the exact
  object set with no additional keys.
- Preview R2 contains 0 objects.
- OAuth KV contains 0 keys.
- `CasDurableObject` and `RootRefDomainDurableObject` do not access Durable
  Object storage. Their durable state is exclusively the inventoried D1/R2;
  instance state is transient queues, promises, and caches.

## Guard validation

The non-executing reset inventory validator passed after two guard fixes:

- canonical physical IDs permit the generated base64url `-` and `_` suffix;
- managed issuer validation targets the completed `api.unicas.work` split
  origin while retaining the physical `/stacks/{id}` audience check.

The local admin CLI session had expired, so the fresh control count was read
directly through authenticated, read-only D1 queries. Wrangler authentication
remained valid.

## Decision

The new environment remains smoke-only. The approved source strategy is a clean
App/Space physical rebuild rather than permanent online migration adapters.

Destructive execution is not authorized by this inventory alone. Immediately
before reset/deploy, repeat the aggregate checks, make fresh verified off-machine
backups, review the rendered reset plan, and obtain explicit approval for the
production deletion window. If any count or consumer changes, stop and retain
the compatibility adapters pending a new online migration plan.
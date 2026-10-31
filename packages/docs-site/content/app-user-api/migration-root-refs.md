# Root Ref scope breaking change

This is a release candidate, not evidence of a production cutover or npm
publication. The frozen `unicas.shazhou.work` environment is excluded.

## Contract changes

- Root Ref read/update requires the issuer-derived App, a matching Space
  selector and the exact operation permission. There is no domain or default
  namespace. New issuers and capability metadata omit the legacy `refDomain`.
  Extra v2 claims are temporarily ignored, including malformed legacy values;
  they cannot affect authorization, forwarding, audit or idempotency.
- Balances are keyed by `(appId, spaceId, hash)` and match authoritative
  aggregate counts. App-global revisions order new events across Spaces.
- Replay identity is `(appId, spaceId, requestId)`: canonical payload replay
  returns its original revision; another payload conflicts; another Space
  may safely reuse the ID.
- Admin routes are `GET /admin/apps/{appId}/root-refs` and
  `GET /admin/apps/{appId}/root-ref-events`. Optional `spaceId` filters either.
  Domain discovery and domain paths are removed, without compatibility aliases.
  CLI commands are `app-audit root-refs` and `app-audit root-events`; MCP tools
  are `list_app_root_refs` and `list_app_root_events`. Admin clients use
  `listAppRootRefs` and `listAppRootEvents`.
- Current-balance cursors bind App, Space filter and revision. Old hash-only
  cursors are invalid; restart pagination. A changed snapshot returns
  `ROOT_REF_SNAPSHOT_CHANGED`. Event pages stop at their reported watermark.

## Offline rehearsal

Stop all old and new writers before obtaining a consistent SQLite snapshot.
Keep the snapshot in an access-controlled, gitignored directory inside the
project; it is the read-only archive and rollback source. Never commit a
customer snapshot, generated data file, key or token.

```powershell
node release\service\migrate-root-refs.mjs --input .wrangler\cutover\source.sqlite --dry-run
node release\service\migrate-root-refs.mjs --input .wrangler\cutover\source.sqlite --output .wrangler\cutover\candidate.sqlite
pnpm exec vitest run tests\root-refs-cutover.test.mjs
```

The tool only reads the input. It creates a new local copy, reconciles each
node's aggregate against the sum of old projections, checks orphan rows,
canonical payload hashes, complete streams, event/request correspondence and
request collisions. Any duplicate App+Space request ID across old domains
blocks cutover, even for identical payloads: it could represent two applied
deltas. The tool never picks a winner, changes aggregate or merges history.
Investigate collisions and agree a separately reviewed disposition before
retrying; no implicit retention expiry or replay waiver exists.

The local candidate records a source digest and per-App checkpoint, bridges
unique old requests to their original payload hash/revision, and makes all
legacy ledger tables read-only with write-rejecting triggers. It creates no
new events for old operations. The checkpoint is the maximum old revision,
not a fabricated global order; new events start at checkpoint + 1.

`0002_app_root_refs.sql` creates the new schema only. It is not a data
migration and cannot authorize starting a writer over populated old state.
The service refuses that state without the offline cutover marker.
Production D1 import/export, restore limits, fencing, backups and the exact
target are deployment prerequisites; a local SQLite copy is not a D1
production migration procedure. Rehearse the target-specific transfer and
verify every aggregate before and after it under the same fence.

The Spaces App additionally applies `0003_remove_ref_domain.sql` before using
the updated bootstrap/preflight scripts. Its App/Space mapping is unchanged.

## Rollback and retirement

Before any new write, restore the complete original snapshot and old service
under the write fence. After the first new write, old writers are unsafe:
their projections/history are frozen. Use forward repair, or a separately
reviewed reverse migration under a fence; do not restore an old snapshot and
discard accepted new writes.

Before production, assign the environment, authorizer, archive owner,
retention periods for archive and replay records, compatibility deadline,
observation window and rollback owner. Do not shorten existing replay
guarantees. Retirement requires evidence that every issuer stopped the old
claim, consumers stopped old endpoints/cursors, and archive recovery was
rehearsed. No production mutation, npm release or external configuration
change is authorized by this document.

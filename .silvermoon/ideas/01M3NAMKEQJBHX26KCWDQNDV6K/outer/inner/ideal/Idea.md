# Adopt a shared Admin WebUI query cache

## Intent

Make previously loaded App and managed-issuer data render immediately while
the UniCAS Console revalidates it in the background through one shared,
session-scoped TanStack Query layer.

## Context

The Admin WebUI currently lets the shell and individual views call the browser
transport directly and independently model loading, refresh, race, and error
state. Revisiting an App can therefore replace usable data with blocking
loading UI, and overlapping consumers can duplicate requests.

This idea was migrated from the unfinished Repoledger task
`adopt-admin-webui-query-cache`. Git history retains the original task
artifact; no previous approval is transferred to this new ideal revision.

## Desired outcome

The Console presents cached server state immediately when it is safe to do so,
revalidates in the background, deduplicates identical reads, invalidates
precisely after mutations, and preserves accessible first-load and refresh
failure behavior without changing the Admin HTTP transport contract.

## Scope

### In scope

- Add one Console-scoped TanStack Query client and provider.
- Define typed, identity-complete keys and helpers for App list, selected App,
  and managed-issuer reads.
- Migrate the Console shell and managed-issuer consumers.
- Define first-load, background-refresh, replacement, stale-plus-error, and
  mutation-conflict behavior.
- Replace migrated `reloadKey` and callback refresh paths with targeted cache
  updates or invalidation.
- Add focused tests and implementation-local conventions.

### Out of scope

- Changing Admin protocol, BFF, or `@unicas/admin-client` transport contracts.
- Persisting administrator data beyond the browser session.
- Caching mutations, credentials, one-time responses, People search, audit
  logs, Account management, or tenant data-plane content.
- Redesigning navigation, identity, authorization, or issuer workflows.

## Constraints

- Keep the query layer inside `@unicas/admin-webui` and preserve package
  dependency direction.
- Treat cached data as presentation state, never authorization evidence.
- Use bounded in-memory stale and garbage-collection lifetimes and clear the
  cache across logout or session-expiry boundaries.
- Cache only explicitly declared idempotent reads and preserve existing
  concurrency, accessibility, abort, and error semantics.
- Keep administrator and tenant data planes separate and leave the frozen
  `unicas.shazhou.work` environment unchanged.

## Open questions

- Approve the migrated ideal, architecture, and interface-state contract before
  adding the dependency or changing the affected Console states.
- Select the exact stale and garbage-collection lifetimes during implementation
  review.

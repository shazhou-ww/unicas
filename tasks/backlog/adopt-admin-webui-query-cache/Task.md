# Adopt an Admin WebUI query cache

Created: 2026-09-17

## Goal

Make previously loaded App navigation and issuer data render immediately while
the UniCAS Console revalidates it in the background, using one shared TanStack
Query layer with deterministic request deduplication and mutation invalidation.

## Context

The Admin WebUI currently calls its browser `api()` transport directly from the
shell and individual views. Each caller separately models loading, errors,
request races, and refreshes through local state, `reloadKey`, `version`, or
callbacks. Revisiting an App can therefore show a blocking loading state even
when usable data was already fetched, and the shell, issuer settings, and
Playground can request overlapping App or managed-issuer resources.

The desired interaction is stale-while-revalidate: publish usable cached data
immediately, fetch current data in the background, then update in place. A
shared query layer should own that lifecycle rather than changing the HTTP
transport contract or making every component coordinate two promises itself.

## Scope

- Add TanStack Query as the Admin WebUI's shared in-memory server-state query
  layer and install one Console-scoped query client/provider.
- Define stable query keys and typed query helpers for the App list, selected
  App detail, and managed issuer resources, including all identity, App, and
  request parameters that affect a response.
- Migrate the Console shell and managed-issuer consumers to the shared queries
  so duplicate in-flight reads are coalesced and revisiting already loaded data
  does not replace it with a blocking loading state.
- Give initial loading, background refresh, fresh-data replacement, and stale
  data plus refresh-error states explicit and accessible interface behavior.
- Replace `reloadKey` and overlapping callback-driven refetches for the migrated
  resources with targeted query updates or invalidation after successful
  mutations.
- Preserve revision-based optimistic concurrency and refresh affected queries
  after conflict or ambiguous mutation outcomes.
- Add focused tests for cache-first rendering, background revalidation, request
  deduplication, query isolation, invalidation, and retained stale data when a
  refresh fails.
- Document the query-key, cache-lifetime, invalidation, and future-migration
  conventions close to the Admin WebUI implementation.

## Out of scope

- Changing `@unicas/admin-client`, administrator protocol endpoints, BFF
  response contracts, or the existing `Request -> Promise<Response>` transport
  model.
- Persisting administrator query data in local storage, IndexedDB, a service
  worker, or any cache that survives the browser page/session lifecycle.
- Caching mutations, authentication callbacks, invitation receipts, secrets,
  Space capabilities, or other one-time or security-sensitive responses.
- Migrating People search and pagination, audit logs, Account management, or
  tenant Playground file data in this first adoption slice.
- Replacing the tenant Browser CAS node cache used by Playground data access.
- Redesigning Console navigation, issuer controls, or administrator identity
  and authorization behavior.

## Acceptance criteria

- [ ] Returning to a previously loaded App renders its cached App and managed
      issuer state immediately while a background request obtains the current
      server state.
- [ ] A first visit with no cached value retains the existing clear loading and
      error behavior, while a failed background refresh keeps usable stale data
      visible and exposes a non-blocking error state.
- [ ] Concurrent consumers of an identical migrated resource share one
      in-flight request, and query keys prevent data reuse across different Apps
      or materially different request parameters.
- [ ] Successful App or managed-issuer mutations update or invalidate every
      affected migrated query without broad numeric reload keys or duplicate
      component-owned refresh calls.
- [ ] Revision conflicts and ambiguous mutation failures cannot leave a
      successfully cached resource presented as confirmed current data; the
      relevant query is revalidated and the user receives the existing error
      feedback.
- [ ] Administrator query data remains memory-only and is discarded on logout,
      session expiry navigation, or page teardown; no sensitive or one-time
      response is added to the query cache.
- [ ] `api()` remains the sole browser HTTP/CSRF/session-error transport and the
      Admin WebUI introduces no runtime dependency on `@unidocs/*` or tenant
      data-plane internals.
- [ ] Focused Admin WebUI tests cover the two-stage lifecycle, deduplication,
      invalidation, App isolation, refresh failure, and logout/session cleanup,
      and the package typecheck and tests pass.

## Constraints

- Keep the query layer inside `@unicas/admin-webui`; preserve the package
  dependency direction and the thin `@unicas/admin-client` transport boundary.
- Treat cached administrator data as stale presentation only. Authorization
  continues to be enforced by the BFF and service, and stale UI state must not
  be treated as permission evidence.
- Use a session-scoped in-memory cache with bounded stale and garbage-collection
  lifetimes. Do not enable persistence or reuse cache entries across signed-in
  identities.
- Cache only explicitly declared idempotent reads. Mutation results may update
  known query data, but mutations themselves remain direct network operations.
- Preserve current abort/race safety, pagination semantics, accessibility, and
  user-visible error reporting for every migrated surface.
- Coordinate shell edits with the ongoing Console navigation task and the
  ongoing multi-provider administrator identity task; do not absorb their
  navigation, Account UI, authentication, or authorization scope.
- Keep administrator and tenant data-access planes separate, and leave the
  frozen `unicas.shazhou.work` environment unchanged.

## Human review checkpoints

Task creation records this plan, not approval. Each required artifact must be
published with a pending decision and explicitly approved before the protected
work begins.

| Checkpoint | Applicability | Reviewer | Planned review artifact | Approval required before |
| --- | --- | --- | --- | --- |
| Scope | Required | User or accountable product owner | This task's goal, first-slice resources, exclusions, constraints, acceptance criteria, and coordination boundaries. | Substantive implementation. |
| Architecture | Required | User or delegated architecture owner | Task-owned concise design covering the TanStack Query dependency, provider ownership, typed query-key factory, cache lifetime, deduplication, invalidation, transport boundary, and session cleanup. | Adding the dependency or shared query infrastructure and migrating shell ownership. |
| Interface | Required | User or delegated Console product owner | Task-owned state matrix or concise before/after review for first load, cached background refresh, successful replacement, refresh failure, and mutation/conflict feedback on affected screens. | Implementing changed loading, refreshing, stale, or error presentation. |
| Business and data model | Not applicable: the task adds a transient client-side query cache and does not change business rules, persistent entities, wire schemas, relationships, or migrations. | Not applicable | Not applicable | Not applicable |
| Delivery acceptance | Required | User or accountable product owner | Integrated revision, focused automated validation, and manual Console results demonstrating immediate cached rendering and correct revalidation, invalidation, and error behavior. | Marking the task completed and archiving it. |

## References

- [Admin WebUI transport](/packages/admin-webui/src/ui/api.ts)
- [Console shell data loading](/packages/admin-webui/src/ui/app.tsx)
- [Issuer settings data loading](/packages/admin-webui/src/ui/views/issuer.tsx)
- Playground cache boundary retired with the pre-launch Playground UI removal.
- [Admin package boundaries](/.github/instructions/packages.instructions.md)
- [Related Console navigation task](/tasks/archived/simplify-console-administration-navigation/Task.md)
- [Related administrator identity task](/tasks/ongoing/scottwei-office-pc/support-multi-provider-admin-identity/Task.md)
- [TanStack Query](https://tanstack.com/query)

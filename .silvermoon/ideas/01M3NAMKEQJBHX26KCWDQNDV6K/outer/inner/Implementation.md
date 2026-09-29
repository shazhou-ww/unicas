# Implementation

## Steps

### I-S01: Review cache architecture and interface states

Define provider ownership, key construction, cache lifetimes, invalidation,
session cleanup, and the accessible state matrix before changing shared UI
infrastructure.

### I-S02: Add the shared query foundation

Add TanStack Query to `@unicas/admin-webui`, install one Console-scoped query
client/provider, and implement typed keys and query helpers for the included
resources.

### I-S03: Migrate included reads

Move the Console shell and managed-issuer consumers to shared queries while
preserving the browser `api()` transport and explicit first-load behavior.

### I-S04: Reconcile mutations and session boundaries

Replace migrated numeric reload triggers with precise updates or invalidation,
revalidate conflicts and ambiguous failures, and clear cached administrator
state on logout or session expiry.

### I-S05: Add proof and conventions

Add focused lifecycle, deduplication, isolation, invalidation, error, and
cleanup tests; document key and cache conventions beside the implementation.

## Acceptance criteria

### I-AC01: Cached revisits revalidate without blocking

Returning to loaded App or issuer data renders the cached value immediately and
starts a background request. Prove it with focused component/query tests.

### I-AC02: Loading and refresh failures remain explicit

First visits retain clear loading and blocking error states; failed background
refreshes keep usable stale data and expose an accessible non-blocking error.
Prove both paths with UI tests.

### I-AC03: Reads deduplicate without crossing identity boundaries

Identical concurrent reads share one request while keys isolate Apps and every
material request parameter. Prove request counts and key separation in tests.

### I-AC04: Mutations cannot leave confirmed-stale presentation

Successful writes update or invalidate every affected query, and conflicts or
ambiguous failures revalidate before stale data is presented as current. Prove
the relevant mutation paths in tests.

### I-AC05: Cache ownership remains bounded

Administrator data stays memory-only, clears at session boundaries, preserves
the `api()` transport, and adds no forbidden package dependency. Prove this
with package tests, typecheck, and workspace-boundary validation.

/**
 * Canonical stack-scoped CAS tenant route matcher.
 *
 * Matches only `/stacks/{stackId}/tenants/{tenantId}/...` service routes and
 * never `/admin`. Every `CasRoute` variant carries `stackId + tenantId`.
 * Proxy exposure policy is not a property of this matcher. Each ingress owns
 * its own route allowlist.
 */

export type CasRoute =
  | { operation: "readContent"; stackId: string; tenantId: string; hash: string }
  | { operation: "readMetadata"; stackId: string; tenantId: string; hash: string }
  | { operation: "lease"; stackId: string; tenantId: string; hash: string }
  | { operation: "usage"; stackId: string; tenantId: string }
  | { operation: "gc"; stackId: string; tenantId: string }
  | { operation: "listRootRefs"; stackId: string; tenantId: string }
  | { operation: "updateRootRefs"; stackId: string; tenantId: string };

export type AppSpaceRoute =
  | { operation: "readContent"; appId: string; spaceId: string; hash: string }
  | { operation: "readMetadata"; appId: string; spaceId: string; hash: string }
  | { operation: "lease"; appId: string; spaceId: string; hash: string }
  | { operation: "usage"; appId: string; spaceId: string }
  | { operation: "gc"; appId: string; spaceId: string }
  | { operation: "listRootRefs"; appId: string; spaceId: string }
  | { operation: "updateRootRefs"; appId: string; spaceId: string };

function segment(value: string): string {
  return encodeURIComponent(value);
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export const casRoutes = {
  readContent: ({ stackId, tenantId, hash }: { stackId: string; tenantId: string; hash: string }) =>
    `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/cas/nodes/${segment(hash)}/content`,
  readMetadata: ({ stackId, tenantId, hash }: { stackId: string; tenantId: string; hash: string }) =>
    `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/cas/nodes/${segment(hash)}/metadata`,
  lease: ({ stackId, tenantId, hash }: { stackId: string; tenantId: string; hash: string }) =>
    `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/cas/nodes/${segment(hash)}/lease`,
  usage: ({ stackId, tenantId }: { stackId: string; tenantId: string }) =>
    `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/cas/usage`,
  gc: ({ stackId, tenantId }: { stackId: string; tenantId: string }) =>
    `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/cas/gc`,
  updateRootRefs: ({ stackId, tenantId }: { stackId: string; tenantId: string }) =>
    `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/root-refs`,
  listRootRefs: (
    { stackId, tenantId }: { stackId: string; tenantId: string },
    query: { readonly limit?: number; readonly cursor?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.cursor !== undefined) params.set("cursor", query.cursor);
    const suffix = params.size === 0 ? "" : `?${params}`;
    return `/stacks/${segment(stackId)}/tenants/${segment(tenantId)}/root-refs${suffix}`;
  },
} as const;

export const appSpaceRoutes = {
  readContent: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/nodes/${segment(hash)}/content`,
  readMetadata: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/nodes/${segment(hash)}/metadata`,
  lease: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/nodes/${segment(hash)}/lease`,
  usage: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/usage`,
  gc: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/gc`,
  updateRootRefs: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/root-refs`,
  listRootRefs: (
    { appId, spaceId }: { appId: string; spaceId: string },
    query: { readonly limit?: number; readonly cursor?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.cursor !== undefined) params.set("cursor", query.cursor);
    const suffix = params.size === 0 ? "" : `?${params}`;
    return `/v2/apps/${segment(appId)}/spaces/${segment(spaceId)}/root-refs${suffix}`;
  },
} as const;

/** Matches only stack-and-tenant service routes. Never /admin. */
export function matchCasRoute(method: string, pathname: string): CasRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "stacks" || !parts[1] || parts[2] !== "tenants" || !parts[3]) {
    return null;
  }

  const stackId = decodeSegment(parts[1]);
  const tenantId = decodeSegment(parts[3]);
  if (stackId === null || tenantId === null) return null;

  if (parts.length === 5 && parts[4] === "root-refs") {
    if (method === "GET") return { operation: "listRootRefs", stackId, tenantId };
    if (method === "POST") return { operation: "updateRootRefs", stackId, tenantId };
    return null;
  }

  if (parts[4] !== "cas") return null;
  if (parts.length === 6 && parts[5] === "usage" && method === "GET") {
    return { operation: "usage", stackId, tenantId };
  }
  if (parts.length === 6 && parts[5] === "gc" && method === "POST") {
    return { operation: "gc", stackId, tenantId };
  }
  if (parts[5] !== "nodes" || !parts[6]) return null;

  const hash = decodeSegment(parts[6]);
  if (hash === null) return null;
  if (parts.length !== 8) return null;
  if (parts[7] === "content" && method === "GET") {
    return { operation: "readContent", stackId, tenantId, hash };
  }
  if (parts[7] === "metadata" && method === "GET") {
    return { operation: "readMetadata", stackId, tenantId, hash };
  }
  if (parts[7] === "lease" && method === "POST") {
    return { operation: "lease", stackId, tenantId, hash };
  }
  return null;
}

export function matchAppSpaceRoute(method: string, pathname: string): AppSpaceRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts[0] !== "v2"
    || parts[1] !== "apps"
    || !parts[2]
    || parts[3] !== "spaces"
    || !parts[4]
  ) {
    return null;
  }

  const appId = decodeSegment(parts[2]);
  const spaceId = decodeSegment(parts[4]);
  if (appId === null || spaceId === null) return null;

  if (parts.length === 6 && parts[5] === "root-refs") {
    if (method === "GET") return { operation: "listRootRefs", appId, spaceId };
    if (method === "POST") return { operation: "updateRootRefs", appId, spaceId };
    return null;
  }

  if (parts[5] !== "cas") return null;
  if (parts.length === 7 && parts[6] === "usage" && method === "GET") {
    return { operation: "usage", appId, spaceId };
  }
  if (parts.length === 7 && parts[6] === "gc" && method === "POST") {
    return { operation: "gc", appId, spaceId };
  }
  if (parts[6] !== "nodes" || !parts[7]) return null;

  const hash = decodeSegment(parts[7]);
  if (hash === null || parts.length !== 9) return null;
  if (parts[8] === "content" && method === "GET") {
    return { operation: "readContent", appId, spaceId, hash };
  }
  if (parts[8] === "metadata" && method === "GET") {
    return { operation: "readMetadata", appId, spaceId, hash };
  }
  if (parts[8] === "lease" && method === "POST") {
    return { operation: "lease", appId, spaceId, hash };
  }
  return null;
}

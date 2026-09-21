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

export const appSpaceRoutes = {
  readContent: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/nodes/${segment(hash)}/content`,
  readMetadata: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/nodes/${segment(hash)}/metadata`,
  lease: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/nodes/${segment(hash)}/lease`,
  usage: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/usage`,
  gc: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/cas/gc`,
  updateRootRefs: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/root-refs`,
  listRootRefs: (
    { appId, spaceId }: { appId: string; spaceId: string },
    query: { readonly limit?: number; readonly cursor?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.cursor !== undefined) params.set("cursor", query.cursor);
    const suffix = params.size === 0 ? "" : `?${params}`;
    return `/v1/apps/${segment(appId)}/spaces/${segment(spaceId)}/root-refs${suffix}`;
  },
} as const;

export function matchAppSpaceRoute(method: string, pathname: string): AppSpaceRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts[0] !== "v1"
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

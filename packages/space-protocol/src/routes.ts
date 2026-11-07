import { validateSpaceId } from "./space-id.js";

export type AppSpaceRoute =
  | { operation: "readContent"; appId: string; spaceId: string; hash: string }
  | { operation: "readMetadata"; appId: string; spaceId: string; hash: string }
  | { operation: "lease"; appId: string; spaceId: string; hash: string }
  | { operation: "usage"; appId: string; spaceId: string }
  | { operation: "gc"; appId: string; spaceId: string }
  | { operation: "listRootRefs"; appId: string; spaceId: string }
  | { operation: "updateRootRefs"; appId: string; spaceId: string };

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function queryForScope(
  appId: string,
  spaceId: string,
  additional: Readonly<Record<string, string | number | undefined>> = {},
): string {
  if (appId.length === 0) throw new TypeError("appId must not be empty");
  const error = validateSpaceId(spaceId);
  if (error) throw new TypeError(error);
  const params = new URLSearchParams({ appId, spaceId });
  for (const [name, value] of Object.entries(additional)) {
    if (value !== undefined) params.set(name, String(value));
  }
  return `?${params}`;
}

export const appSpaceRoutes = {
  readContent: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v1/cas/nodes/${encodeURIComponent(hash)}${queryForScope(appId, spaceId)}`,
  readMetadata: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v1/cas/nodes/${encodeURIComponent(hash)}/metadata${queryForScope(appId, spaceId)}`,
  lease: ({ appId, spaceId, hash }: { appId: string; spaceId: string; hash: string }) =>
    `/v1/cas/nodes/${encodeURIComponent(hash)}/lease${queryForScope(appId, spaceId)}`,
  usage: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v1/cas/usage${queryForScope(appId, spaceId)}`,
  gc: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v1/cas/gc${queryForScope(appId, spaceId)}`,
  updateRootRefs: ({ appId, spaceId }: { appId: string; spaceId: string }) =>
    `/v1/cas/root-refs${queryForScope(appId, spaceId)}`,
  listRootRefs: (
    { appId, spaceId }: { appId: string; spaceId: string },
    query: { readonly limit?: number; readonly cursor?: string } = {},
  ) => {
    return `/v1/cas/root-refs${queryForScope(appId, spaceId, query)}`;
  },
} as const;

export function matchAppSpaceRoute(method: string, resource: string): AppSpaceRoute | null {
  let url: URL;
  try {
    url = new URL(resource, "https://unicas.invalid");
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts[0] !== "v1"
    || parts[1] !== "cas"
  ) {
    return null;
  }

  const appIds = url.searchParams.getAll("appId");
  const spaceIds = url.searchParams.getAll("spaceId");
  const appId = appIds.length === 1 && appIds[0]!.length > 0 ? appIds[0]! : null;
  const spaceId = spaceIds.length === 1 ? spaceIds[0]! : null;
  if (appId === null || spaceId === null || validateSpaceId(spaceId) !== null) return null;

  if (parts.length === 3 && parts[2] === "root-refs") {
    if (method === "GET") return { operation: "listRootRefs", appId, spaceId };
    if (method === "POST") return { operation: "updateRootRefs", appId, spaceId };
    return null;
  }

  if (parts.length === 3 && parts[2] === "usage" && method === "GET") {
    return { operation: "usage", appId, spaceId };
  }
  if (parts.length === 3 && parts[2] === "gc" && method === "POST") {
    return { operation: "gc", appId, spaceId };
  }
  if (parts[2] !== "nodes" || !parts[3]) return null;

  const hash = decodeSegment(parts[3]);
  if (hash === null) return null;
  if (parts.length === 4 && method === "GET") {
    return { operation: "readContent", appId, spaceId, hash };
  }
  if (parts.length !== 5) return null;
  if (parts[4] === "metadata" && method === "GET") {
    return { operation: "readMetadata", appId, spaceId, hash };
  }
  if (parts[4] === "lease" && method === "POST") {
    return { operation: "lease", appId, spaceId, hash };
  }
  return null;
}

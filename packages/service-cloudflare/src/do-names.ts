/** Canonical Durable Object names and App-scoped R2 node keys. */
export function canonicalComposite(appId: string, component: string): string {
  if (appId.length === 0 || component.length === 0) {
    throw new TypeError("DO composite parts must not be empty");
  }
  return `${encodeURIComponent(appId)}|${encodeURIComponent(component)}`;
}

export function decodeComposite(name: string): { appId: string; component: string } | null {
  const separator = name.indexOf("|");
  if (separator === -1) return null;
  try {
    const appId = decodeURIComponent(name.slice(0, separator));
    const component = decodeURIComponent(name.slice(separator + 1));
    if (appId.length === 0 || component.length === 0) return null;
    if (canonicalComposite(appId, component) !== name) return null;
    return { appId, component };
  } catch {
    return null;
  }
}

export function appCanonicalNodeKey(appId: string, spaceId: string, hash: string): string {
  return `apps/${appId}/spaces/${spaceId}/nodes-v2/${hash}`;
}

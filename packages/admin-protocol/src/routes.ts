export type CasAdminRoute =
  | { operation: "me" }
  | { operation: "listStacks" }
  | { operation: "createStack" }
  | { operation: "getStack"; stackId: string }
  | { operation: "patchStack"; stackId: string }
  | { operation: "listMembers"; stackId: string }
  | { operation: "listPlaygroundFileRoots"; stackId: string }
  | { operation: "createPlaygroundFileRoot"; stackId: string }
  | { operation: "patchPlaygroundFileRoot"; stackId: string; rootId: string }
  | { operation: "deletePlaygroundFileRoot"; stackId: string; rootId: string }
  | { operation: "deleteMember"; stackId: string }
  | { operation: "createMemberInvitation"; stackId: string }
  | { operation: "acceptMemberInvitation"; token: string }
  | { operation: "getOAuthIssuer"; stackId: string }
  | { operation: "getManagedIssuer"; stackId: string }
  | { operation: "patchManagedIssuer"; stackId: string }
  | { operation: "mintManagedCapability"; stackId: string }
  | { operation: "inspectOAuthIssuer"; stackId: string }
  | { operation: "activateOAuthIssuer"; stackId: string }
  | { operation: "listRefDomains"; stackId: string }
  | { operation: "listControlAuditEvents"; stackId: string }
  | { operation: "listRootDomainRefs"; stackId: string; refDomain: string }
  | { operation: "listRootDomainEvents"; stackId: string; refDomain: string };

export type AppAdminRoute =
  | { operation: "me" }
  | { operation: "listApps" }
  | { operation: "createApp" }
  | { operation: "getApp"; appId: string }
  | { operation: "patchApp"; appId: string }
  | { operation: "listMembers"; appId: string }
  | { operation: "listPlaygroundFileRoots"; appId: string }
  | { operation: "createPlaygroundFileRoot"; appId: string }
  | { operation: "patchPlaygroundFileRoot"; appId: string; rootId: string }
  | { operation: "deletePlaygroundFileRoot"; appId: string; rootId: string }
  | { operation: "deleteMember"; appId: string }
  | { operation: "createMemberInvitation"; appId: string }
  | { operation: "acceptMemberInvitation"; token: string }
  | { operation: "getOAuthIssuer"; appId: string }
  | { operation: "getManagedIssuer"; appId: string }
  | { operation: "patchManagedIssuer"; appId: string }
  | { operation: "mintManagedCapability"; appId: string }
  | { operation: "inspectOAuthIssuer"; appId: string }
  | { operation: "activateOAuthIssuer"; appId: string }
  | { operation: "listRefDomains"; appId: string }
  | { operation: "listControlAuditEvents"; appId: string }
  | { operation: "listRootDomainRefs"; appId: string; refDomain: string }
  | { operation: "listRootDomainEvents"; appId: string; refDomain: string };

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

export const casAdminRoutes = {
  me: () => "/admin/me",
  stacks: () => "/admin/stacks",
  stack: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}`,
  members: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/members`,
  memberInvitations: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/member-invitations`,
  playgroundFileRoots: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/playground/file-roots`,
  playgroundFileRoot: ({ stackId, rootId }: { stackId: string; rootId: string }) =>
    `/admin/stacks/${segment(stackId)}/playground/file-roots/${segment(rootId)}`,
  acceptMemberInvitation: ({ token }: { token: string }) =>
    `/admin/member-invitations/${segment(token)}/accept`,
  oauthIssuer: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/oauth-issuer`,
  managedCapability: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/managed-capabilities`,
  managedIssuer: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/managed-issuer`,
  oauthIssuerInspections: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/oauth-issuer/inspections`,
  refDomains: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/ref-domains`,
  controlAuditEvents: ({ stackId }: { stackId: string }) =>
    `/admin/stacks/${segment(stackId)}/audit-events`,
  rootDomainRefs: ({ stackId, refDomain }: { stackId: string; refDomain: string }) =>
    `/admin/stacks/${segment(stackId)}/root-ref-domains/${segment(refDomain)}/refs`,
  rootDomainEvents: ({ stackId, refDomain }: { stackId: string; refDomain: string }) =>
    `/admin/stacks/${segment(stackId)}/root-ref-domains/${segment(refDomain)}/events`,
} as const;

export const appAdminRoutes = {
  me: () => "/admin/me",
  apps: () => "/admin/apps",
  app: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}`,
  members: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/members`,
  memberInvitations: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/member-invitations`,
  playgroundFileRoots: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/playground/file-roots`,
  playgroundFileRoot: ({ appId, rootId }: { appId: string; rootId: string }) =>
    `/admin/apps/${segment(appId)}/playground/file-roots/${segment(rootId)}`,
  acceptMemberInvitation: ({ token }: { token: string }) =>
    `/admin/member-invitations/${segment(token)}/accept`,
  oauthIssuer: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/oauth-issuer`,
  managedCapability: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/managed-capabilities`,
  managedIssuer: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/managed-issuer`,
  oauthIssuerInspections: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/oauth-issuer/inspections`,
  refDomains: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/ref-domains`,
  controlAuditEvents: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/audit-events`,
  rootDomainRefs: ({ appId, refDomain }: { appId: string; refDomain: string }) =>
    `/admin/apps/${segment(appId)}/root-ref-domains/${segment(refDomain)}/refs`,
  rootDomainEvents: ({ appId, refDomain }: { appId: string; refDomain: string }) =>
    `/admin/apps/${segment(appId)}/root-ref-domains/${segment(refDomain)}/events`,
} as const;

/**
 * Matches only `/admin/...` control-plane resources.
 * Never returns a tenant data-plane operation.
 */
export function matchCasAdminRoute(
  method: string,
  pathname: string,
): CasAdminRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return null;

  if (parts.length === 2 && parts[1] === "me" && method === "GET") {
    return { operation: "me" };
  }

  if (parts.length === 2 && parts[1] === "stacks") {
    if (method === "GET") return { operation: "listStacks" };
    if (method === "POST") return { operation: "createStack" };
    return null;
  }

  if (
    parts.length === 4
    && parts[1] === "member-invitations"
    && parts[3] === "accept"
    && method === "POST"
  ) {
    const token = decodeSegment(parts[2]!);
    return token === null ? null : { operation: "acceptMemberInvitation", token };
  }

  if (parts[1] !== "stacks" || !parts[2]) return null;
  const stackId = decodeSegment(parts[2]);
  if (stackId === null) return null;

  if (parts.length === 3) {
    if (method === "GET") return { operation: "getStack", stackId };
    if (method === "PATCH") return { operation: "patchStack", stackId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "members") {
    if (method === "GET") return { operation: "listMembers", stackId };
    if (method === "DELETE") return { operation: "deleteMember", stackId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "member-invitations" && method === "POST") {
    return { operation: "createMemberInvitation", stackId };
  }

  if (parts.length === 5 && parts[3] === "playground" && parts[4] === "file-roots") {
    if (method === "GET") return { operation: "listPlaygroundFileRoots", stackId };
    if (method === "POST") return { operation: "createPlaygroundFileRoot", stackId };
    return null;
  }

  if (parts.length === 6 && parts[3] === "playground" && parts[4] === "file-roots") {
    const rootId = decodeSegment(parts[5]!);
    if (rootId === null) return null;
    if (method === "PATCH") return { operation: "patchPlaygroundFileRoot", stackId, rootId };
    if (method === "DELETE") return { operation: "deletePlaygroundFileRoot", stackId, rootId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "oauth-issuer") {
    if (method === "GET") return { operation: "getOAuthIssuer", stackId };
    if (method === "PUT") return { operation: "activateOAuthIssuer", stackId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "managed-capabilities" && method === "POST") {
    return { operation: "mintManagedCapability", stackId };
  }

  if (parts.length === 4 && parts[3] === "managed-issuer") {
    if (method === "GET") return { operation: "getManagedIssuer", stackId };
    if (method === "PATCH") return { operation: "patchManagedIssuer", stackId };
    return null;
  }

  if (
    parts.length === 5
    && parts[3] === "oauth-issuer"
    && parts[4] === "inspections"
    && method === "POST"
  ) {
    return { operation: "inspectOAuthIssuer", stackId };
  }

  if (parts.length === 4 && parts[3] === "ref-domains") {
    return method === "GET" ? { operation: "listRefDomains", stackId } : null;
  }

  if (parts.length === 4 && parts[3] === "audit-events" && method === "GET") {
    return { operation: "listControlAuditEvents", stackId };
  }

  if (
    parts.length === 6
    && parts[3] === "root-ref-domains"
    && parts[4]
    && (parts[5] === "refs" || parts[5] === "events")
    && method === "GET"
  ) {
    const refDomain = decodeSegment(parts[4]);
    if (refDomain === null) return null;
    if (parts[5] === "refs") {
      return { operation: "listRootDomainRefs", stackId, refDomain };
    }
    return { operation: "listRootDomainEvents", stackId, refDomain };
  }

  return null;
}

export function matchAppAdminRoute(
  method: string,
  pathname: string,
): AppAdminRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return null;

  if (parts.length === 2 && parts[1] === "me" && method === "GET") {
    return { operation: "me" };
  }

  if (parts.length === 2 && parts[1] === "apps") {
    if (method === "GET") return { operation: "listApps" };
    if (method === "POST") return { operation: "createApp" };
    return null;
  }

  if (
    parts.length === 4
    && parts[1] === "member-invitations"
    && parts[3] === "accept"
    && method === "POST"
  ) {
    const token = decodeSegment(parts[2]!);
    return token === null ? null : { operation: "acceptMemberInvitation", token };
  }

  if (parts[1] !== "apps" || !parts[2]) return null;
  const appId = decodeSegment(parts[2]);
  if (appId === null) return null;

  if (parts.length === 3) {
    if (method === "GET") return { operation: "getApp", appId };
    if (method === "PATCH") return { operation: "patchApp", appId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "members") {
    if (method === "GET") return { operation: "listMembers", appId };
    if (method === "DELETE") return { operation: "deleteMember", appId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "member-invitations" && method === "POST") {
    return { operation: "createMemberInvitation", appId };
  }

  if (parts.length === 5 && parts[3] === "playground" && parts[4] === "file-roots") {
    if (method === "GET") return { operation: "listPlaygroundFileRoots", appId };
    if (method === "POST") return { operation: "createPlaygroundFileRoot", appId };
    return null;
  }

  if (parts.length === 6 && parts[3] === "playground" && parts[4] === "file-roots") {
    const rootId = decodeSegment(parts[5]!);
    if (rootId === null) return null;
    if (method === "PATCH") return { operation: "patchPlaygroundFileRoot", appId, rootId };
    if (method === "DELETE") return { operation: "deletePlaygroundFileRoot", appId, rootId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "oauth-issuer") {
    if (method === "GET") return { operation: "getOAuthIssuer", appId };
    if (method === "PUT") return { operation: "activateOAuthIssuer", appId };
    return null;
  }

  if (parts.length === 4 && parts[3] === "managed-capabilities" && method === "POST") {
    return { operation: "mintManagedCapability", appId };
  }

  if (parts.length === 4 && parts[3] === "managed-issuer") {
    if (method === "GET") return { operation: "getManagedIssuer", appId };
    if (method === "PATCH") return { operation: "patchManagedIssuer", appId };
    return null;
  }

  if (
    parts.length === 5
    && parts[3] === "oauth-issuer"
    && parts[4] === "inspections"
    && method === "POST"
  ) {
    return { operation: "inspectOAuthIssuer", appId };
  }

  if (parts.length === 4 && parts[3] === "ref-domains") {
    return method === "GET" ? { operation: "listRefDomains", appId } : null;
  }

  if (parts.length === 4 && parts[3] === "audit-events" && method === "GET") {
    return { operation: "listControlAuditEvents", appId };
  }

  if (
    parts.length === 6
    && parts[3] === "root-ref-domains"
    && parts[4]
    && (parts[5] === "refs" || parts[5] === "events")
    && method === "GET"
  ) {
    const refDomain = decodeSegment(parts[4]);
    if (refDomain === null) return null;
    if (parts[5] === "refs") {
      return { operation: "listRootDomainRefs", appId, refDomain };
    }
    return { operation: "listRootDomainEvents", appId, refDomain };
  }

  return null;
}

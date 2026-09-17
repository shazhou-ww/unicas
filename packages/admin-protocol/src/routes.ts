export type CasAdminRoute =
  | { operation: "me" }
  | { operation: "listStacks" }
  | { operation: "createStack" }
  | { operation: "getStack"; stackId: string }
  | { operation: "patchStack"; stackId: string }
  | { operation: "listMembers"; stackId: string }
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
  | { operation: "listRootDomainEvents"; stackId: string; refDomain: string }
  | { operation: "accessSummary" }
  | { operation: "listPlatformPrincipals" }
  | { operation: "getPlatformPrincipal"; principalRef: string }
  | { operation: "getPlatformAccess"; principalRef: string }
  | { operation: "patchPlatformAccess"; principalRef: string }
  | { operation: "listPlatformAccounts" }
  | { operation: "getPlatformAccount"; accountId: string }
  | { operation: "grantPlatformAccountAuthority"; accountId: string; authority: "platform.admin" | "apps.create" }
  | { operation: "revokePlatformAccountAuthority"; accountId: string; authority: "platform.admin" | "apps.create" }
  | { operation: "blockPlatformAccount"; accountId: string }
  | { operation: "restorePlatformAccount"; accountId: string }
  | { operation: "listPlatformInvitations" }
  | { operation: "createPlatformInvitation" }
  | { operation: "revokePlatformInvitation"; invitationId: string }
  | { operation: "acceptPlatformInvitation"; token: string }
  | { operation: "listPlatformAuditEvents" };

export type AppAdminRoute =
  | { operation: "listPeople"; appId: string }
  | { operation: "listPlatformPeople" }
  | { operation: "me" }
  | { operation: "getAccount" }
  | { operation: "patchAccountProfile" }
  | { operation: "listAccountIdentities" }
  | { operation: "listApps" }
  | { operation: "createApp" }
  | { operation: "getApp"; appId: string }
  | { operation: "patchApp"; appId: string }
  | { operation: "listMembers"; appId: string }
  | { operation: "deleteMember"; appId: string }
  | { operation: "createMemberInvitation"; appId: string }
  | { operation: "listMemberInvitations"; appId: string }
  | { operation: "revokeMemberInvitation"; appId: string; invitationId: string }
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
  | { operation: "listRootDomainEvents"; appId: string; refDomain: string }
  | { operation: "accessSummary" }
  | { operation: "listPlatformPrincipals" }
  | { operation: "getPlatformPrincipal"; principalRef: string }
  | { operation: "getPlatformAccess"; principalRef: string }
  | { operation: "patchPlatformAccess"; principalRef: string }
  | { operation: "listPlatformAccounts" }
  | { operation: "getPlatformAccount"; accountId: string }
  | { operation: "grantPlatformAccountAuthority"; accountId: string; authority: "platform.admin" | "apps.create" }
  | { operation: "revokePlatformAccountAuthority"; accountId: string; authority: "platform.admin" | "apps.create" }
  | { operation: "blockPlatformAccount"; accountId: string }
  | { operation: "restorePlatformAccount"; accountId: string }
  | { operation: "listPlatformInvitations" }
  | { operation: "createPlatformInvitation" }
  | { operation: "revokePlatformInvitation"; invitationId: string }
  | { operation: "acceptPlatformInvitation"; token: string }
  | { operation: "listPlatformAuditEvents" };

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
  accessSummary: () => "/admin/platform/access-summary",
  platformPrincipals: () => "/admin/platform/principals",
  platformPrincipal: ({ principalRef }: { principalRef: string }) =>
    `/admin/platform/principals/${segment(principalRef)}`,
  platformPrincipalAccess: ({ principalRef }: { principalRef: string }) =>
    `/admin/platform/principals/${segment(principalRef)}/access`,
  platformAccounts: () => "/admin/platform/accounts",
  platformAccount: ({ accountId }: { accountId: string }) =>
    `/admin/platform/accounts/${segment(accountId)}`,
  platformAccountAuthority: ({ accountId, authority }: { accountId: string; authority: string }) =>
    `/admin/platform/accounts/${segment(accountId)}/authorities/${segment(authority)}`,
  platformAccountBlock: ({ accountId }: { accountId: string }) =>
    `/admin/platform/accounts/${segment(accountId)}/block`,
  platformInvitations: () => "/admin/platform/invitations",
  platformInvitation: ({ invitationId }: { invitationId: string }) =>
    `/admin/platform/invitations/${segment(invitationId)}`,
  acceptPlatformInvitation: ({ token }: { token: string }) =>
    `/admin/platform-invitations/${segment(token)}/accept`,
  platformAuditEvents: () => "/admin/platform/audit-events",
} as const;

export const appAdminRoutes = {
  people: ({ appId }: { appId: string }) => `/admin/apps/${segment(appId)}/people`,
  platformPeople: () => "/admin/platform/people",
  me: () => "/admin/me",
  account: () => "/admin/account",
  accountProfile: () => "/admin/account/profile",
  accountIdentities: () => "/admin/account/identities",
  apps: () => "/admin/apps",
  app: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}`,
  members: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/members`,
  memberInvitations: ({ appId }: { appId: string }) =>
    `/admin/apps/${segment(appId)}/member-invitations`,
  memberInvitation: ({ appId, invitationId }: { appId: string; invitationId: string }) =>
    `/admin/apps/${segment(appId)}/member-invitations/${segment(invitationId)}`,
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
  accessSummary: () => "/admin/platform/access-summary",
  platformPrincipals: () => "/admin/platform/principals",
  platformPrincipal: ({ principalRef }: { principalRef: string }) =>
    `/admin/platform/principals/${segment(principalRef)}`,
  platformPrincipalAccess: ({ principalRef }: { principalRef: string }) =>
    `/admin/platform/principals/${segment(principalRef)}/access`,
  platformAccounts: () => "/admin/platform/accounts",
  platformAccount: ({ accountId }: { accountId: string }) =>
    `/admin/platform/accounts/${segment(accountId)}`,
  platformAccountAuthority: ({ accountId, authority }: { accountId: string; authority: string }) =>
    `/admin/platform/accounts/${segment(accountId)}/authorities/${segment(authority)}`,
  platformAccountBlock: ({ accountId }: { accountId: string }) =>
    `/admin/platform/accounts/${segment(accountId)}/block`,
  platformInvitations: () => "/admin/platform/invitations",
  platformInvitation: ({ invitationId }: { invitationId: string }) =>
    `/admin/platform/invitations/${segment(invitationId)}`,
  acceptPlatformInvitation: ({ token }: { token: string }) =>
    `/admin/platform-invitations/${segment(token)}/accept`,
  platformAuditEvents: () => "/admin/platform/audit-events",
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

  if (parts[1] === "platform") {
    const platformRoute = matchPlatformAdminRoute(method, pathname);
    return platformRoute as CasAdminRoute | null;
  }

  if (
    parts.length === 4
    && parts[1] === "platform-invitations"
    && parts[3] === "accept"
    && method === "POST"
  ) {
    const token = decodeSegment(parts[2]!);
    return token === null ? null : { operation: "acceptPlatformInvitation", token };
  }

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

  if (parts[1] === "platform") {
    return matchPlatformAdminRoute(method, pathname);
  }

  if (
    parts.length === 4
    && parts[1] === "platform-invitations"
    && parts[3] === "accept"
    && method === "POST"
  ) {
    const token = decodeSegment(parts[2]!);
    return token === null ? null : { operation: "acceptPlatformInvitation", token };
  }

  if (parts.length === 2 && parts[1] === "me" && method === "GET") {
    return { operation: "me" };
  }

  if (parts.length === 2 && parts[1] === "account" && method === "GET") {
    return { operation: "getAccount" };
  }
  if (parts.length === 3 && parts[1] === "account" && parts[2] === "profile" && method === "PATCH") {
    return { operation: "patchAccountProfile" };
  }
  if (parts.length === 3 && parts[1] === "account" && parts[2] === "identities" && method === "GET") {
    return { operation: "listAccountIdentities" };
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

  if (parts.length === 4 && parts[3] === "people" && method === "GET") return { operation: "listPeople", appId };

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

  if (parts.length === 4 && parts[3] === "member-invitations") {
    if (method === "POST") return { operation: "createMemberInvitation", appId };
    if (method === "GET") return { operation: "listMemberInvitations", appId };
  }
  if (parts.length === 5 && parts[3] === "member-invitations" && method === "DELETE") {
    const invitationId = decodeSegment(parts[4]!);
    return invitationId === null ? null : { operation: "revokeMemberInvitation", appId, invitationId };
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

export function matchPlatformAdminRoute(
  method: string,
  pathname: string,
): AppAdminRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin" || parts[1] !== "platform") return null;

  if (parts.length === 3 && parts[2] === "people" && method === "GET") return { operation: "listPlatformPeople" };

  if (parts.length === 3 && parts[2] === "access-summary" && method === "GET") {
    return { operation: "accessSummary" };
  }

  if (parts.length === 3 && parts[2] === "accounts" && method === "GET") {
    return { operation: "listPlatformAccounts" };
  }

  if (parts.length === 4 && parts[2] === "accounts" && parts[3] && method === "GET") {
    const accountId = decodeSegment(parts[3]!);
    return accountId === null ? null : { operation: "getPlatformAccount", accountId };
  }

  if (parts.length === 5 && parts[2] === "accounts" && parts[3] && parts[4] === "block") {
    const accountId = decodeSegment(parts[3]!);
    if (accountId === null) return null;
    if (method === "PUT") return { operation: "blockPlatformAccount", accountId };
    if (method === "DELETE") return { operation: "restorePlatformAccount", accountId };
    return null;
  }

  if (parts.length === 6 && parts[2] === "accounts" && parts[3] && parts[4] === "authorities" && parts[5]) {
    const accountId = decodeSegment(parts[3]!);
    const authority = decodeSegment(parts[5]!);
    if (accountId === null || (authority !== "platform.admin" && authority !== "apps.create")) return null;
    if (method === "PUT") return { operation: "grantPlatformAccountAuthority", accountId, authority };
    if (method === "DELETE") return { operation: "revokePlatformAccountAuthority", accountId, authority };
    return null;
  }

  if (parts.length === 3 && parts[2] === "principals") {
    if (method === "GET") return { operation: "listPlatformPrincipals" };
    return null;
  }

  if (parts.length === 3 && parts[2] === "invitations") {
    if (method === "GET") return { operation: "listPlatformInvitations" };
    if (method === "POST") return { operation: "createPlatformInvitation" };
    return null;
  }

  if (parts.length === 3 && parts[2] === "audit-events" && method === "GET") {
    return { operation: "listPlatformAuditEvents" };
  }

  if (parts.length === 4 && parts[2] === "invitations" && method === "DELETE") {
    const invitationId = decodeSegment(parts[3]!);
    return invitationId === null ? null : { operation: "revokePlatformInvitation", invitationId };
  }

  if (parts.length === 4 && parts[2] === "principals" && parts[3]) {
    const principalRef = decodeSegment(parts[3]!);
    if (principalRef === null) return null;
    if (method === "GET") return { operation: "getPlatformPrincipal", principalRef };
    return null;
  }

  if (
    parts.length === 5
    && parts[2] === "principals"
    && parts[3]
    && parts[4] === "access"
  ) {
    const principalRef = decodeSegment(parts[3]!);
    if (principalRef === null) return null;
    if (method === "GET") return { operation: "getPlatformAccess", principalRef };
    if (method === "PATCH") return { operation: "patchPlatformAccess", principalRef };
  }

  return null;
}

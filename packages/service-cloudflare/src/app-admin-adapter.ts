import { formatCasAdminETag, type AppAdminRoute } from "@unicas/admin-protocol";

type AdminHandler = (request: Request) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export async function handleAppAdminCompatibilityRequest(
  request: Request,
  route: AppAdminRoute,
  legacyHandler: AdminHandler,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (route.operation === "me") return legacyHandler(request);
  if (pathname.startsWith("/admin/platform/") || pathname.startsWith("/admin/platform-invitations/")) {
    return legacyHandler(request);
  }
  if (route.operation === "listApps" || route.operation === "createApp" || route.operation === "getApp") {
    return legacyHandler(request);
  }
  if (route.operation === "listMembers" || route.operation === "deleteMember") {
    return legacyHandler(request);
  }
  if (route.operation === "listControlAuditEvents") return legacyHandler(request);
  if (route.operation === "listRefDomains" || route.operation === "listRootDomainRefs"
    || route.operation === "listRootDomainEvents") return legacyHandler(request);
  if (route.operation === "listPeople" || route.operation === "mintManagedCapability" || route.operation === "patchApp"
    || route.operation === "getOAuthIssuer" || route.operation === "getManagedIssuer" || route.operation === "patchManagedIssuer"
    || route.operation === "createMemberInvitation" || route.operation === "listMemberInvitations" || route.operation === "revokeMemberInvitation"
    || route.operation === "inspectOAuthIssuer" || route.operation === "activateOAuthIssuer") {
    return legacyHandler(request);
  }

  const legacyResponse = await legacyHandler(rewriteRequest(request, route));
  if (!legacyResponse.headers.get("Content-Type")?.includes("application/json")) {
    return legacyResponse;
  }
  const body = await legacyResponse.json();
  if (isRecord(body) && typeof body.error === "string") {
    return copyJsonResponse(legacyResponse, transformAppAdminError(body));
  }
  return copyJsonResponse(
    legacyResponse,
    transformAppAdminResponse(route, body),
    undefined,
  );
}

export function transformAppAdminError(value: JsonRecord): JsonRecord {
  return {
    ...value,
    error: value.error === "STACK_MEMBERSHIP_REQUIRED" ? "APP_MEMBERSHIP_REQUIRED" : value.error,
    ...(typeof value.message === "string"
      ? { message: value.message.replace(/\bstack\b/gi, "App") }
      : {}),
  };
}

function rewriteRequest(request: Request, route: AppAdminRoute): Request {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/admin/apps")) {
    url.pathname = url.pathname.replace(/^\/admin\/apps/, "/admin/stacks");
  }
  if (route.operation === "deleteMember") {
    const issuer = url.searchParams.get("issuer");
    if (issuer !== null) {
      url.searchParams.delete("issuer");
      url.searchParams.set("identityIssuer", issuer);
    }
  }
  return new Request(url, request);
}

export function transformAppAdminResponse(route: AppAdminRoute, body: unknown): unknown {
  switch (route.operation) {
    case "me":
      return body;
    case "listApps":
      return mapPage(body, mapApp);
    case "createApp":
      return mapCreateApp(body);
    case "getApp":
      return mapApp(body);
    case "patchApp":
    case "listMemberInvitations":
    case "revokeMemberInvitation":
      return body;
    case "listMembers":
      return mapPage(body, mapMembership);
    case "createMemberInvitation":
      return mapInvitationResponse(body);
    case "acceptMemberInvitation":
      return isRecord(body) ? { appId: body.stackId } : body;
    case "getOAuthIssuer":
    case "getManagedIssuer":
    case "patchManagedIssuer":
    case "inspectOAuthIssuer":
    case "activateOAuthIssuer":
      return body === null ? null : renameField(body, "stackId", "appId");
    case "listRefDomains":
      return mapArrayProperty(body, "domains", value => renameField(value, "stackId", "appId"));
    case "listControlAuditEvents":
      return mapPage(body, mapAuditEvent);
    case "listRootDomainRefs":
      return mapArrayProperty(body, "refs", value => renameField(value, "tenantId", "spaceId"));
    case "listRootDomainEvents":
      return mapArrayProperty(body, "events", value => renameField(value, "tenantId", "spaceId"));
    case "deleteMember":
      return body;
    case "mintManagedCapability":
      return body;
  }
}

function mapApp(value: unknown): unknown {
  return renameField(value, "stackId", "appId");
}

function mapCreateApp(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    appId: value.stackId,
    ...(typeof value.etag === "string" ? { etag: value.etag } : {}),
  };
}

function mapMembership(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    appId: value.stackId,
    principal: { issuer: value.identityIssuer, subject: value.subject },
    profile: { displayName: value.displayName, emailForDisplay: value.emailForDisplay },
  };
}

function mapInvitationResponse(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.invitation)) return value;
  return {
    invitationId: value.invitation.invitationId,
    acceptUrl: value.acceptUrl,
    expiresAt: value.invitation.expiresAt,
  };
}

function mapAuditEvent(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { stackId, ...event } = value;
  return {
    ...event,
    appId: stackId,
    action: value.action === "stack.created"
      ? "app.created"
      : value.action === "stack.patched"
        ? "app.patched"
        : value.action,
    actor: isRecord(value.actor)
      ? { issuer: value.actor.identityIssuer, subject: value.actor.subject }
      : value.actor,
  };
}

function mapPage(value: unknown, mapper: (item: unknown) => unknown): unknown {
  return mapArrayProperty(value, "items", mapper);
}

function mapArrayProperty(
  value: unknown,
  property: string,
  mapper: (item: unknown) => unknown,
): unknown {
  if (!isRecord(value) || !Array.isArray(value[property])) return value;
  return { ...value, [property]: value[property].map(mapper) };
}

function renameField(value: unknown, from: string, to: string): unknown {
  if (!isRecord(value)) return value;
  const { [from]: renamed, ...rest } = value;
  return { ...rest, [to]: renamed };
}

function copyJsonResponse(source: Response, body: unknown, status = source.status): Response {
  const headers = new Headers(source.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(body), {
    status,
    statusText: source.statusText,
    headers,
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
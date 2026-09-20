import type { AppAdminRoute } from "@unicas/admin-protocol";

type AdminHandler = (request: Request) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export async function handleAppAdminCompatibilityRequest(
  request: Request,
  _route: AppAdminRoute,
  legacyHandler: AdminHandler,
): Promise<Response> {
  return legacyHandler(request);
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
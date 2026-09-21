import {
  matchAppAdminRoute,
  type AppAdminRoute,
} from "@unicas/admin-protocol";
import {
  CapabilityError,
  matchAppSpaceRoute,
  type AppSpaceRoute,
} from "@unicas/space-protocol";
import { matchCasRoute, type CasRoute } from "@unicas/space-protocol/v1";
import {
  CasLeaseDurationHeader,
  CasUploadIdHeader,
  CasUploadLengthHeader,
} from "@unicas/space-protocol";
import type { ServicePlatform } from "./ports.js";

export interface HttpActor {
  fetch(request: Request): Promise<Response>;
}

export interface V1StackTenantRequestContext {
  readonly request: Request;
  readonly route: CasRoute;
  readonly platform: ServicePlatform;
}

export interface AuthorizedV1StackTenantCall {
  readonly stackId: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly jti: string;
  readonly kid: string;
  readonly permissions: readonly string[];
  readonly refDomain?: string;
}

export interface SpaceRequestContext {
  readonly request: Request;
  readonly route: AppSpaceRoute;
  readonly platform: ServicePlatform;
}

export interface AuthorizedSpaceCall {
  readonly appId: string;
  readonly spaceId: string;
  readonly subject: string;
  readonly jti: string;
  readonly kid: string;
  readonly permissions: readonly string[];
  readonly refDomain?: string;
}

export interface AppAdminRequestContext {
  readonly request: Request;
  readonly route: AppAdminRoute;
  readonly platform: ServicePlatform;
}

export interface ServiceContext {
  readonly platform: ServicePlatform;
  authorizeV1StackTenantRequest(
    context: V1StackTenantRequestContext,
  ): Promise<AuthorizedV1StackTenantCall>;
  authorizeSpaceRequest?(context: SpaceRequestContext): Promise<AuthorizedSpaceCall>;
  handleAppAdminRequest?(context: AppAdminRequestContext): Promise<Response>;
}

export type UniCasServiceRoute =
  | { readonly plane: "v1-stack-tenant"; readonly route: CasRoute }
  | { readonly plane: "space"; readonly route: AppSpaceRoute }
  | { readonly plane: "app-admin"; readonly route: AppAdminRoute };

export function matchUniCasServiceRoute(request: Request): UniCasServiceRoute | null {
  const pathname = new URL(request.url).pathname;
  const v1Route = matchCasRoute(request.method, pathname);
  if (v1Route) return { plane: "v1-stack-tenant", route: v1Route };
  const spaceRoute = matchAppSpaceRoute(request.method, pathname);
  if (spaceRoute) return { plane: "space", route: spaceRoute };
  const appAdminRoute = matchAppAdminRoute(request.method, pathname);
  if (appAdminRoute) return { plane: "app-admin", route: appAdminRoute };
  return null;
}

export function createUniCasService(context: ServiceContext): HttpActor {
  return {
    fetch(request) {
      const matched = matchUniCasServiceRoute(request);
      if (!matched) {
        return Promise.resolve(Response.json(
          { error: "Unknown UniCAS endpoint" },
          { status: 404 },
        ));
      }
      if (matched.plane === "v1-stack-tenant") {
        const v1Context = {
          request,
          route: matched.route,
          platform: context.platform,
        };
        return context.authorizeV1StackTenantRequest(v1Context)
          .then(
            (call) => dispatchV1StackTenantRequest(v1Context, call),
            v1AuthorizationErrorResponse,
          );
      }
      if (matched.plane === "space") {
        if (!context.authorizeSpaceRequest) return Promise.resolve(notImplementedResponse());
        const spaceContext = {
          request,
          route: matched.route,
          platform: context.platform,
        };
        return context.authorizeSpaceRequest(spaceContext)
          .then(
            (call) => dispatchSpaceRequest(spaceContext, call),
            spaceAuthorizationErrorResponse,
          );
      }
      if (!context.handleAppAdminRequest) return Promise.resolve(notImplementedResponse());
      return context.handleAppAdminRequest({
        request,
        route: matched.route,
        platform: context.platform,
      });
    },
  };
}

function notImplementedResponse(): Response {
  return Response.json({ error: "UniCAS v2 endpoint is not configured" }, { status: 501 });
}

function v1AuthorizationErrorResponse(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "CAS capability validation failed" }, { status: 401 });
}

function spaceAuthorizationErrorResponse(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }
  return Response.json({ error: "CAS capability validation failed" }, { status: 401 });
}

async function dispatchV1StackTenantRequest(
  context: V1StackTenantRequestContext,
  call: AuthorizedV1StackTenantCall,
): Promise<Response> {
  return dispatchDataRequest(
    context.request,
    context.route,
    context.platform,
    canonicalActorKey(call.stackId, call.tenantId),
    { "X-CAS-Stack-Id": call.stackId, "X-CAS-Tenant-Id": call.tenantId },
    call.refDomain,
  );
}

async function dispatchSpaceRequest(
  context: SpaceRequestContext,
  call: AuthorizedSpaceCall,
): Promise<Response> {
  return dispatchDataRequest(
    context.request,
    context.route,
    context.platform,
    canonicalActorKey(call.appId, call.spaceId),
    {
      "X-CAS-App-Id": call.appId,
      "X-CAS-Space-Id": call.spaceId,
      "X-CAS-Api-Version": "2",
    },
    call.refDomain,
  );
}

async function dispatchDataRequest(
  request: Request,
  route: CasRoute | AppSpaceRoute,
  platform: ServicePlatform,
  actorKey: string,
  headers: Record<string, string>,
  refDomain: string | undefined,
): Promise<Response> {

  if (route.operation === "listRootRefs" || route.operation === "updateRootRefs") {
    if (refDomain === undefined) {
      return Response.json(
        { error: "ROOT_REF_INVALID", message: "Root Refs access requires a verified refDomain" },
        { status: 403 },
      );
    }
    headers["X-CAS-Ref-Domain"] = refDomain;
    if (route.operation === "listRootRefs") {
      const query = new URL(request.url).search;
      return platform.spaceActors.fetch(actorKey, new Request(
        `https://space.internal/rootRefs${query}`,
        { headers },
      ));
    }
    return platform.spaceActors.fetch(actorKey, new Request(
      "https://space.internal/updateRootRefs",
      { method: "POST", headers, body: await request.text() },
    ));
  }

  let path: string;
  let method = "GET";
  let body: BodyInit | null | undefined;
  switch (route.operation) {
    case "readContent": {
      path = "/read";
      headers["X-CAS-Hash"] = route.hash;
      const range = request.headers.get("Range");
      if (range) headers.Range = range;
      break;
    }
    case "readMetadata":
      path = "/metadata";
      headers["X-CAS-Hash"] = route.hash;
      break;
    case "lease": {
      path = "/lease";
      method = "POST";
      headers["X-CAS-Hash"] = route.hash;
      if (headers["X-CAS-Api-Version"] === "2") {
        if (
          request.headers.has(CasLeaseDurationHeader)
          || request.headers.has(CasUploadLengthHeader)
          || request.headers.has(CasUploadIdHeader)
        ) {
          return Response.json(
            { error: "INVALID_REQUEST", message: "Legacy node lease headers are not supported by v2" },
            { status: 400 },
          );
        }
        if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/json") {
          return Response.json(
            { error: "INVALID_REQUEST", message: "v2 node lease requires application/json" },
            { status: 400 },
          );
        }
        headers["Content-Type"] = "application/json";
        body = await request.text();
        break;
      }
      const duration = request.headers.get(CasLeaseDurationHeader);
      if (duration) headers[CasLeaseDurationHeader] = duration;
      const contentType = request.headers.get("Content-Type");
      if (contentType) headers["Content-Type"] = contentType;
      const contentLength = request.headers.get("Content-Length");
      if (contentLength) headers["Content-Length"] = contentLength;
      const uploadLength = request.headers.get(CasUploadLengthHeader);
      if (uploadLength) headers[CasUploadLengthHeader] = uploadLength;
      const uploadId = request.headers.get(CasUploadIdHeader);
      if (uploadId) headers[CasUploadIdHeader] = uploadId;
      body = request.body;
      break;
    }
    case "usage":
      path = "/usage";
      break;
    case "gc":
      path = "/gc";
      method = "POST";
      body = request.body;
      break;
  }
  return platform.spaceActors.fetch(actorKey, new Request(
    `https://space.internal${path}`,
    {
      method,
      headers,
      ...(body === null || body === undefined ? {} : { body, duplex: "half" }),
    } as RequestInit & { duplex?: "half" },
  ));
}

function canonicalActorKey(appId: string, component: string): string {
  if (appId.length === 0 || component.length === 0) {
    throw new TypeError("actor key parts must not be empty");
  }
  return `${encodeURIComponent(appId)}|${encodeURIComponent(component)}`;
}
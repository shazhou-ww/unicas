import {
  createAdminBff,
  configFromEnv,
  uiAssets,
  type AdminBffEnv,
} from "./admin-bff/index.js";
import { handleAppAdminCompatibilityRequest } from "./app-admin-adapter.js";
import {
  createControlPlaneMcpWorker,
  mcpConfigFromEnv,
  type Env as McpEnv,
} from "./mcp/worker.js";
import {
  AppSpaceCapabilityVerifier,
  createUniCasService,
  matchUniCasServiceRoute,
  type BlobStore,
  type KeyedActorPort,
  type ServicePlatform,
  type SqlDatabase,
} from "@unicas/service";
import { CapabilityError } from "@unicas/space-protocol";
import {
  AuditReadError,
  listRootDomainEvents,
  listRootDomainRefs,
  listRootDomains,
} from "./audit-reads.js";
import { AppAuthorityRepository } from "./control-authority.js";
import { migrateControlSchema } from "./control-schema.js";
import { ControlSessionStore } from "./control-sessions.js";
import { D1PlatformInvitationRepository } from "./platform-invitation-repository.js";
import { D1PeopleRepository } from "./people-repository.js";
import { D1AccountRepository } from "./account-repository.js";
import { D1EmailChallengeRepository } from "./email-challenge-repository.js";
import { CloudflareAppUsageRepository } from "./app-usage.js";
import { CloudflareEmailChallengeSender } from "./email-challenge-sender.js";
import { CloudflareOAuthDiscoveryPort } from "./oauth-discovery.js";
import {
  RootRefDomainDurableObject,
  type RootRefDomainDoEnv,
} from "./domain-do.js";
import { migrateAppSpaceSchema } from "./schema.js";
import {
  DEFAULT_USAGE_RECONCILE_MAX_NODES,
  reconcileAppUsageObservations,
  repairOldestSpaceUsageProjection,
} from "./usage-reconciliation.js";
import { CasDurableObject, type SpaceCasDoEnv } from "./space-do.js";
import { ServerTiming, type TimingSink } from "./timing.js";
import {
  logUnexpectedError,
  traceCleanupRun,
  traceFetchOperation,
  type TracingPort,
} from "./observability.js";
import {
  createConfiguredManualTraceSession,
  createInternalTraceAudience,
  createInternalTraceContextHeader,
  InternalTraceContextHeader,
  TraceIdHeader,
  type ManualAttributeValue,
  type ManualTraceEnvironment,
  type ManualSpanName,
  type ManualTraceSession,
} from "@unicas/observability";

export { CasDurableObject, RootRefDomainDurableObject };

export interface SpaceEnv extends SpaceCasDoEnv, RootRefDomainDoEnv {
  CAS_CONTROL_DB: D1Database;
  CAS_DO: DurableObjectNamespace;
  CAS_AUDIT_READER_KEY?: string;
}

export type Env = SpaceEnv & AdminBffEnv & McpEnv & {
  CAS_PUBLIC_ORIGIN?: string;
  CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS?: string;
} & ManualTraceEnvironment;

const DATA_PLANE_STRIPPED_HEADERS = [
  "cookie",
  "x-internal-token",
  "x-cas-audit-reader-key",
  "x-unicas-trace-context",
] as const;

const ADMIN_STRIPPED_HEADERS = [
  "x-internal-token",
  "x-cas-audit-reader-key",
  "x-unicas-trace-context",
] as const;

const MCP_STRIPPED_HEADERS = [
  "cookie",
  "x-internal-token",
  "x-cas-audit-reader-key",
  "x-unicas-trace-context",
] as const;

const MCP_METADATA_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
]);

const MCP_BROWSER_PATHS = new Set([
  "/oauth/authorize",
  "/oauth/callback/google",
  "/oauth/callback/microsoft",
  "/oauth/callback/github",
]);

const MCP_TOKEN_PATHS = new Set([
  "/oauth/token",
  "/oauth/register",
]);

const MCP_BROWSER_COOKIE_NAMES = new Set([
  "unicas_mcp_oauth",
  "unicas_mcp_consent",
]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestStartedAt = Date.now();
    const serviceRoute = matchUniCasServiceRoute(request);
    const traceState: RequestTraceState = {
      session: serviceRoute?.plane === "space"
        ? undefined
        : await requestTraceSession(request, env, serviceRoute, false, requestStartedAt),
      completedSpans: [],
    };
    try {
      const response = await handleFetch(request, env, ctx, serviceRoute, traceState, requestStartedAt);
      const traceSession = await ensureRequestTraceSession(
        traceState,
        request,
        env,
        serviceRoute,
        requestStartedAt,
      );
      traceSession.end({
        "unicas.outcome": response.status >= 500 ? "failed" : response.status >= 400 ? "rejected" : "ok",
        "unicas.http.status_class": `${Math.floor(response.status / 100)}xx`,
      });
      ctx?.waitUntil(traceSession.flush());
      return withTraceId(response, traceSession.correlationUlid);
    } catch (error) {
      const traceSession = await ensureRequestTraceSession(
        traceState,
        request,
        env,
        serviceRoute,
        requestStartedAt,
      );
      traceSession.end({ "unicas.outcome": "failed" });
      ctx?.waitUntil(traceSession.flush());
      throw error;
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const traceSession = await createConfiguredManualTraceSession({
      environment: env,
      scope: { kind: "service", id: "unicas" },
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      rootAttributes: { "unicas.operation": "scheduled_cleanup" },
    });
    ctx.waitUntil(traceCleanupRun(traceSession.tracing, async () => {
      await ensureControlSchema(env);
      await ensureSpaceSchema(env);
      await new D1EmailChallengeRepository(env.CAS_CONTROL_DB).pruneExpired(Date.now());
      await new ControlSessionStore(env.CAS_CONTROL_DB).pruneExpired();
      const usage = await reconcileAppUsageObservations({
        db: env.CAS_DB,
        bucket: env.CAS_R2,
        limit: DEFAULT_USAGE_RECONCILE_MAX_NODES,
      });
      const summaryRepaired = await repairOldestSpaceUsageProjection({ db: env.CAS_DB });
      console.log(JSON.stringify({ event: "cas_usage_reconciliation", ...usage, summaryRepaired }));
      return { examined: usage.examined, failed: usage.failed };
    }).then(
      () => traceSession.end({ "unicas.outcome": "ok" }),
      (error) => {
        traceSession.end({ "unicas.outcome": "failed" });
        throw error;
      },
    ).finally(() => traceSession.flush()));
  },
} satisfies ExportedHandler<Env>;

async function handleFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  serviceRoute: ReturnType<typeof matchUniCasServiceRoute>,
  traceState: RequestTraceState,
  requestStartedAt: number,
): Promise<Response> {
  const requestStarted = performance.now();
  const url = new URL(request.url);
  const pathname = url.pathname;
  const routeOwner = publicRouteOwner(pathname);
  if (routeOwner && !isOwnedPublicOrigin(url, publicOriginFor(routeOwner, env))) {
    return new Response("Not Found", { status: 404 });
  }
  if (request.method === "GET" && pathname === "/") {
    return Response.redirect(new URL("/admin/", url), 302);
  }
  if (request.method === "GET" && pathname === "/health") {
    return Response.json({ ok: true, service: "unicas" });
  }
  if (isPrefixed(pathname, "/admin/stacks")) {
    return new Response("Not Found", { status: 404 });
  }
  const timing = new ServerTiming();
  const platform = platformFromEnv(env, timing, traceState);
  const auditReader = localAuditReader(env);
  const spaceVerifier = spaceVerifierFor(env, traceState.session);
  const actor = createUniCasService({
    platform,
    handleAppAdminRequest: async ({ request: adminRequest, route }) =>
      handleAppAdminCompatibilityRequest(
        stripAdminHeaders(adminRequest),
        route,
        await adminHandlerFor(env, traceState.session),
      ),
    authorizeSpaceRequest: async ({ request: spaceRequest, route }) => {
      const authorizationStartedAt = Date.now();
      try {
        const authorization = await timing.time("cas_auth", () => spaceVerifier.verify(
          dataPlaneAuthorizationRequest(spaceRequest), route,
        ));
        traceState.completedSpans.push({
          name: "unicas.capability.verify",
          attributes: { "unicas.operation": route.operation, "unicas.outcome": "ok" },
          startedAt: authorizationStartedAt,
          endedAt: Date.now(),
        });
        traceState.session = await requestTraceSession(
          request,
          env,
          serviceRoute,
          true,
          requestStartedAt,
          request.headers.get(InternalTraceContextHeader),
        );
        recordCompletedSpans(traceState);
        return authorization;
      } catch (error) {
        traceState.completedSpans.push({
          name: "unicas.capability.verify",
          attributes: {
            "unicas.operation": route.operation,
            "unicas.outcome": error instanceof CapabilityError ? "rejected" : "failed",
          },
          startedAt: authorizationStartedAt,
          endedAt: Date.now(),
        });
        if (!(error instanceof Error) || error.name === "Error") {
          logUnexpectedError({ event: "unicas_authorization_failed", plane: "space" }, error);
        }
        throw error;
      }
    },
  });

  if (serviceRoute) {
    if (serviceRoute.plane === "space") {
      await timing.time("cas_schema", () => ensureSpaceSchema(env));
    }
    try {
      const response = await actor.fetch(request);
      timing.record("cas_edge", performance.now() - requestStarted);
      return timing.decorate(response);
    } catch (error) {
      logUnexpectedError({ event: "unicas_service_actor_failed" }, error);
      throw error;
    }
  }

  if (isPrefixed(pathname, "/admin")) {
    return (await adminHandlerFor(env, traceState.session))(stripAdminHeaders(request));
  }

  if (pathname === "/mcp") {
    const origin = request.headers.get("Origin");
    const publicOrigin = env.MCP_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN;
    if (origin && origin !== publicOrigin) {
      return Response.json({ error: "MCP_ORIGIN_NOT_ALLOWED" }, { status: 403 });
    }
    return fetchMcp(stripHeaders(request, MCP_STRIPPED_HEADERS), env, auditReader, ctx, traceState.session!);
  }
  if (MCP_METADATA_PATHS.has(pathname)) {
    return fetchMcp(stripMcpMetadataHeaders(request), env, auditReader, ctx, traceState.session!);
  }
  if (MCP_BROWSER_PATHS.has(pathname)) {
    return fetchMcp(stripMcpBrowserHeaders(request), env, auditReader, ctx, traceState.session!);
  }
  if (MCP_TOKEN_PATHS.has(pathname)) {
    return fetchMcp(stripHeaders(request, MCP_STRIPPED_HEADERS), env, auditReader, ctx, traceState.session!);
  }
  return new Response("Not Found", { status: 404 });
}

async function requestTraceSession(
  request: Request,
  env: Env,
  serviceRoute: ReturnType<typeof matchUniCasServiceRoute>,
  authenticatedSpace: boolean,
  rootStartedAt: number,
  internalContext?: string | null,
): Promise<ManualTraceSession> {
  const isSpace = authenticatedSpace && serviceRoute?.plane === "space";
  return createConfiguredManualTraceSession({
    environment: env,
    requestedTraceId: isSpace ? request.headers.get(TraceIdHeader) : undefined,
    scope: isSpace
      ? { kind: "app", id: serviceRoute.route.appId }
      : { kind: "service", id: "unicas" },
    serviceName: "unicas",
    rootSpanName: "unicas.request",
    rootStartedAt,
    internalContext: isSpace ? internalContext : undefined,
    internalContextAudience: isSpace
      ? createInternalTraceAudience(
        "unicas_request",
        request.method,
        new URL(request.url).pathname,
      )
      : undefined,
    rootAttributes: {
      "unicas.operation": normalizedOperation(serviceRoute, new URL(request.url).pathname),
    },
  });
}

interface CompletedTraceSpan {
  readonly name: ManualSpanName;
  readonly attributes: Readonly<Record<string, ManualAttributeValue>>;
  readonly startedAt: number;
  readonly endedAt: number;
}

interface RequestTraceState {
  session: ManualTraceSession | undefined;
  readonly completedSpans: CompletedTraceSpan[];
}

async function ensureRequestTraceSession(
  state: RequestTraceState,
  request: Request,
  env: Env,
  serviceRoute: ReturnType<typeof matchUniCasServiceRoute>,
  rootStartedAt: number,
): Promise<ManualTraceSession> {
  state.session ??= await requestTraceSession(request, env, serviceRoute, false, rootStartedAt);
  recordCompletedSpans(state);
  return state.session;
}

function recordCompletedSpans(state: RequestTraceState): void {
  const record = state.session?.tracing.recordCompletedSpan;
  if (!record) return;
  for (const span of state.completedSpans.splice(0)) {
    record(span.name, span.attributes, span.startedAt, span.endedAt);
  }
}

function normalizedOperation(
  serviceRoute: ReturnType<typeof matchUniCasServiceRoute>,
  pathname: string,
): string {
  if (serviceRoute?.plane === "space") return `space_${serviceRoute.route.operation}`;
  if (serviceRoute?.plane === "app-admin") return `admin_${serviceRoute.route.operation}`;
  if (pathname === "/health") return "health";
  if (pathname === "/mcp") return "mcp";
  if (pathname.startsWith("/oauth/")) return "oauth";
  if (pathname.startsWith("/.well-known/")) return "metadata";
  if (pathname === "/") return "console_root";
  return "unknown";
}

function withTraceId(response: Response, traceId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(TraceIdHeader, traceId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

type PublicRouteOwner = "cas" | "mcp" | "admin";

function publicRouteOwner(pathname: string): PublicRouteOwner | null {
  if (pathname === "/" || isPrefixed(pathname, "/admin")) return "admin";
  if (
    pathname === "/mcp"
    || pathname.startsWith("/oauth/")
    || MCP_METADATA_PATHS.has(pathname)
  ) return "mcp";
  if (
    pathname === "/health"
    || pathname.startsWith("/v1/apps/")
    || pathname.startsWith("/.well-known/")
  ) return "cas";
  return null;
}

function publicOriginFor(owner: PublicRouteOwner, env: Env): string | undefined {
  if (owner === "admin") return env.ADMIN_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN;
  if (owner === "mcp") return env.MCP_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN;
  return env.CAS_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN;
}

function isOwnedPublicOrigin(requestUrl: URL, configuredOrigin: string | undefined): boolean {
  if (!configuredOrigin) return false;
  try {
    return requestUrl.origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}

const spaceVerifiers = new WeakMap<object, AppSpaceCapabilityVerifier>();
const controlSchemaInitializations = new WeakMap<object, Promise<void>>();
const spaceSchemaInitializations = new WeakMap<object, Promise<void>>();
const adminHandlers = new WeakMap<object, Promise<(request: Request) => Promise<Response>>>();

function ensureSpaceSchema(env: Pick<Env, "CAS_DB">): Promise<void> {
  const key = env.CAS_DB as object;
  let initialization = spaceSchemaInitializations.get(key);
  if (!initialization) {
    initialization = migrateAppSpaceSchema(env.CAS_DB);
    spaceSchemaInitializations.set(key, initialization);
    void initialization.catch(() => spaceSchemaInitializations.delete(key));
  }
  return initialization;
}

function ensureControlSchema(env: Env): Promise<void> {
  const key = env as object;
  let initialization = controlSchemaInitializations.get(key);
  if (!initialization) {
    initialization = migrateControlSchema(env.CAS_CONTROL_DB);
    controlSchemaInitializations.set(key, initialization);
    void initialization.catch(() => controlSchemaInitializations.delete(key));
  }
  return initialization;
}

function adminHandlerFor(
  env: Env,
  traceSession?: ManualTraceSession,
): Promise<(request: Request) => Promise<Response>> {
  if (traceSession?.sampled) return buildAdminHandler(env, traceSession.tracing);
  const key = env as object;
  let handler = adminHandlers.get(key);
  if (!handler) {
    handler = buildAdminHandler(env);
    adminHandlers.set(key, handler);
    void handler.catch(() => adminHandlers.delete(key));
  }
  return handler;
}

async function buildAdminHandler(
  env: Env,
  tracing?: TracingPort,
): Promise<(request: Request) => Promise<Response>> {
  await ensureControlSchema(env);
  const config = configFromEnv(env);
  const now = config.now ?? (() => Date.now());
  const accountRepository = new D1AccountRepository(env.CAS_CONTROL_DB);
  const platformInvitationRepository = new D1PlatformInvitationRepository(env.CAS_CONTROL_DB);
  const oauthDiscovery = new CloudflareOAuthDiscoveryPort({
    allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
    tracing,
  });
  return createAdminBff({
    config,
    sessionStore: new ControlSessionStore(env.CAS_CONTROL_DB, now),
    auditReader: localAuditReader(env),
    assets: uiAssets,
    platformInvitationRepository,
    peopleRepository: new D1PeopleRepository(env.CAS_CONTROL_DB),
    accountRepository,
    appUsageRepository: {
      async readAppUsage(appId) {
        await ensureSpaceSchema(env);
        return new CloudflareAppUsageRepository(env.CAS_DB).readAppUsage(appId);
      },
    },
    oauthDiscovery,
    identityProviderFetch: tracing
      ? tracedIdentityProviderFetch(tracing, [config.oidcDiscoveryUrl, config.microsoftDiscoveryUrl])
      : undefined,
    oauthResourcePublicOrigin: env.CAS_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN,
    emailChallengeRepository: new D1EmailChallengeRepository(env.CAS_CONTROL_DB),
    emailChallengeSender: env.EMAIL && config.emailFrom
      ? new CloudflareEmailChallengeSender(env.EMAIL, config.emailFrom)
      : undefined,
  });
}

function parseOriginAllowlist(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return [...new Set(value.split(",").map((origin) => origin.trim()).filter(Boolean))];
}

function spaceVerifierFor(env: Env, traceSession?: ManualTraceSession): AppSpaceCapabilityVerifier {
  if (traceSession?.sampled) return createSpaceVerifier(env, traceSession.tracing);
  const key = env as object;
  let verifier = spaceVerifiers.get(key);
  if (!verifier) {
    verifier = createSpaceVerifier(env);
    spaceVerifiers.set(key, verifier);
  }
  return verifier;
}

function createSpaceVerifier(env: Env, tracing?: TracingPort): AppSpaceCapabilityVerifier {
  const jwksPort = new CloudflareOAuthDiscoveryPort({
    allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
    tracing,
  });
  return new AppSpaceCapabilityVerifier({
    repository: new AppAuthorityRepository(env.CAS_CONTROL_DB),
    jwksFetcher: async (url, options) => {
      return new URL(url).protocol === "data:"
        ? fetch(url, options)
        : jwksPort.fetchJwks(url, options);
    },
    onEvent: (event) => {
      console.log(JSON.stringify({ event: "cas_app_authorization", ...event }));
    },
  });
}

function platformFromEnv(
  env: Env,
  timing?: TimingSink,
  traceState?: RequestTraceState,
): ServicePlatform {
  return {
    controlDatabase: env.CAS_CONTROL_DB as unknown as SqlDatabase,
    spaceDatabase: env.CAS_DB as unknown as SqlDatabase,
    blobs: env.CAS_R2 as unknown as BlobStore,
    spaceActors: keyedActorPort(env.CAS_DO, "space", env, timing, traceState),
    refDomainActors: keyedActorPort(
      env.CAS_DOMAIN_DO as unknown as DurableObjectNamespace,
      "root_ref_domain",
      env,
      timing,
      traceState,
    ),
  };
}

function keyedActorPort(
  namespace: DurableObjectNamespace,
  actorKind: "space" | "root_ref_domain",
  env: Env,
  timing?: TimingSink,
  traceState?: RequestTraceState,
): KeyedActorPort {
  return {
    fetch(key, request) {
      const traceSession = traceState?.session;
      const dispatch = () => traceSession
        ? traceSession.tracing.enterSpan("unicas.do.dispatch", async (span) => {
          span.setAttribute("unicas.actor.kind", actorKind);
          const headers = new Headers(request.headers);
          headers.delete(InternalTraceContextHeader);
          if (span.context) {
            const internalContext = await createInternalTraceContextHeader(
              span.context,
              env.UNICAS_TRACE_HMAC_KEYS,
              createInternalTraceAudience(
                actorKind === "space" ? "space_do" : "root_ref_domain_do",
                key,
                request.method,
                new URL(request.url).pathname,
              ),
            );
            if (internalContext) headers.set(InternalTraceContextHeader, internalContext);
          }
          try {
            const response = await namespace.get(namespace.idFromName(key)).fetch(
              new Request(request, { headers }),
            );
            span.setAttribute("unicas.outcome", response.status >= 500 ? "failed" : "ok");
            return response;
          } catch (error) {
            span.setAttribute("unicas.outcome", "failed");
            throw error;
          }
        })
        : namespace.get(namespace.idFromName(key)).fetch(request);
      return timing ? timing.time("cas_do", dispatch) : dispatch();
    },
  };
}

function localAuditReader(env: Env): Fetcher {
  return {
    async fetch(request, init) {
      const normalized = request instanceof Request
        ? new Request(request, init)
        : new Request(request.toString(), init);
      await ensureSpaceSchema(env);
      return handleAuditRpc(normalized, env, new URL(normalized.url));
    },
    connect() {
      throw new Error("UniCAS local audit reader does not support sockets");
    },
  };
}

/** Private audit-reader RPC. Requires the shared reader key; fail closed. */
async function handleAuditRpc(request: Request, env: Env, url: URL): Promise<Response> {
  const expectedKey = env.CAS_AUDIT_READER_KEY;
  if (!expectedKey || request.headers.get("X-CAS-Audit-Reader-Key") !== expectedKey) {
    return Response.json({ error: "Unknown CAS endpoint" }, { status: 404 });
  }
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const stackId = url.searchParams.get("stackId") ?? "";
  const refDomain = url.searchParams.get("refDomain") ?? "";
  try {
    if (url.pathname === "/_internal/audit/domains") {
      const domains = await listRootDomains({ db: env.CAS_DB, stackId });
      return Response.json({ domains }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/_internal/audit/refs") {
      const page = await listRootDomainRefs({
        db: env.CAS_DB,
        stackId,
        refDomain,
        tenantId: url.searchParams.get("tenantId") ?? undefined,
        limit: optionalNumber(url.searchParams.get("limit")),
        cursor: url.searchParams.get("cursor") ?? undefined,
      });
      return Response.json({ revision: page.revision, refs: page.refs, nextCursor: page.nextCursor }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const page = await listRootDomainEvents({
      db: env.CAS_DB,
      stackId,
      refDomain,
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      after: optionalNumber(url.searchParams.get("after")),
      limit: optionalNumber(url.searchParams.get("limit")),
    });
    return Response.json({ events: page.events, latestRevision: page.latestRevision, nextAfter: page.nextAfter }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuditReadError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return Response.json({ error: "SERVICE_UNAVAILABLE", message: "audit read failed" }, { status: 503 });
  }
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function fetchMcp(
  request: Request,
  env: Env,
  auditReader: Fetcher,
  ctx: ExecutionContext,
  traceSession: ManualTraceSession,
): Promise<Response> {
  await ensureControlSchema(env);
  const tracing = traceSession.sampled ? traceSession.tracing : undefined;
  const worker = createControlPlaneMcpWorker(
    mcpConfigFromEnv(env),
    env.CAS_CONTROL_DB,
    new CloudflareOAuthDiscoveryPort({
      allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
      tracing,
    }),
    env.CAS_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN,
    tracing
      ? tracedIdentityProviderFetch(tracing, [env.OIDC_DISCOVERY_URL, env.MICROSOFT_OIDC_DISCOVERY_URL])
      : undefined,
  );
  return worker.fetch(request, {
    ...env,
    CAS_TENANT_AUDIT_READER: auditReader,
  }, ctx);
}

function tracedIdentityProviderFetch(
  tracing: TracingPort,
  configuredDiscoveryUrls: readonly (string | undefined)[],
): typeof fetch {
  const discoveryUrls = new Set(configuredDiscoveryUrls.filter((value): value is string => Boolean(value)));
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const pathname = new URL(request.url).pathname;
    const peer = request.method === "POST"
      ? "oauth_token"
      : discoveryUrls.has(request.url)
        || pathname.endsWith("/.well-known/openid-configuration")
        || pathname.endsWith("/.well-known/oauth-authorization-server")
        ? "issuer_metadata"
        : "jwks";
    return traceFetchOperation(tracing, peer, () => fetch(request));
  }) as typeof fetch;
}

function isPrefixed(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function stripHeaders(request: Request, names: readonly string[]): Request {
  const headers = new Headers(request.headers);
  for (const name of names) headers.delete(name);
  return new Request(request, { headers });
}

function dataPlaneAuthorizationRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of DATA_PLANE_STRIPPED_HEADERS) headers.delete(name);
  return new Request(request.url, { method: request.method, headers });
}

function stripAdminHeaders(request: Request): Request {
  const sanitized = stripHeaders(request, ADMIN_STRIPPED_HEADERS);
  const headers = new Headers(sanitized.headers);
  const authorization = headers.get("Authorization");
  if (!authorization || !/^Basic\s+/i.test(authorization)) {
    headers.delete("Authorization");
  }
  return new Request(sanitized, { headers });
}

function stripMcpMetadataHeaders(request: Request): Request {
  const sanitized = stripHeaders(request, MCP_STRIPPED_HEADERS);
  const headers = new Headers(sanitized.headers);
  headers.delete("Authorization");
  return new Request(sanitized, { headers });
}

function stripMcpBrowserHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  const cookies = (headers.get("Cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => MCP_BROWSER_COOKIE_NAMES.has(cookie.split("=", 1)[0] ?? ""));
  headers.delete("Authorization");
  headers.delete("X-Internal-Token");
  headers.delete("X-Cas-Audit-Reader-Key");
  if (cookies.length > 0) headers.set("Cookie", cookies.join("; "));
  else headers.delete("Cookie");
  return new Request(request, { headers });
}

export { migrateAppSpaceSchema } from "./schema.js";

export { appCanonicalNodeKey, canonicalComposite, decodeComposite } from "./do-names.js";

export type {
  CanonicalRootRefsUpdate,
  DomainUpdateResult,
  DomainRetryOptions,
  RootRefsErrorCode,
} from "./root-refs.js";
export { RootRefsRetryableError, RootRefsValidationError } from "./root-refs.js";

export type {
  RootDomainBalanceRow,
  RootDomainEventRow,
  RootDomainEventsPage,
  RootDomainRefsPage,
} from "./audit-reads.js";
export { AuditReadError } from "./audit-reads.js";
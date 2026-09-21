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
  StackCapabilityVerifier,
  type BlobStore,
  type KeyedActorPort,
  type ServicePlatform,
  type SqlDatabase,
} from "@unicas/service";
import {
  AuditReadError,
  listRootDomainEvents,
  listRootDomainRefs,
  listRootDomains,
} from "./audit-reads.js";
import { AppAuthorityRepository, AuthorityRepository } from "./control-authority.js";
import { migrateControlSchema } from "./control-schema.js";
import { ControlSessionStore } from "./control-sessions.js";
import { D1PlatformInvitationRepository } from "./platform-invitation-repository.js";
import { D1PeopleRepository } from "./people-repository.js";
import { D1AccountRepository } from "./account-repository.js";
import { D1EmailChallengeRepository } from "./email-challenge-repository.js";
import { CloudflareEmailChallengeSender } from "./email-challenge-sender.js";
import { CloudflareOAuthDiscoveryPort } from "./oauth-discovery.js";
import {
  RootRefDomainDurableObject,
  type RootRefDomainDoEnv,
} from "./domain-do.js";
import { migrateAppSpaceSchema } from "./schema.js";
import { CasDurableObject, type SpaceCasDoEnv } from "./tenant-do.js";
import { ServerTiming, type TimingSink } from "./timing.js";

export { CasDurableObject, RootRefDomainDurableObject };

export interface TenantEnv extends SpaceCasDoEnv, RootRefDomainDoEnv {
  CAS_CONTROL_DB: D1Database;
  CAS_DO: DurableObjectNamespace;
  CAS_AUDIT_READER_KEY?: string;
}

export type Env = TenantEnv & AdminBffEnv & McpEnv & {
  CAS_PUBLIC_ORIGIN?: string;
  CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS?: string;
  CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE?: string;
};

const TENANT_STRIPPED_HEADERS = [
  "cookie",
  "x-internal-token",
  "x-cas-audit-reader-key",
] as const;

const ADMIN_STRIPPED_HEADERS = [
  "x-internal-token",
  "x-cas-audit-reader-key",
] as const;

const MCP_STRIPPED_HEADERS = [
  "cookie",
  "x-internal-token",
  "x-cas-audit-reader-key",
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
    const protectedResourceStackId = matchStackProtectedResourcePath(pathname);
    if (protectedResourceStackId !== null) {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
      await ensureControlSchema(env);
      return stackProtectedResourceMetadata(env, protectedResourceStackId);
    }
    const timing = new ServerTiming();
    const platform = platformFromEnv(env, timing);
    const auditReader = localAuditReader(env);
    const verifier = verifierFor(env);
    const spaceVerifier = spaceVerifierFor(env);
    const actor = createUniCasService({
      platform,
      authorizeTenantRequest: async ({ request: tenantRequest, route }) => {
        try {
          return await timing.time("cas_auth", () => verifier.verify(
            tenantAuthorizationRequest(tenantRequest), route,
          ));
        } catch (error) {
          if (!(error instanceof Error) || error.name === "Error") {
            console.error("Unexpected tenant authorization failure", error);
          }
          throw error;
        }
      },
      handleAppAdminRequest: async ({ request: adminRequest, route }) =>
        handleAppAdminCompatibilityRequest(
          stripAdminHeaders(adminRequest),
          route,
          await adminHandlerFor(env),
        ),
      authorizeSpaceRequest: async ({ request: spaceRequest, route }) => {
        try {
          return await timing.time("cas_auth", () => spaceVerifier.verify(
            tenantAuthorizationRequest(spaceRequest), route,
          ));
        } catch (error) {
          if (!(error instanceof Error) || error.name === "Error") {
            console.error("Unexpected Space authorization failure", error);
          }
          throw error;
        }
      },
    });

    const serviceRoute = matchUniCasServiceRoute(request);
    if (serviceRoute) {
      if (serviceRoute.plane === "tenant" || serviceRoute.plane === "space") {
        await timing.time("cas_schema", () => ensureTenantSchema(env));
      }
      try {
        const response = await actor.fetch(request);
        timing.record("cas_edge", performance.now() - requestStarted);
        return timing.decorate(response);
      } catch (error) {
        console.error("Unhandled UniCAS service actor failure", error);
        throw error;
      }
    }

    if (isPrefixed(pathname, "/admin")) {
      return (await adminHandlerFor(env))(stripAdminHeaders(request));
    }

    if (pathname === "/mcp") {
      const origin = request.headers.get("Origin");
      const publicOrigin = env.MCP_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN;
      if (origin && origin !== publicOrigin) {
        return Response.json({ error: "MCP_ORIGIN_NOT_ALLOWED" }, { status: 403 });
      }
      return fetchMcp(stripHeaders(request, MCP_STRIPPED_HEADERS), env, auditReader, ctx);
    }
    if (MCP_METADATA_PATHS.has(pathname)) {
      return fetchMcp(stripMcpMetadataHeaders(request), env, auditReader, ctx);
    }
    if (MCP_BROWSER_PATHS.has(pathname)) {
      return fetchMcp(stripMcpBrowserHeaders(request), env, auditReader, ctx);
    }
    if (MCP_TOKEN_PATHS.has(pathname)) {
      return fetchMcp(stripHeaders(request, MCP_STRIPPED_HEADERS), env, auditReader, ctx);
    }
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await ensureControlSchema(env);
      await new D1EmailChallengeRepository(env.CAS_CONTROL_DB).pruneExpired(Date.now());
      await new ControlSessionStore(env.CAS_CONTROL_DB).pruneExpired();
    })());
  },
} satisfies ExportedHandler<Env>;

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
    || pathname.startsWith("/stacks/")
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

function matchStackProtectedResourcePath(pathname: string): string | null {
  const match = /^\/\.well-known\/oauth-protected-resource\/stacks\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    const stackId = decodeURIComponent(match[1]!);
    return stackId.length > 0 ? stackId : null;
  } catch {
    return null;
  }
}

async function stackProtectedResourceMetadata(env: Env, stackId: string): Promise<Response> {
  const result = await env.CAS_CONTROL_DB.prepare(
    `SELECT issuer_record.issuer FROM cas_app_oauth_issuers AS issuer_record
     JOIN cas_apps AS app ON app.app_id = issuer_record.app_id
     WHERE issuer_record.app_id = ? AND issuer_record.status = 'active'
       AND issuer_record.mode = 'external' AND app.status = 'active'`,
  ).bind(stackId).all<{ issuer: string }>();
  const issuers = (result.results ?? []).map((row) => row.issuer);
  if (issuers.length === 0) return Response.json({ error: "OAUTH_ISSUER_NOT_ACTIVE" }, {
    status: 404,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
  const configuredOrigin = env.CAS_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN;
  if (!configuredOrigin) {
    return Response.json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, { status: 503 });
  }
  let origin: string;
  try {
    origin = new URL(configuredOrigin).origin;
  } catch {
    return Response.json({ error: "PUBLIC_ORIGIN_NOT_CONFIGURED" }, { status: 503 });
  }
  return Response.json({
    resource: `${origin}/stacks/${encodeURIComponent(stackId)}`,
    authorization_servers: issuers,
    scopes_supported: ["cas:read", "cas:write", "cas:manage"],
  }, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const verifiers = new WeakMap<object, StackCapabilityVerifier>();
const spaceVerifiers = new WeakMap<object, AppSpaceCapabilityVerifier>();
const controlSchemaInitializations = new WeakMap<object, Promise<void>>();
const tenantSchemaInitializations = new WeakMap<object, Promise<void>>();
const adminHandlers = new WeakMap<object, Promise<(request: Request) => Promise<Response>>>();

function ensureTenantSchema(env: Pick<Env, "CAS_DB">): Promise<void> {
  const key = env.CAS_DB as object;
  let initialization = tenantSchemaInitializations.get(key);
  if (!initialization) {
    initialization = migrateAppSpaceSchema(env.CAS_DB);
    tenantSchemaInitializations.set(key, initialization);
    void initialization.catch(() => tenantSchemaInitializations.delete(key));
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

function adminHandlerFor(env: Env): Promise<(request: Request) => Promise<Response>> {
  const key = env as object;
  let handler = adminHandlers.get(key);
  if (!handler) {
    handler = (async () => {
      await ensureControlSchema(env);
      const config = configFromEnv(env);
      const now = config.now ?? (() => Date.now());
      const accountRepository = new D1AccountRepository(env.CAS_CONTROL_DB);
      const platformInvitationRepository = new D1PlatformInvitationRepository(env.CAS_CONTROL_DB);
      const oauthDiscovery = new CloudflareOAuthDiscoveryPort({
        allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
      });
      return createAdminBff({
        config,
        sessionStore: new ControlSessionStore(env.CAS_CONTROL_DB, now),
        auditReader: localAuditReader(env),
        assets: uiAssets,
        platformInvitationRepository,
        peopleRepository: new D1PeopleRepository(env.CAS_CONTROL_DB),
        accountRepository,
        oauthDiscovery,
        oauthResourcePublicOrigin: env.CAS_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN,
        emailChallengeRepository: new D1EmailChallengeRepository(env.CAS_CONTROL_DB),
        emailChallengeSender: env.EMAIL && config.emailFrom
          ? new CloudflareEmailChallengeSender(env.EMAIL, config.emailFrom)
          : undefined,
      });
    })();
    adminHandlers.set(key, handler);
    void handler.catch(() => adminHandlers.delete(key));
  }
  return handler;
}

function parseOriginAllowlist(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return [...new Set(value.split(",").map((origin) => origin.trim()).filter(Boolean))];
}

function verifierFor(env: Env): StackCapabilityVerifier {
  const key = env as object;
  let verifier = verifiers.get(key);
  if (!verifier) {
    const jwksPort = new CloudflareOAuthDiscoveryPort({
      allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
    });
    verifier = new StackCapabilityVerifier({
      repository: new AuthorityRepository(env.CAS_CONTROL_DB),
      jwksFetcher: async (url, options) => {
        return new URL(url).protocol === "data:"
          ? fetch(url, options)
          : jwksPort.fetchJwks(url, options);
      },
      onEvent: (event) => {
        console.log(JSON.stringify({ event: "cas_stack_authorization", ...event }));
      },
    });
    verifiers.set(key, verifier);
  }
  return verifier;
}

function spaceVerifierFor(env: Env): AppSpaceCapabilityVerifier {
  const key = env as object;
  let verifier = spaceVerifiers.get(key);
  if (!verifier) {
    const jwksPort = new CloudflareOAuthDiscoveryPort({
      allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
    });
    verifier = new AppSpaceCapabilityVerifier({
      repository: new AppAuthorityRepository(env.CAS_CONTROL_DB),
      legacyV2IssuedBefore: parseLegacyV2IssuedBefore(
        env.CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE,
      ),
      jwksFetcher: async (url, options) => {
        return new URL(url).protocol === "data:"
          ? fetch(url, options)
          : jwksPort.fetchJwks(url, options);
      },
      onEvent: (event) => {
        console.log(JSON.stringify({ event: "cas_app_authorization", ...event }));
      },
    });
    spaceVerifiers.set(key, verifier);
  }
  return verifier;
}

function parseLegacyV2IssuedBefore(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(trimmed);
  if (!match) {
    throw new TypeError("CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE must be an RFC 3339 timestamp");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year === 0
    || month < 1 || month > 12
    || day < 1 || day > daysInMonth[month - 1]!
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
    || offsetSign === "-" && offsetHour === 0 && offsetMinute === 0
  ) {
    throw new TypeError("CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE must be an RFC 3339 timestamp");
  }
  const milliseconds = `${fractionText ?? ""}000`.slice(0, 3);
  const localTimestamp = Date.parse(
    `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.${milliseconds}Z`,
  );
  const offsetMs = (offsetHour * 60 + offsetMinute) * 60_000;
  const timestamp = localTimestamp + (offsetSign === "-" ? offsetMs : offsetSign === "+" ? -offsetMs : 0);
  if (!Number.isSafeInteger(timestamp)) {
    throw new TypeError("CAS_SPACE_CAPABILITY_V2_ISSUED_BEFORE must be an RFC 3339 timestamp");
  }
  return timestamp;
}

function platformFromEnv(env: Env, timing?: TimingSink): ServicePlatform {
  return {
    controlDatabase: env.CAS_CONTROL_DB as unknown as SqlDatabase,
    tenantDatabase: env.CAS_DB as unknown as SqlDatabase,
    blobs: env.CAS_R2 as unknown as BlobStore,
    tenantActors: keyedActorPort(env.CAS_DO, timing),
    refDomainActors: keyedActorPort(env.CAS_DOMAIN_DO as unknown as DurableObjectNamespace, timing),
  };
}

function keyedActorPort(namespace: DurableObjectNamespace, timing?: TimingSink): KeyedActorPort {
  return {
    fetch(key, request) {
      const dispatch = () => namespace.get(namespace.idFromName(key)).fetch(request);
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
      await ensureTenantSchema(env);
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
): Promise<Response> {
  await ensureControlSchema(env);
  const worker = createControlPlaneMcpWorker(
    mcpConfigFromEnv(env),
    env.CAS_CONTROL_DB,
    new CloudflareOAuthDiscoveryPort({
      allowedOrigins: parseOriginAllowlist(env.CAS_OAUTH_DISCOVERY_ALLOWED_ORIGINS),
    }),
    env.CAS_PUBLIC_ORIGIN ?? env.PUBLIC_ORIGIN,
  );
  return worker.fetch(request, {
    ...env,
    CAS_TENANT_AUDIT_READER: auditReader,
  }, ctx);
}

function isPrefixed(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function stripHeaders(request: Request, names: readonly string[]): Request {
  const headers = new Headers(request.headers);
  for (const name of names) headers.delete(name);
  return new Request(request, { headers });
}

function tenantAuthorizationRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of TENANT_STRIPPED_HEADERS) headers.delete(name);
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

export { StackCapabilityVerifier, permissionFor } from "@unicas/service";
export type { StackAuthEvent, VerifiedStackCall } from "@unicas/service";

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
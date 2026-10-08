import { CasClientError } from "@unicas/space-client";
import {
  issuerJwks,
  issuerMetadata,
  readSpacesConfig,
  SpacesConfigurationError,
  type SpacesConfig,
  type SpacesEnv,
} from "./config.js";
import { sha256Hex } from "./crypto.js";
import { FileRootConflictError } from "./file-root-catalog.js";
import {
  childPath,
  createSpacesFileService,
  FileServiceError,
  type SpacesFileService,
} from "./file-service.js";
import { GoogleAuthError, GoogleOidcClient } from "./google-oidc.js";
import {
  OAuthStateCookieName,
  SessionCookieName,
  appendSetCookies,
  clearOAuthStateCookie,
  clearSessionCookies,
  oauthStateCookie,
  parseCookies,
  passesMutationProtection,
  sessionCookies,
} from "./http.js";
import { SpacesRepository, type AuthenticatedSession, type PrincipalContext } from "./repository.js";
import { verifySmokeIsolation, type IsolationEvidence } from "./smoke-probe.js";
import { logSpacesEvent, traceCleanupRun } from "./observability.js";
import {
  createConfiguredManualTraceSession,
  createInternalTraceAudience,
  createInternalTraceContextHeader,
  InternalTraceContextHeader,
  TraceIdHeader,
  type ManualTraceSpan,
  type ManualTraceSession,
} from "@unicas/observability";

type FileServicePort = Pick<SpacesFileService,
  "list" | "createFolder" | "uploadFile" | "renameFile" | "deleteFile" | "download"
  | "cleanupPaths" | "ensureSmokeRoot" | "releaseSmokeRoot" | "reconcilePendingReleases">;

interface GoogleClientPort {
  begin(repository: SpacesRepository): Promise<{ readonly redirectUrl: string; readonly state: string }>;
  complete(input: {
    readonly repository: SpacesRepository;
    readonly state: string;
    readonly stateCookie: string;
    readonly code: string;
  }): Promise<PrincipalContext>;
}

export interface SpacesWorkerDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly createTraceSession?: typeof createConfiguredManualTraceSession;
  readonly createFileService?: (input: Parameters<typeof createSpacesFileService>[0]) => Promise<FileServicePort>;
  readonly createGoogleClient?: (config: SpacesConfig["google"], fetchImpl: typeof fetch) => GoogleClientPort;
  readonly verifyIsolation?: (input: {
    readonly capability: SpacesConfig["capability"];
    readonly principal: PrincipalContext;
    readonly fetchImpl: typeof fetch;
  }) => Promise<IsolationEvidence>;
}

export interface SpacesWorker {
  fetch(
    request: Request,
    env: SpacesEnv,
    context?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response>;
  scheduled(
    controller: unknown,
    env: SpacesEnv,
    context: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

const MaximumMultipartOverheadBytes = 64 * 1024;

export function createSpacesWorker(dependencies: SpacesWorkerDependencies = {}): SpacesWorker {
  const dependencyFetch = dependencies.fetchImpl;
  const fetchImpl: typeof fetch = dependencyFetch
    ? ((input, init) => dependencyFetch(input, init))
    : globalThis.fetch.bind(globalThis);
  const fileServiceFactory = dependencies.createFileService ?? createSpacesFileService;
  const traceSessionFactory = dependencies.createTraceSession ?? createConfiguredManualTraceSession;
  const googleClientFactory = dependencies.createGoogleClient
    ?? ((config, providerFetch) => new GoogleOidcClient(config, providerFetch));
  const isolationProbe = dependencies.verifyIsolation ?? verifySmokeIsolation;

  return {
    async fetch(request, env, context): Promise<Response> {
      const url = new URL(request.url);
      if (!isReservedPath(url.pathname)) return env.ASSETS.fetch(request);
      const correlationId = request.headers.get("X-Request-Id") || crypto.randomUUID();
      let traceSession: ManualTraceSession | undefined;
      try {
        const config = readSpacesConfig(env);
        const repository = new SpacesRepository(env.SPACES_DB);

        if (isUnauthenticatedSpacesRoute(request.method, url.pathname)) {
          traceSession = await traceSessionFactory({
            environment: env,
            scope: { kind: "service", id: "unicas-spaces" },
            serviceName: "unicas-spaces",
            rootSpanName: "spaces.request",
            rootAttributes: { "unicas.operation": spacesOperation(request.method, url.pathname) },
          });
          const finish = (response: Response) => finishSpacesTrace(response, traceSession!, context);
          const providerFetch = traceAwareProviderFetch(
            fetchImpl,
            config.google.discoveryUrl,
            traceSession,
          );
          if (url.pathname === "/.well-known/openid-configuration") {
            return finish(json(issuerMetadata(config), 200));
          }
          if (url.pathname === "/.well-known/jwks.json") {
            return finish(json(issuerJwks(config), 200, { "Cache-Control": "public, max-age=300" }));
          }
          if (url.pathname === "/auth/google/start") {
            const authorization = await googleClientFactory(config.google, providerFetch).begin(repository);
            return finish(appendSetCookies(Response.redirect(authorization.redirectUrl, 302), [
              oauthStateCookie(authorization.state, 600, config.secureCookies),
            ]));
          }
          if (url.pathname === "/auth/google/callback") {
            return finish(await completeGoogleLogin(
              request,
              config,
              repository,
              googleClientFactory(config.google, providerFetch),
            ));
          }
          return finish(await createSmokeSession(
            request,
            env,
            config,
            repository,
            fileServiceFactory,
            traceAwareUniCasFetch(
              fetchImpl,
              config.capability.unicasBaseUrl,
              traceSession,
              env.UNICAS_TRACE_HMAC_KEYS,
            ),
          ));
        }

        const session = await requireSession(request, repository);
        traceSession = await traceSessionFactory({
          environment: env,
          requestedTraceId: request.headers.get(TraceIdHeader),
          scope: { kind: "app", id: session.context.appId },
          serviceName: "unicas-spaces",
          rootSpanName: "spaces.request",
          rootAttributes: { "unicas.operation": spacesOperation(request.method, url.pathname) },
        });
        const finish = (response: Response) => finishSpacesTrace(response, traceSession!, context);
        const tracedFetch = traceAwareUniCasFetch(
          fetchImpl,
          config.capability.unicasBaseUrl,
          traceSession,
          env.UNICAS_TRACE_HMAC_KEYS,
        );
        if (request.method === "POST" && url.pathname === "/auth/logout") {
          if (!await passesMutationProtection(request, config.publicOrigin, session, repository)) {
            throw new HttpError("csrf_origin_failed", 403, "Origin or CSRF check failed");
          }
          const sessionId = parseCookies(request)[SessionCookieName];
          if (sessionId) await repository.deleteSession(sessionId);
          return finish(appendSetCookies(
            new Response(null, { status: 204 }),
            clearSessionCookies(config.secureCookies),
          ));
        }
        if (request.method === "GET" && url.pathname === "/api/session") {
          return finish(json({
            principal: {
              id: session.context.principalId,
              displayName: session.context.displayName,
              provider: session.context.provider,
            },
          }, 200));
        }

        if (isMutating(request.method)
          && !await passesMutationProtection(request, config.publicOrigin, session, repository)) {
          throw new HttpError("csrf_origin_failed", 403, "Origin or CSRF check failed");
        }

        const fileService = await fileServiceFactory({
          db: env.SPACES_DB,
          principal: session.context,
          capability: config.capability,
          access: request.method === "GET" ? ["read"] : ["read", "write"],
          maximumUploadBytes: config.maximumUploadBytes,
          fetcher: { fetch: tracedFetch },
        });
        if (request.method === "GET" && url.pathname === "/api/entries") {
          return finish(json(await fileService.list(url.searchParams.get("path") ?? "/"), 200));
        }
        if (request.method === "GET" && url.pathname === "/api/files/content") {
          const file = await fileService.download(requiredQuery(url, "path"), request.signal);
          return finish(new Response(file.body, {
            headers: {
              "Cache-Control": "private, no-store",
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.stat.name)}`,
              "Content-Length": String(file.stat.size ?? 0),
              "Content-Type": file.stat.mediaType ?? "application/octet-stream",
              "X-Content-Type-Options": "nosniff",
            },
          }));
        }
        if (request.method === "POST" && url.pathname === "/api/smoke/cleanup") {
          const body = await readJsonBody(request);
          const runId = requireBodyString(body, "runId");
          const state = await executeSmokeCleanup(repository, fileService, runId, session.context.principalId);
          if (state === null) throw new HttpError("smoke_run_not_found", 404, "Smoke run not found");
          return finish(json({ runId, cleanupState: "complete" }, 200));
        }
        if (request.method === "POST" && url.pathname === "/api/smoke/isolation") {
          await requireActiveSmokeRun(request, repository, session.context.principalId);
          return finish(json(await isolationProbe({
            capability: config.capability,
            principal: session.context,
            fetchImpl: tracedFetch,
          }), 200));
        }
        if (request.method === "POST" && url.pathname === "/api/folders") {
          const body = await readJsonBody(request);
          const parentPath = requireBodyString(body, "parentPath");
          const name = requireBodyString(body, "name");
          await trackSmokePath(request, repository, session, childPath(parentPath, name));
          const result = await fileService.createFolder({
            parentPath,
            name,
            revision: requireBodyRevision(body),
          });
          return finish(json(publicMutation(result), 201));
        }
        if (request.method === "POST" && url.pathname === "/api/files") {
          const contentType = request.headers.get("Content-Type") ?? "";
          if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
            throw new HttpError("invalid_request", 400, "Upload must use multipart/form-data");
          }
          const contentLength = request.headers.get("Content-Length");
          if (contentLength === null) {
            throw new HttpError("upload_length_required", 411, "A bounded Content-Length is required");
          }
          const declaredLength = Number(contentLength);
          if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
            throw new HttpError("invalid_request", 400, "Content-Length must be a positive integer");
          }
          if (declaredLength > config.maximumUploadBytes + MaximumMultipartOverheadBytes) {
            throw new FileServiceError("file_too_large", 413, "Multipart upload exceeds the configured limit");
          }
          const body = await request.formData();
          const content = body.get("file");
          if (!(content instanceof Blob)) throw new HttpError("invalid_request", 400, "A file is required");
          const suppliedName = body.get("name");
          const parentPath = requireFormString(body, "parentPath");
          const name = typeof suppliedName === "string" && suppliedName.length > 0
            ? suppliedName
            : "name" in content && typeof content.name === "string" ? content.name : "upload.bin";
          await trackSmokePath(request, repository, session, childPath(parentPath, name));
          const result = await fileService.uploadFile({
            parentPath,
            name,
            contentType: content.type,
            content,
            revision: parseRevision(requireFormString(body, "revision")),
            signal: request.signal,
          });
          return finish(json(
            publicMutation(result, request.headers.has("X-Spaces-Smoke-Run")),
            201,
          ));
        }
        if (request.method === "PATCH" && url.pathname === "/api/files") {
          const body = await readJsonBody(request);
          return finish(json(publicMutation(await fileService.renameFile({
            path: requireBodyString(body, "path"),
            name: requireBodyString(body, "name"),
            revision: requireBodyRevision(body),
          })), 200));
        }
        if (request.method === "DELETE" && url.pathname === "/api/files") {
          await fileService.deleteFile({
            path: requiredQuery(url, "path"),
            revision: parseRevision(requiredQuery(url, "revision")),
          });
          return finish(new Response(null, { status: 204 }));
        }
        return finish(errorResponse("not_found", 404, "Route not found", correlationId));
      } catch (error) {
        const response = mapError(error, correlationId);
        logSpacesEvent({
          event: "spaces_request_failed",
          code: response.code,
          status: response.status,
        });
        const errorResult = errorResponse(response.code, response.status, response.message, correlationId);
        return traceSession
          ? finishSpacesTrace(errorResult, traceSession, context)
          : errorResult;
      }
    },

    async scheduled(_controller, env, context): Promise<void> {
      const traceSession = await traceSessionFactory({
        environment: env,
        scope: { kind: "service", id: "unicas-spaces" },
        serviceName: "unicas-spaces",
        rootSpanName: "spaces.request",
        rootAttributes: { "unicas.operation": "scheduled_cleanup" },
      });
      context.waitUntil(traceCleanupRun(traceSession.tracing, async () => {
        const config = readSpacesConfig(env);
        const repository = new SpacesRepository(env.SPACES_DB);
        await repository.pruneExpired();
        let examined = 0;
        let failed = 0;
        const pendingPrincipals = await repository.listPendingReleasePrincipals(10);
        examined += pendingPrincipals.length;
        for (const principal of pendingPrincipals) {
          try {
            const fileService = await fileServiceFactory({
              db: env.SPACES_DB,
              principal,
              capability: config.capability,
              access: ["read", "write"],
              maximumUploadBytes: config.maximumUploadBytes,
              fetcher: {
                fetch: traceAwareUniCasFetch(
                  fetchImpl,
                  config.capability.unicasBaseUrl,
                  traceSession,
                  env.UNICAS_TRACE_HMAC_KEYS,
                ),
              },
            });
            await fileService.reconcilePendingReleases(20);
          } catch {
            failed += 1;
            logSpacesEvent({
              event: "spaces_root_release_reconciliation_failed",
              code: "root_release_pending",
            });
          }
        }
        const expiredRuns = await repository.listExpiredSmokeRuns(10);
        examined += expiredRuns.length;
        for (const run of expiredRuns) {
          try {
            const principal = await repository.readPrincipal(run.principalId);
            if (!principal) throw new Error("Smoke Principal not found");
            const fileService = await fileServiceFactory({
              db: env.SPACES_DB,
              principal,
              capability: config.capability,
              access: ["read", "write"],
              maximumUploadBytes: config.maximumUploadBytes,
              fetcher: {
                fetch: traceAwareUniCasFetch(
                  fetchImpl,
                  config.capability.unicasBaseUrl,
                  traceSession,
                  env.UNICAS_TRACE_HMAC_KEYS,
                ),
              },
            });
            await executeSmokeCleanup(repository, fileService, run.runId, run.principalId);
          } catch {
            failed += 1;
            await repository.failSmokeCleanup(run.runId, run.principalId);
            logSpacesEvent({
              event: "spaces_smoke_cleanup_failed",
              stage: "cleanup",
              code: "cleanup_failed",
            });
          }
        }
        return { examined, failed };
      }).then(
        () => traceSession.end({ "unicas.outcome": "ok" }),
        (error) => {
          traceSession.end({ "unicas.outcome": "failed" });
          throw error;
        },
      ).finally(() => traceSession.flush()));
    },
  };
}

function finishSpacesTrace(
  response: Response,
  session: ManualTraceSession,
  context: { waitUntil(promise: Promise<unknown>): void } | undefined,
): Response {
  session.end({
    "unicas.outcome": response.status >= 500 ? "failed" : response.status >= 400 ? "rejected" : "ok",
    "unicas.http.status_class": `${Math.floor(response.status / 100)}xx`,
  });
  const flushing = session.flush();
  if (context) context.waitUntil(flushing);
  else void flushing;
  const headers = new Headers(response.headers);
  headers.set(TraceIdHeader, session.correlationUlid);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function traceAwareUniCasFetch(
  fetchImpl: typeof fetch,
  unicasBaseUrl: string,
  traceSession: ManualTraceSession,
  traceHmacKeys: string | undefined,
): typeof fetch {
  const unicasOrigin = new URL(unicasBaseUrl).origin;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const targetsUniCas = new URL(request.url).origin === unicasOrigin;
    const headers = withoutTraceHeaders(request.headers);
    if (!targetsUniCas) {
      return traceFetch(traceSession, "r2_upload", new Request(request, { headers }), fetchImpl);
    }
    return traceSession.tracing.enterSpan("unicas.fetch", async (span) => {
      span.setAttribute("unicas.peer", "unicas_api");
      headers.set(TraceIdHeader, traceSession.correlationUlid);
      const internalContext = span.context
        ? await createInternalTraceContextHeader(
          span.context,
          traceHmacKeys,
          createInternalTraceAudience(
            "unicas_request",
            request.method,
            new URL(request.url).pathname,
          ),
        ).catch(() => null)
        : null;
      if (internalContext) headers.set(InternalTraceContextHeader, internalContext);
      return finishTracedFetch(span, new Request(request, { headers }), fetchImpl);
    });
  }) as typeof fetch;
}

function traceAwareProviderFetch(
  fetchImpl: typeof fetch,
  discoveryUrl: string,
  traceSession: ManualTraceSession,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const peer = request.url === discoveryUrl
      ? "issuer_metadata"
      : request.method === "POST" ? "oauth_token" : "jwks";
    return traceFetch(traceSession, peer, request, fetchImpl);
  }) as typeof fetch;
}

function traceFetch(
  traceSession: ManualTraceSession,
  peer: "issuer_metadata" | "jwks" | "oauth_token" | "unicas_api" | "r2_upload",
  request: Request,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return traceSession.tracing.enterSpan("unicas.fetch", async (span) => {
    span.setAttribute("unicas.peer", peer);
    return finishTracedFetch(span, request, fetchImpl);
  });
}

async function finishTracedFetch(
  span: ManualTraceSpan,
  request: Request,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    const response = await fetchImpl(request);
    span.setAttribute("unicas.http.status_class", `${Math.floor(response.status / 100)}xx`);
    span.setAttribute(
      "unicas.outcome",
      response.status >= 500 ? "failed" : response.status >= 400 ? "rejected" : "ok",
    );
    return response;
  } catch (error) {
    span.setAttribute("unicas.outcome", "failed");
    throw error;
  }
}

function withoutTraceHeaders(headers: HeadersInit): Headers {
  const sanitized = new Headers(headers);
  sanitized.delete(TraceIdHeader);
  sanitized.delete(InternalTraceContextHeader);
  return sanitized;
}

function spacesOperation(method: string, pathname: string): string {
  if (pathname === "/.well-known/openid-configuration") return "issuer_metadata";
  if (pathname === "/.well-known/jwks.json") return "issuer_jwks";
  if (pathname === "/auth/google/start") return "oauth_start";
  if (pathname === "/auth/google/callback") return "oauth_callback";
  if (pathname === "/api/smoke/session") return "smoke_session";
  if (pathname === "/api/session") return "session_read";
  if (pathname === "/auth/logout") return "session_logout";
  if (pathname.startsWith("/api/smoke/")) return "smoke";
  if (pathname === "/api/entries") return "entries_list";
  if (pathname === "/api/files/content") return "file_download";
  if (pathname === "/api/files" && method === "POST") return "file_upload";
  if (pathname === "/api/files" && method === "PATCH") return "file_rename";
  if (pathname === "/api/files" && method === "DELETE") return "file_delete";
  if (pathname === "/api/folders") return "folder_create";
  return "unknown";
}

function isUnauthenticatedSpacesRoute(method: string, pathname: string): boolean {
  return (method === "GET" && (
    pathname === "/.well-known/openid-configuration"
    || pathname === "/.well-known/jwks.json"
    || pathname === "/auth/google/start"
    || pathname === "/auth/google/callback"
  )) || (method === "POST" && pathname === "/api/smoke/session");
}

async function completeGoogleLogin(
  request: Request,
  config: SpacesConfig,
  repository: SpacesRepository,
  google: GoogleClientPort,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const stateCookie = parseCookies(request)[OAuthStateCookieName] ?? "";
  try {
    if (!state || !code || !stateCookie) throw new GoogleAuthError("auth_invalid", 401);
    const principal = await google.complete({ repository, state, stateCookie, code });
    const session = await repository.createSession(principal.principalId, config.sessionTtlMs);
    return appendSetCookies(Response.redirect(`${config.publicOrigin}/files`, 303), [
      ...sessionCookies(session.sessionId, session.csrfToken, Math.floor(config.sessionTtlMs / 1000), config.secureCookies),
      clearOAuthStateCookie(config.secureCookies),
    ]);
  } catch (error) {
    const code = error instanceof GoogleAuthError ? error.code : "auth_invalid";
    return appendSetCookies(Response.redirect(`${config.publicOrigin}/login?error=${code}`, 303), [
      clearOAuthStateCookie(config.secureCookies),
    ]);
  }
}

async function createSmokeSession(
  request: Request,
  env: SpacesEnv,
  config: SpacesConfig,
  repository: SpacesRepository,
  fileServiceFactory: NonNullable<SpacesWorkerDependencies["createFileService"]>,
  fetchImpl: typeof fetch,
): Promise<Response> {
  if (!config.smoke.enabled) throw new HttpError("smoke_disabled", 404, "Smoke authentication is disabled");
  if (!config.smoke.credential || !config.smoke.principalId) {
    throw new HttpError("smoke_unavailable", 503, "Smoke authentication is unavailable");
  }
  const authorization = request.headers.get("Authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || await sha256Hex(supplied) !== await sha256Hex(config.smoke.credential)) {
    throw new HttpError("smoke_credential_invalid", 401, "Smoke credential is invalid");
  }
  const principal = await repository.readPrincipal(config.smoke.principalId);
  if (!principal || principal.status !== "active") {
    throw new HttpError("smoke_principal_unavailable", 503, "Smoke Principal is unavailable");
  }
  if (principal.provider !== "smoke") {
    throw new HttpError("smoke_principal_invalid", 503, "Smoke Principal must not have an external identity");
  }
  const lifetimeMs = Math.min(config.sessionTtlMs, 15 * 60 * 1000);
  const fileService = await fileServiceFactory({
    db: env.SPACES_DB,
    principal,
    capability: config.capability,
    access: ["read", "write"],
    maximumUploadBytes: config.maximumUploadBytes,
    fetcher: { fetch: fetchImpl },
  });
  for (const recoverable of await repository.listRecoverableSmokeRuns(principal.principalId)) {
    await executeSmokeCleanup(repository, fileService, recoverable.runId, principal.principalId);
  }
  if (await repository.hasActiveSmokeRun(principal.principalId)) {
    throw new HttpError("smoke_run_active", 409, "Another smoke run is active");
  }
  const run = await repository.createSmokeRun(principal.principalId, lifetimeMs);
  try {
    await fileService.ensureSmokeRoot();
  } catch (error) {
    await repository.failSmokeCleanup(run.runId, principal.principalId);
    throw error;
  }
  const session = await repository.createSession(principal.principalId, lifetimeMs);
  return appendSetCookies(
    json({ runId: run.runId, expiresAt: run.expiresAt }, 201),
    sessionCookies(session.sessionId, session.csrfToken, Math.floor(lifetimeMs / 1000), config.secureCookies),
  );
}

async function requireSession(request: Request, repository: SpacesRepository): Promise<AuthenticatedSession> {
  const sessionId = parseCookies(request)[SessionCookieName];
  if (!sessionId) throw new HttpError("session_required", 401, "Sign in is required");
  const session = await repository.readSession(sessionId);
  if (!session) throw new HttpError("session_required", 401, "Sign in is required");
  if (session.context.status !== "active") {
    throw new HttpError("principal_suspended", 403, "This Principal is suspended");
  }
  return session;
}

async function trackSmokePath(
  request: Request,
  repository: SpacesRepository,
  session: AuthenticatedSession,
  path: string,
): Promise<void> {
  const runId = request.headers.get("X-Spaces-Smoke-Run");
  if (!runId) return;
  if (!await repository.trackSmokeResource({
    runId,
    principalId: session.context.principalId,
    absolutePath: path,
  })) {
    throw new HttpError("smoke_run_invalid", 409, "Smoke run is absent, expired, or inactive");
  }
}

async function requireActiveSmokeRun(
  request: Request,
  repository: SpacesRepository,
  principalId: string,
): Promise<string> {
  const runId = request.headers.get("X-Spaces-Smoke-Run");
  if (!runId || !await repository.isActiveSmokeRun(runId, principalId)) {
    throw new HttpError("smoke_run_invalid", 409, "Smoke run is absent, expired, or inactive");
  }
  return runId;
}

async function executeSmokeCleanup(
  repository: SpacesRepository,
  fileService: Pick<SpacesFileService, "cleanupPaths" | "releaseSmokeRoot">,
  runId: string,
  principalId: string,
): Promise<"complete" | null> {
  const plan = await repository.prepareSmokeCleanup(runId, principalId);
  if (!plan) return null;
  if (plan.state === "complete") return "complete";
  try {
    if (plan.rootId !== null) {
      await fileService.cleanupPaths(plan.paths);
      await fileService.releaseSmokeRoot(runId);
    }
    await repository.completeSmokeCleanup(runId, principalId);
    return "complete";
  } catch (error) {
    await repository.failSmokeCleanup(runId, principalId);
    throw error;
  }
}

function publicMutation(result: {
  readonly revision: number;
  readonly rootRetained: true;
  readonly entry?: unknown;
  readonly uploadEvidence?: unknown;
}, includeUploadEvidence = false): Readonly<Record<string, unknown>> {
  return {
    revision: result.revision,
    rootRetained: result.rootRetained,
    ...(result.entry ? { entry: result.entry } : {}),
    ...(includeUploadEvidence && result.uploadEvidence ? { uploadEvidence: result.uploadEvidence } : {}),
  };
}

function isReservedPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
    || pathname === "/auth" || pathname.startsWith("/auth/")
    || pathname === "/.well-known" || pathname.startsWith("/.well-known/")
    || pathname === "/oauth" || pathname.startsWith("/oauth/");
}

function isMutating(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
    throw new HttpError("invalid_request", 400, "JSON request is too large");
  }
  try {
    const text = await request.text();
    if (text.length > 16 * 1024) throw new Error("too large");
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError("invalid_request", 400, "Request body must be a JSON object");
  }
}

function requireBodyString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string") throw new HttpError("invalid_request", 400, `${name} must be a string`);
  return value;
}

function requireBodyRevision(body: Record<string, unknown>): number {
  const revision = body.revision;
  if (!Number.isSafeInteger(revision)) throw new HttpError("invalid_request", 400, "revision must be an integer");
  return revision as number;
}

function requireFormString(body: FormData, name: string): string {
  const value = body.get(name);
  if (typeof value !== "string") throw new HttpError("invalid_request", 400, `${name} is required`);
  return value;
}

function requiredQuery(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (value === null) throw new HttpError("invalid_request", 400, `${name} is required`);
  return value;
}

function parseRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) throw new HttpError("invalid_request", 400, "revision must be an integer");
  return revision;
}

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("Cache-Control")) responseHeaders.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

function errorResponse(code: string, status: number, message: string, correlationId: string): Response {
  return json({ error: { code, message, correlationId } }, status);
}

function mapError(error: unknown, correlationId: string): { code: string; status: number; message: string } {
  if (error instanceof HttpError || error instanceof FileServiceError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  if (error instanceof FileRootConflictError) {
    return { code: error.code, status: 409, message: error.message };
  }
  if (error instanceof CasClientError) {
    return {
      code: "unicas_request_failed",
      status: error.status >= 400 && error.status < 600 ? error.status : 502,
      message: "UniCAS request failed",
    };
  }
  if (error instanceof SpacesConfigurationError) {
    return { code: error.code, status: 503, message: "Spaces is not configured" };
  }
  if (error instanceof TypeError) {
    if (error.message.startsWith("Path not found")) {
      return { code: "path_not_found", status: 404, message: error.message };
    }
    if (error.message.startsWith("Path already exists")) {
      return { code: "name_conflict", status: 409, message: error.message };
    }
    return { code: "invalid_request", status: 400, message: error.message };
  }
  return { code: "internal_error", status: 500, message: `Request failed; contact support with ${correlationId}` };
}

export default createSpacesWorker();
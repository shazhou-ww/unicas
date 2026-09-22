/**
 * Root Ref domain Durable Object — the single writer for one
 * `(appId, refDomain)` event log.
 *
 * Serializes writes from different Spaces in the same domain and executes the
 * atomic D1 transaction (idempotency, revision allocation, aggregate updates,
 * event append, projection update, idempotency insert). Receives ONLY the
 * canonical command forwarded by the CAS DO; never accepts identity headers
 * from an external caller. Domain DOs never call CAS DOs, so lock ordering
 * cannot cycle.
 */

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { canonicalizeRootRefsUpdate, executeDomainUpdate, withDomainRetry } from "./root-refs.js";
import { canonicalComposite } from "./do-names.js";
import { RootRefsErrorCodes, RootRefsValidationError } from "./root-refs.js";
import { traceRootRefCommit } from "./observability.js";
import { scheduleTraceFlush } from "./runtime-tracing.js";
import {
  createConfiguredManualTraceContinuation,
  createInternalTraceAudience,
  InternalTraceContextHeader,
  type ManualTraceEnvironment,
  type ManualTraceSession,
} from "@unicas/observability";

export interface RootRefDomainDoEnv extends ManualTraceEnvironment {
  CAS_DB: D1Database;
  CAS_R2: R2Bucket;
  /** Test/ops override for the retry attempt bound. */
  CAS_RETRY_MAX_ATTEMPTS?: string;
}

export class RootRefDomainDurableObject {
  readonly #env: RootRefDomainDoEnv;

  constructor(_state: DurableObjectState, env: RootRefDomainDoEnv) {
    this.#env = env;
  }

  async fetch(request: Request): Promise<Response> {
    let appId: string;
    let spaceId: string;
    let refDomain: string;
    try {
      appId = requireHeader(request, "X-CAS-App-Id");
      spaceId = requireHeader(request, "X-CAS-Space-Id");
      refDomain = requireHeader(request, "X-CAS-Ref-Domain");
    } catch (error) {
      if (error instanceof RootRefsValidationError) {
        return errorResponse(error.status, error.code, error.message);
      }
      return errorResponse(400, RootRefsErrorCodes.INVALID_REQUEST, "domain command headers are invalid");
    }
    const traceSession = await createConfiguredManualTraceContinuation({
      environment: this.#env,
      internalContext: request.headers.get(InternalTraceContextHeader),
      internalContextAudience: createInternalTraceAudience(
        "root_ref_domain_do",
        canonicalComposite(appId, refDomain),
        request.method,
        new URL(request.url).pathname,
      ),
      serviceName: "unicas",
    });
    let body: { requestId?: unknown; changes?: unknown };
    try {
      body = (await request.json()) as { requestId?: unknown; changes?: unknown };
    } catch {
      return finishDomainTrace(
        errorResponse(400, RootRefsErrorCodes.INVALID_REQUEST, "domain command body is not valid JSON"),
        traceSession,
      );
    }
    try {
      const canonical = await canonicalizeRootRefsUpdate({
        requestId: body.requestId,
        changes: body.changes,
        refDomain,
      });
      let retryCount = 0;
      const result = await traceRootRefCommit(traceSession.tracing, canonical.entries.length, () =>
        withDomainRetry(
          () => executeDomainUpdate({
            db: this.#env.CAS_DB,
            bucket: this.#env.CAS_R2,
            appId: appId,
            spaceId: spaceId,
            refDomain,
            canonical,
          }),
          {
            maxAttempts: parseMaxAttempts(this.#env.CAS_RETRY_MAX_ATTEMPTS),
            onRetry: () => { retryCount += 1; },
          },
        ),
        () => retryCount);
      return finishDomainTrace(
        Response.json({ success: true, idempotent: result.idempotent, revision: result.revision }),
        traceSession,
      );
    } catch (error) {
      if (error instanceof RootRefsValidationError) {
        return finishDomainTrace(errorResponse(error.status, error.code, error.message), traceSession);
      }
      return finishDomainTrace(
        errorResponse(503, RootRefsErrorCodes.BUSY, "root refs update failed"),
        traceSession,
      );
    }
  }
}

function finishDomainTrace(response: Response, session: ManualTraceSession): Response {
  session.end();
  scheduleTraceFlush(session.flush());
  return response;
}

function requireHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value || value.length === 0) {
    throw new RootRefsValidationError(400, RootRefsErrorCodes.INVALID_REQUEST, `missing ${name}`);
  }
  return value;
}

function parseMaxAttempts(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

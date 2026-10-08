import {
  createManualTraceContinuation,
  createManualTraceSession,
  createOtlpHttpTraceExporter,
  type ManualAttributeValue,
  type ManualTraceSession,
} from "./manual-tracing.js";
import {
  createTraceUlid,
  deriveScopedTraceId,
  resolveTraceUlid,
  shouldSampleTrace,
  traceUlidToHex,
  type TraceScope,
} from "./trace-identity.js";
import { parseInternalTraceContextHeader } from "./internal-context.js";
import {
  parseManualTraceSampleRate,
  parseTraceHmacKeyRing,
  requiredTraceConfig,
  type ManualTraceEnvironment,
} from "./trace-config.js";
export type { ManualTraceEnvironment } from "./trace-config.js";

export async function createConfiguredManualTraceSession(input: {
  readonly environment: ManualTraceEnvironment;
  readonly requestedTraceId?: string | null;
  readonly scope: TraceScope;
  readonly serviceName: "unicas" | "unicas-spaces";
  readonly serviceVersion?: string;
  readonly rootSpanName: "unicas.request" | "spaces.request";
  readonly rootAttributes?: Readonly<Record<string, ManualAttributeValue>>;
  readonly rootStartedAt?: number;
  readonly internalContext?: string | null;
  readonly internalContextAudience?: string;
  readonly now?: number;
  readonly allowInsecureLoopback?: boolean;
}): Promise<ManualTraceSession> {
  const now = input.now ?? Date.now();
  const correlationUlid = resolveTraceUlid(input.requestedTraceId, now);
  try {
    const sampleRate = parseManualTraceSampleRate(input.environment.UNICAS_MANUAL_TRACE_SAMPLE_RATE);
    if (sampleRate === 0) return fallbackSession(input, correlationUlid);
    const parent = await parseInternalTraceContextHeader(
      input.internalContext,
      input.environment.UNICAS_TRACE_HMAC_KEYS,
      input.internalContextAudience ?? "",
      now,
    );
    const keyRing = parseTraceHmacKeyRing(input.environment.UNICAS_TRACE_HMAC_KEYS);
    const traceId = parent?.traceId ?? await deriveScopedTraceId({
      key: keyRing.key,
      keyVersion: keyRing.version,
      scope: input.scope,
      traceUlid: correlationUlid,
    });
    const sampled = parent?.sampled ?? shouldSampleTrace(traceId, sampleRate);
    const exporter = sampled
      ? createOtlpHttpTraceExporter({
        endpoint: requiredTraceConfig(input.environment.UNICAS_OTLP_TRACES_ENDPOINT, "UNICAS_OTLP_TRACES_ENDPOINT"),
        authorization: requiredTraceConfig(input.environment.UNICAS_OTLP_AUTHORIZATION, "UNICAS_OTLP_AUTHORIZATION"),
        timeoutMs: 1000,
        allowInsecureLoopback: input.allowInsecureLoopback,
      })
      : undefined;
    return createManualTraceSession({
      serviceName: input.serviceName,
      serviceVersion: input.serviceVersion,
      rootSpanName: input.rootSpanName,
      correlationUlid: parent?.correlationUlid ?? correlationUlid,
      traceId,
      sampled,
      exporter,
      rootAttributes: input.rootAttributes,
      rootStartedAt: input.rootStartedAt,
      parent: parent ?? undefined,
    });
  } catch {
    return fallbackSession(input, correlationUlid);
  }
}

export async function createConfiguredManualTraceContinuation(input: {
  readonly environment: ManualTraceEnvironment;
  readonly internalContext: string | null | undefined;
  readonly internalContextAudience: string;
  readonly serviceName: "unicas" | "unicas-spaces";
  readonly serviceVersion?: string;
  readonly now?: number;
  readonly allowInsecureLoopback?: boolean;
}): Promise<ManualTraceSession> {
  const now = input.now ?? Date.now();
  try {
    const sampleRate = parseManualTraceSampleRate(input.environment.UNICAS_MANUAL_TRACE_SAMPLE_RATE);
    if (sampleRate === 0) return fallbackContinuation(input, now);
    const parent = await parseInternalTraceContextHeader(
      input.internalContext,
      input.environment.UNICAS_TRACE_HMAC_KEYS,
      input.internalContextAudience,
      now,
    );
    if (parent) {
      return createManualTraceContinuation({
        serviceName: input.serviceName,
        serviceVersion: input.serviceVersion,
        parent,
        exporter: createOtlpHttpTraceExporter({
          endpoint: requiredTraceConfig(input.environment.UNICAS_OTLP_TRACES_ENDPOINT, "UNICAS_OTLP_TRACES_ENDPOINT"),
          authorization: requiredTraceConfig(input.environment.UNICAS_OTLP_AUTHORIZATION, "UNICAS_OTLP_AUTHORIZATION"),
          timeoutMs: 1000,
          allowInsecureLoopback: input.allowInsecureLoopback,
        }),
      });
    }
  } catch {
    // Invalid or incompletely configured telemetry context never blocks work.
  }
  return fallbackContinuation(input, now);
}

function fallbackSession(
  input: Parameters<typeof createConfiguredManualTraceSession>[0],
  correlationUlid: ReturnType<typeof resolveTraceUlid>,
): ManualTraceSession {
  return createManualTraceSession({
    serviceName: input.serviceName,
    serviceVersion: input.serviceVersion,
    rootSpanName: input.rootSpanName,
    correlationUlid,
    traceId: traceUlidToHex(correlationUlid),
    sampled: false,
    rootAttributes: input.rootAttributes,
    rootStartedAt: input.rootStartedAt,
  });
}

function fallbackContinuation(
  input: Parameters<typeof createConfiguredManualTraceContinuation>[0],
  now: number,
): ManualTraceSession {
  const correlationUlid = createTraceUlid(now);
  return createManualTraceSession({
    serviceName: input.serviceName,
    serviceVersion: input.serviceVersion,
    rootSpanName: input.serviceName === "unicas" ? "unicas.request" : "spaces.request",
    correlationUlid,
    traceId: traceUlidToHex(correlationUlid),
    sampled: false,
  });
}
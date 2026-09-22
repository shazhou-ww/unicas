import {
  ROOT_CONTEXT,
  SpanKind,
  trace,
  type Attributes,
  type Context,
  type Span as ApiSpan,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  type IdGenerator,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createSpanId, type TraceUlid } from "./trace-identity.js";

export const ManualSpanNames = [
  "unicas.request",
  "spaces.request",
  "unicas.capability.verify",
  "unicas.node.validate",
  "unicas.root_refs.commit",
  "unicas.cleanup.run",
  "unicas.fetch",
  "unicas.d1",
  "unicas.r2",
  "unicas.do.dispatch",
] as const;

export type ManualSpanName = typeof ManualSpanNames[number];
export type ManualAttributeValue = boolean | number | string;

const AllowedSpanNames = new Set<string>(ManualSpanNames);
const AllowedAttributeNames: Readonly<Record<ManualSpanName, ReadonlySet<string>>> = {
  "unicas.request": new Set([
    "unicas.correlation_ulid", "unicas.operation", "unicas.outcome", "unicas.http.status_class",
  ]),
  "spaces.request": new Set([
    "unicas.correlation_ulid", "unicas.operation", "unicas.outcome", "unicas.http.status_class",
  ]),
  "unicas.capability.verify": new Set(["unicas.operation", "unicas.outcome"]),
  "unicas.node.validate": new Set(["unicas.node.bytes", "unicas.node.refs", "unicas.outcome"]),
  "unicas.root_refs.commit": new Set([
    "unicas.root_refs.mutations", "unicas.root_refs.retries", "unicas.outcome",
  ]),
  "unicas.cleanup.run": new Set([
    "unicas.cleanup.examined", "unicas.cleanup.deleted", "unicas.cleanup.failed", "unicas.outcome",
  ]),
  "unicas.fetch": new Set(["unicas.peer", "unicas.outcome", "unicas.http.status_class"]),
  "unicas.d1": new Set(["unicas.operation", "unicas.outcome", "unicas.rows.read", "unicas.rows.written"]),
  "unicas.r2": new Set(["unicas.operation", "unicas.outcome", "unicas.node.bytes"]),
  "unicas.do.dispatch": new Set(["unicas.actor.kind", "unicas.outcome"]),
};
const TokenValue = /^[A-Za-z0-9_.-]{1,64}$/;
const OutcomeValues = new Set(["ok", "rejected", "failed"]);
const StatusClassValues = new Set(["1xx", "2xx", "3xx", "4xx", "5xx"]);

export interface ManualTraceSpan {
  readonly isTraced: boolean;
  readonly context?: ManualTraceContext;
  setAttribute(key: string, value?: ManualAttributeValue): void;
}

export interface ManualTraceContext {
  readonly correlationUlid: TraceUlid;
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

export interface ManualTracingPort {
  enterSpan<T>(name: ManualSpanName, callback: (span: ManualTraceSpan) => T): T;
  recordCompletedSpan?(
    name: ManualSpanName,
    attributes: Readonly<Record<string, ManualAttributeValue>>,
    startedAt: number,
    endedAt: number,
  ): void;
}

export interface ManualTraceSession {
  readonly correlationUlid: TraceUlid;
  readonly traceId: string;
  readonly sampled: boolean;
  readonly context: ManualTraceContext;
  readonly tracing: ManualTracingPort;
  end(attributes?: Readonly<Record<string, ManualAttributeValue>>): void;
  flush(): Promise<void>;
}

export interface ManualTraceSessionOptions {
  readonly serviceName: "unicas" | "unicas-spaces";
  readonly serviceVersion?: string;
  readonly rootSpanName: "unicas.request" | "spaces.request";
  readonly correlationUlid: TraceUlid;
  readonly traceId: string;
  readonly sampled: boolean;
  readonly rootAttributes?: Readonly<Record<string, ManualAttributeValue>>;
  readonly rootStartedAt?: number;
  readonly parent?: ManualTraceContext;
  readonly exporter?: SpanExporter;
  readonly maximumSpans?: number;
}

export function createManualTraceSession(options: ManualTraceSessionOptions): ManualTraceSession {
  if (!options.sampled || !options.exporter) {
    return new NoopTraceSession(options.correlationUlid, options.traceId);
  }
  if (!/^(?!0{32})[0-9a-f]{32}$/.test(options.traceId)) {
    throw new TypeError("manual trace ID must be 16 nonzero lowercase hex bytes");
  }
  const processor = new BoundedSpanProcessor(options.exporter, options.maximumSpans ?? 16);
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName,
      ...(options.serviceVersion ? { "service.version": boundedToken(options.serviceVersion) } : {}),
    }),
    sampler: new AlwaysOnSampler(),
    idGenerator: new FixedTraceIdGenerator(options.traceId),
    spanProcessors: [processor],
    spanLimits: {
      attributeCountLimit: 16,
      attributeValueLengthLimit: 64,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
  });
  const tracer = provider.getTracer("@unicas/observability", "0.1.0");
  const parentContext = options.parent
    ? trace.setSpanContext(ROOT_CONTEXT, {
      traceId: options.parent.traceId,
      spanId: options.parent.spanId,
      traceFlags: 1,
      isRemote: true,
    })
    : ROOT_CONTEXT;
  const root = tracer.startSpan(options.rootSpanName, {
    kind: SpanKind.SERVER,
    ...(options.rootStartedAt === undefined ? {} : { startTime: options.rootStartedAt }),
    attributes: safeAttributes(options.rootSpanName, {
      "unicas.correlation_ulid": options.correlationUlid,
      ...options.rootAttributes,
    }),
  }, parentContext);
  const rootContext = trace.setSpan(parentContext, root);
  return new RecordingTraceSession(
    options.correlationUlid,
    options.traceId,
    provider,
    root,
    options.rootSpanName,
    rootContext,
    tracer,
  );
}

export function createManualTraceContinuation(
  options: ManualTraceContinuationOptions,
): ManualTraceSession {
  if (!options.parent.sampled || !options.exporter) {
    return new NoopTraceSession(
      options.parent.correlationUlid,
      options.parent.traceId,
      options.parent.spanId,
    );
  }
  const processor = new BoundedSpanProcessor(options.exporter, options.maximumSpans ?? 16);
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName,
      ...(options.serviceVersion ? { "service.version": boundedToken(options.serviceVersion) } : {}),
    }),
    sampler: new AlwaysOnSampler(),
    idGenerator: new FixedTraceIdGenerator(options.parent.traceId),
    spanProcessors: [processor],
    spanLimits: {
      attributeCountLimit: 16,
      attributeValueLengthLimit: 64,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
  });
  const tracer = provider.getTracer("@unicas/observability", "0.1.0");
  const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: options.parent.traceId,
    spanId: options.parent.spanId,
    traceFlags: 1,
    isRemote: true,
  });
  return new ContinuationTraceSession(options.parent, provider, parentContext, tracer);
}

export function createOtlpHttpTraceExporter(input: {
  readonly endpoint: string;
  readonly authorization?: string;
  readonly timeoutMs?: number;
  readonly allowInsecureLoopback?: boolean;
}): SpanExporter {
  const endpoint = validateOtlpTraceEndpoint(input.endpoint, input.allowInsecureLoopback);
  return new OTLPTraceExporter({
    url: endpoint,
    timeoutMillis: input.timeoutMs ?? 1000,
    concurrencyLimit: 1,
    headers: input.authorization ? { Authorization: input.authorization } : {},
  });
}

export function validateOtlpTraceEndpoint(value: string, allowInsecureLoopback = false): string {
  const endpoint = new URL(value);
  const loopbackHttp = allowInsecureLoopback
    && endpoint.protocol === "http:"
    && (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost" || endpoint.hostname === "[::1]");
  if (
    (endpoint.protocol !== "https:" && !loopbackHttp)
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || !endpoint.pathname.endsWith("/v1/traces")
  ) {
    throw new TypeError("OTLP trace endpoint must be credential-free HTTPS ending in /v1/traces");
  }
  return endpoint.toString();
}

class RecordingTraceSession implements ManualTraceSession {
  readonly sampled = true;
  readonly tracing: ManualTracingPort;
  readonly context: ManualTraceContext;
  #ended = false;

  constructor(
    readonly correlationUlid: TraceUlid,
    readonly traceId: string,
    private readonly provider: BasicTracerProvider,
    private readonly root: ApiSpan,
    private readonly rootSpanName: "unicas.request" | "spaces.request",
    rootContext: Context,
    tracer: ReturnType<BasicTracerProvider["getTracer"]>,
  ) {
    this.context = {
      correlationUlid,
      traceId,
      spanId: root.spanContext().spanId,
      sampled: true,
    };
    this.tracing = {
      enterSpan: <T>(name: ManualSpanName, callback: (span: ManualTraceSpan) => T): T => {
        if (!AllowedSpanNames.has(name) || name === "unicas.request" || name === "spaces.request") {
          throw new TypeError("manual child span name is not allowed");
        }
        const child = tracer.startSpan(name, { kind: SpanKind.INTERNAL }, rootContext);
        const wrapped = safeSpan(name, child, this.correlationUlid);
        let result: T;
        try {
          result = callback(wrapped);
        } catch (error) {
          child.end();
          throw error;
        }
        if (isPromiseLike(result)) {
          return result.then(
            (value) => {
              child.end();
              return value;
            },
            (error) => {
              child.end();
              throw error;
            },
          ) as T;
        }
        child.end();
        return result;
      },
      recordCompletedSpan: (name, attributes, startedAt, endedAt) => {
        recordCompletedSpan(tracer, rootContext, name, attributes, startedAt, endedAt);
      },
    };
  }

  end(attributes: Readonly<Record<string, ManualAttributeValue>> = {}): void {
    if (this.#ended) return;
    this.#ended = true;
    this.root.setAttributes(safeAttributes(this.rootSpanName, attributes));
    this.root.end();
  }

  async flush(): Promise<void> {
    this.end();
    try {
      await this.provider.forceFlush({ timeoutMillis: 1000 });
    } catch {
      // Trace export is deliberately fail-open for the business operation.
    }
  }
}

class NoopTraceSession implements ManualTraceSession {
  readonly sampled = false;
  readonly tracing: ManualTracingPort = {
    enterSpan: (_name, callback) => callback({ isTraced: false, setAttribute() { } }),
    recordCompletedSpan() { },
  };
  readonly context: ManualTraceContext;

  constructor(
    readonly correlationUlid: TraceUlid,
    readonly traceId: string,
    spanId = createSpanId(),
  ) {
    this.context = { correlationUlid, traceId, spanId, sampled: false };
  }

  end(): void { }
  async flush(): Promise<void> { }
}

class ContinuationTraceSession implements ManualTraceSession {
  readonly correlationUlid: TraceUlid;
  readonly traceId: string;
  readonly sampled = true;
  readonly tracing: ManualTracingPort;

  constructor(
    readonly context: ManualTraceContext,
    private readonly provider: BasicTracerProvider,
    parentContext: Context,
    tracer: ReturnType<BasicTracerProvider["getTracer"]>,
  ) {
    this.correlationUlid = context.correlationUlid;
    this.traceId = context.traceId;
    this.tracing = {
      enterSpan: <T>(name: ManualSpanName, callback: (span: ManualTraceSpan) => T): T => {
        if (!AllowedSpanNames.has(name) || name === "unicas.request" || name === "spaces.request") {
          throw new TypeError("manual child span name is not allowed");
        }
        const child = tracer.startSpan(name, { kind: SpanKind.INTERNAL }, parentContext);
        const wrapped = safeSpan(name, child, this.correlationUlid);
        let result: T;
        try {
          result = callback(wrapped);
        } catch (error) {
          child.end();
          throw error;
        }
        if (isPromiseLike(result)) {
          return result.then(
            (value) => { child.end(); return value; },
            (error) => { child.end(); throw error; },
          ) as T;
        }
        child.end();
        return result;
      },
      recordCompletedSpan: (name, attributes, startedAt, endedAt) => {
        recordCompletedSpan(tracer, parentContext, name, attributes, startedAt, endedAt);
      },
    };
  }

  end(): void { }

  async flush(): Promise<void> {
    try {
      await this.provider.forceFlush({ timeoutMillis: 1000 });
    } catch {
      // Trace export is deliberately fail-open for the business operation.
    }
  }
}

class FixedTraceIdGenerator implements IdGenerator {
  constructor(private readonly traceId: string) { }

  generateTraceId(): string {
    return this.traceId;
  }

  generateSpanId(): string {
    return createSpanId();
  }
}

class BoundedSpanProcessor implements SpanProcessor {
  readonly #spans: ReadableSpan[] = [];
  #shutdown = false;

  constructor(
    private readonly exporter: SpanExporter,
    private readonly maximumSpans: number,
  ) {
    if (!Number.isSafeInteger(maximumSpans) || maximumSpans < 1 || maximumSpans > 16) {
      throw new RangeError("maximum spans must be between 1 and 16");
    }
  }

  onStart(): void { }

  onEnd(span: ReadableSpan): void {
    if (this.#shutdown) return;
    if (this.#spans.length < this.maximumSpans) {
      this.#spans.push(span);
    } else if (span.name === "unicas.request" || span.name === "spaces.request") {
      this.#spans[this.#spans.length - 1] = span;
    }
  }

  async forceFlush(): Promise<void> {
    if (this.#shutdown || this.#spans.length === 0) return;
    const spans = this.#spans.splice(0, this.#spans.length);
    await new Promise<void>((resolve, reject) => {
      try {
        this.exporter.export(spans, (result) => {
          if (result.code === 0) resolve();
          else reject(result.error ?? new Error("OTLP trace export failed"));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    this.#shutdown = true;
    await this.exporter.shutdown();
  }
}

function safeSpan(name: ManualSpanName, span: ApiSpan, correlationUlid: TraceUlid): ManualTraceSpan {
  return {
    isTraced: span.isRecording(),
    context: {
      correlationUlid,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      sampled: span.isRecording(),
    },
    setAttribute(key, value) {
      const accepted = safeAttribute(name, key, value);
      if (accepted !== undefined) span.setAttribute(key, accepted);
    },
  };
}

function safeAttributes(
  name: ManualSpanName,
  attributes: Readonly<Record<string, ManualAttributeValue>>,
): Attributes {
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    const accepted = safeAttribute(name, key, value);
    if (accepted !== undefined) safe[key] = accepted;
  }
  return safe;
}

function safeAttribute(
  name: ManualSpanName,
  key: string,
  value: ManualAttributeValue | undefined,
): ManualAttributeValue | undefined {
  if (!AllowedSpanNames.has(name) || !AllowedAttributeNames[name].has(key) || value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "boolean") return value;
  if (key === "unicas.correlation_ulid") {
    return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : undefined;
  }
  if (key === "unicas.outcome") return OutcomeValues.has(value) ? value : undefined;
  if (key === "unicas.http.status_class") return StatusClassValues.has(value) ? value : undefined;
  return TokenValue.test(value) ? value : undefined;
}

function boundedToken(value: string): string {
  if (!TokenValue.test(value)) throw new TypeError("resource attribute is not a bounded token");
  return value;
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<Awaited<T>> {
  return typeof value === "object" && value !== null && "then" in value;
}

export interface ManualTraceContinuationOptions {
  readonly serviceName: "unicas" | "unicas-spaces";
  readonly serviceVersion?: string;
  readonly parent: ManualTraceContext;
  readonly exporter?: SpanExporter;
  readonly maximumSpans?: number;
}

function recordCompletedSpan(
  tracer: ReturnType<BasicTracerProvider["getTracer"]>,
  parentContext: Context,
  name: ManualSpanName,
  attributes: Readonly<Record<string, ManualAttributeValue>>,
  startedAt: number,
  endedAt: number,
): void {
  if (
    !AllowedSpanNames.has(name)
    || name === "unicas.request"
    || name === "spaces.request"
    || !Number.isFinite(startedAt)
    || !Number.isFinite(endedAt)
    || endedAt < startedAt
  ) return;
  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    startTime: startedAt,
    attributes: safeAttributes(name, attributes),
  }, parentContext);
  span.end(endedAt);
}
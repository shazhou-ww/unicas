import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { InMemorySpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ulid } from "ulid";
import {
  createConfiguredManualTraceSession,
  createManualTraceSession,
  createOtlpHttpTraceExporter,
  normalizeTraceUlid,
  validateOtlpTraceEndpoint,
} from "../src/index.js";

const Now = Date.UTC(2026, 8, 22, 12, 0, 0);
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("manual trace session", () => {
  test("stays dormant at zero sampling without exporter secrets", async () => {
    const requested = normalizeTraceUlid(ulid(Now), Now)!;
    const session = await createConfiguredManualTraceSession({
      environment: { UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0" },
      requestedTraceId: requested,
      scope: { kind: "app", id: "app-a" },
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      now: Now,
    });

    expect(session.sampled).toBe(false);
    expect(session.correlationUlid).toBe(requested);
    await expect(session.flush()).resolves.toBeUndefined();
  });

  test("falls back to unsampled when sampled configuration is incomplete", async () => {
    const requested = normalizeTraceUlid(ulid(Now), Now)!;
    const session = await createConfiguredManualTraceSession({
      environment: { UNICAS_MANUAL_TRACE_SAMPLE_RATE: "1" },
      requestedTraceId: requested,
      scope: { kind: "app", id: "app-a" },
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      now: Now,
    });

    expect(session.sampled).toBe(false);
    expect(session.correlationUlid).toBe(requested);
  });

  test("records one bounded parent-child trace and drops unsafe attributes", async () => {
    const exporter = new InMemorySpanExporter();
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas",
      serviceVersion: "release-1",
      rootSpanName: "unicas.request",
      correlationUlid,
      traceId: "1234567890abcdef1234567890abcdef",
      sampled: true,
      exporter,
      rootAttributes: {
        "unicas.operation": "read_metadata",
        "unsafe.url": "https://example.test/?code=oauth-secret",
      },
    });

    await session.tracing.enterSpan("unicas.node.validate", async (span) => {
      span.setAttribute("unicas.node.bytes", 42);
      span.setAttribute("unicas.outcome", "ok");
      span.setAttribute("unicas.peer", "jwks");
      span.setAttribute("unicas.operation", "https://upload.test/?X-Amz-Signature=secret");
      span.setAttribute("db.query.text", "SELECT private FROM secrets");
    });
    session.end({ "unicas.outcome": "ok", "unicas.http.status_class": "2xx" });
    await session.flush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name).sort()).toEqual([
      "unicas.node.validate",
      "unicas.request",
    ]);
    expect(new Set(spans.map((span) => span.spanContext().traceId))).toEqual(new Set([session.traceId]));
    const child = spans.find((span) => span.name === "unicas.node.validate")!;
    const root = spans.find((span) => span.name === "unicas.request")!;
    expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(root.attributes).toMatchObject({
      "unicas.correlation_ulid": correlationUlid,
      "unicas.operation": "read_metadata",
      "unicas.outcome": "ok",
    });
    const serialized = JSON.stringify(spans.map((span) => span.attributes));
    expect(serialized).not.toMatch(/oauth-secret|X-Amz-Signature|SELECT private|unsafe\.url|db\.query\.text|unicas\.peer/);
  });

  test("does not allocate or export spans when unsampled", async () => {
    const exporter = new InMemorySpanExporter();
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      correlationUlid,
      traceId: "1234567890abcdef1234567890abcdef",
      sampled: false,
      exporter,
    });

    await session.tracing.enterSpan("unicas.cleanup.run", async (span) => {
      expect(span.isTraced).toBe(false);
    });
    session.end();
    await session.flush();

    expect(exporter.getFinishedSpans()).toEqual([]);
  });

  test("keeps the request root when the bounded span buffer is full", async () => {
    const exporter = new InMemorySpanExporter();
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      correlationUlid,
      traceId: "1234567890abcdef1234567890abcdef",
      sampled: true,
      exporter,
      maximumSpans: 2,
      parent: {
        correlationUlid,
        traceId: "1234567890abcdef1234567890abcdef",
        spanId: "1111111111111111",
        sampled: true,
      },
    });

    for (let index = 0; index < 3; index++) {
      await session.tracing.enterSpan("unicas.d1", async () => undefined);
    }
    session.end();
    await session.flush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const root = spans.find((span) => span.name === "unicas.request");
    expect(root?.parentSpanContext?.spanId).toBe("1111111111111111");
  });

  test("swallows asynchronous exporter failure after business work completes", async () => {
    const exporter: SpanExporter = {
      export(_spans, callback) {
        queueMicrotask(() => callback({ code: 1, error: new Error("collector unavailable") }));
      },
      async shutdown() { },
    };
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      correlationUlid,
      traceId: "1234567890abcdef1234567890abcdef",
      sampled: true,
      exporter,
    });

    const result = await session.tracing.enterSpan("unicas.d1", async () => "business-result");
    session.end();

    expect(result).toBe("business-result");
    await expect(session.flush()).resolves.toBeUndefined();
  });

  test("bounds an unresponsive exporter with the flush timeout", async () => {
    const exporter: SpanExporter = {
      export() { },
      async shutdown() { },
    };
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      correlationUlid,
      traceId: "1234567890abcdef1234567890abcdef",
      sampled: true,
      exporter,
    });
    session.end();
    const startedAt = performance.now();

    await expect(session.flush()).resolves.toBeUndefined();

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  test("exports OTLP JSON to a credential-free endpoint without unsafe fields", async () => {
    let body = "";
    let authorization = "";
    const server = createServer((request, response) => {
      authorization = request.headers.authorization ?? "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing mock receiver address");
    const endpoint = "https://collector.example/v1/traces";
    expect(validateOtlpTraceEndpoint(endpoint)).toBe(endpoint);
    expect(() => validateOtlpTraceEndpoint("https://secret@collector.example/v1/traces?token=secret"))
      .toThrow("credential-free HTTPS");

    const exporter = createOtlpHttpTraceExporter({
      endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
      authorization: "Bearer exporter-secret",
      allowInsecureLoopback: true,
    });
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas-spaces",
      rootSpanName: "spaces.request",
      correlationUlid,
      traceId: "abcdef1234567890abcdef1234567890",
      sampled: true,
      exporter,
      rootAttributes: { "unicas.operation": "upload_file" },
    });
    await session.tracing.enterSpan("unicas.fetch", async (span) => {
      span.setAttribute("unicas.peer", "r2_upload");
      span.setAttribute("unicas.outcome", "ok");
      span.setAttribute("unsafe.url", "https://upload.example/?X-Amz-Signature=secret");
    });
    session.end({ "unicas.outcome": "ok", "unicas.http.status_class": "2xx" });
    await session.flush();

    expect(authorization).toBe("Bearer exporter-secret");
    expect(body).toContain("unicas-spaces");
    expect(body).toContain("spaces.request");
    expect(body).toContain("unicas.fetch");
    expect(body).toContain("abcdef1234567890abcdef1234567890");
    expect(body).not.toMatch(/X-Amz-Signature|upload\.example|unsafe\.url/);
  });

  test("keeps a maximum default OTLP batch below 64 KiB", async () => {
    let body = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing mock receiver address");
    const exporter = createOtlpHttpTraceExporter({
      endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
      allowInsecureLoopback: true,
    });
    const correlationUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const session = createManualTraceSession({
      serviceName: "unicas",
      serviceVersion: "x".repeat(64),
      rootSpanName: "unicas.request",
      correlationUlid,
      traceId: "abcdef1234567890abcdef1234567890",
      sampled: true,
      exporter,
      rootAttributes: {
        "unicas.operation": "x".repeat(64),
        "unicas.outcome": "ok",
        "unicas.http.status_class": "2xx",
      },
    });
    for (let index = 0; index < 20; index++) {
      await session.tracing.enterSpan("unicas.cleanup.run", async (span) => {
        span.setAttribute("unicas.outcome", "ok");
        span.setAttribute("unicas.cleanup.examined", Number.MAX_SAFE_INTEGER);
        span.setAttribute("unicas.cleanup.deleted", Number.MAX_SAFE_INTEGER);
        span.setAttribute("unicas.cleanup.failed", Number.MAX_SAFE_INTEGER);
      });
    }
    session.end({ "unicas.outcome": "ok", "unicas.http.status_class": "2xx" });
    await session.flush();

    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(32 * 1024);
    expect(body).toContain("unicas.request");
  });
});
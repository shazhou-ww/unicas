import { describe, expect, test } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { ulid } from "ulid";
import {
  createInternalTraceContextHeader,
  createInternalTraceAudience,
  createConfiguredManualTraceContinuation,
  createManualTraceContinuation,
  createManualTraceSession,
  normalizeTraceUlid,
  parseInternalTraceContextHeader,
  type ManualTraceContext,
} from "../src/index.js";

const Now = Date.UTC(2026, 8, 22, 12, 0, 0);
const Key = new Uint8Array(32).fill(9);
const PreviousKey = new Uint8Array(32).fill(7);
const EncodedKey = base64Url(Key);
const EncodedPreviousKey = base64Url(PreviousKey);
const KeyRing = JSON.stringify({ active: "v2", keys: { v1: EncodedPreviousKey, v2: EncodedKey } });
const Audience = createInternalTraceAudience("space_do", "app-a|space-a", "POST", "/lease");

const Parent: ManualTraceContext = {
  correlationUlid: normalizeTraceUlid(ulid(Now), Now)!,
  traceId: "1234567890abcdef1234567890abcdef",
  spanId: "1234567890abcdef",
  sampled: true,
};

describe("internal trace context", () => {
  test("authenticates a bounded context and rejects tampering or expiry", async () => {
    const header = await createInternalTraceContextHeader(Parent, KeyRing, Audience, Now);
    expect(header).toBeTruthy();
    await expect(parseInternalTraceContextHeader(header, KeyRing, Audience, Now)).resolves.toEqual(Parent);
    await expect(parseInternalTraceContextHeader(`${header}x`, KeyRing, Audience, Now)).resolves.toBeNull();
    await expect(parseInternalTraceContextHeader(header, KeyRing, Audience, Now + 60_001)).resolves.toBeNull();
    await expect(parseInternalTraceContextHeader(
      header,
      KeyRing,
      createInternalTraceAudience("space_do", "app-b|space-b", "POST", "/lease"),
      Now,
    )).resolves.toBeNull();
    await expect(parseInternalTraceContextHeader("x".repeat(1025), KeyRing, Audience, Now))
      .resolves.toBeNull();
    const futureHeader = await createInternalTraceContextHeader(Parent, KeyRing, Audience, Now + 1);
    await expect(parseInternalTraceContextHeader(futureHeader, KeyRing, Audience, Now)).resolves.toBeNull();
  });

  test("accepts a context signed by a retained previous key version", async () => {
    const previousRing = JSON.stringify({
      active: "v1",
      keys: { v1: EncodedPreviousKey, v2: EncodedKey },
    });
    const header = await createInternalTraceContextHeader(Parent, previousRing, Audience, Now);
    await expect(parseInternalTraceContextHeader(header, KeyRing, Audience, Now)).resolves.toEqual(Parent);
  });

  test("does not create a carrier for unsampled work", async () => {
    await expect(createInternalTraceContextHeader({ ...Parent, sampled: false }, undefined, Audience, Now))
      .resolves.toBeNull();
  });

  test("continues child spans under the verified parent", async () => {
    const exporter = new InMemorySpanExporter();
    const session = createManualTraceContinuation({
      serviceName: "unicas",
      parent: Parent,
      exporter,
    });
    await session.tracing.enterSpan("unicas.node.validate", async (span) => {
      span.setAttribute("unicas.outcome", "ok");
    });
    await session.flush();

    const [span] = exporter.getFinishedSpans();
    expect(span?.spanContext().traceId).toBe(Parent.traceId);
    expect(span?.parentSpanContext?.spanId).toBe(Parent.spanId);
  });

  test("creates a request root beneath an authenticated remote parent", async () => {
    const exporter = new InMemorySpanExporter();
    const session = createManualTraceSession({
      serviceName: "unicas",
      rootSpanName: "unicas.request",
      correlationUlid: Parent.correlationUlid,
      traceId: Parent.traceId,
      sampled: true,
      exporter,
      parent: Parent,
    });
    session.end({ "unicas.outcome": "ok" });
    await session.flush();

    const [root] = exporter.getFinishedSpans();
    expect(root?.name).toBe("unicas.request");
    expect(root?.spanContext().traceId).toBe(Parent.traceId);
    expect(root?.parentSpanContext?.spanId).toBe(Parent.spanId);
  });

  test("local zero sampling overrides a valid signed sampled context", async () => {
    const header = await createInternalTraceContextHeader(Parent, KeyRing, Audience, Now);
    const session = await createConfiguredManualTraceContinuation({
      environment: {
        UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0",
        UNICAS_TRACE_HMAC_KEYS: KeyRing,
      },
      internalContext: header,
      internalContextAudience: Audience,
      serviceName: "unicas",
      now: Now,
    });

    expect(session.sampled).toBe(false);
  });

  test("fails open to an unsampled continuation when context configuration is invalid", async () => {
    const session = await createConfiguredManualTraceContinuation({
      environment: { UNICAS_TRACE_HMAC_KEYS: "not-json" },
      internalContext: "payload.signature",
      internalContextAudience: Audience,
      serviceName: "unicas",
      now: Now,
    });

    expect(session.sampled).toBe(false);
    await expect(session.flush()).resolves.toBeUndefined();
  });
});

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

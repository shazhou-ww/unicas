import { describe, expect, test } from "vitest";
import { ulid } from "ulid";
import {
  createSpanId,
  deriveScopedTraceId,
  normalizeTraceUlid,
  resolveTraceUlid,
  shouldSampleTrace,
  traceUlidToHex,
} from "../src/index.js";

const Now = Date.UTC(2026, 8, 22, 12, 0, 0);

describe("trace identity", () => {
  test("normalizes a current ULID and replaces invalid or stale input", () => {
    const current = ulid(Now);
    expect(normalizeTraceUlid(current.toLowerCase(), Now)).toBe(current);
    expect(normalizeTraceUlid(ulid(Now - 10 * 60 * 1000 - 1), Now)).toBeNull();
    expect(normalizeTraceUlid(ulid(Now + 60 * 1000 + 1), Now)).toBeNull();
    expect(normalizeTraceUlid("8".repeat(26), Now)).toBeNull();
    expect(resolveTraceUlid("not-a-ulid", Now)).not.toBe("not-a-ulid");
  });

  test("maps ULID bits to an OTLP trace ID", () => {
    const value = normalizeTraceUlid(ulid(Now), Now)!;
    expect(traceUlidToHex(value)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("derives deterministic trace IDs scoped away from other Apps", async () => {
    const traceUlid = normalizeTraceUlid(ulid(Now), Now)!;
    const key = new Uint8Array(32).fill(7);
    const first = await deriveScopedTraceId({
      key,
      keyVersion: "v1",
      scope: { kind: "app", id: "app-a" },
      traceUlid,
    });
    const replay = await deriveScopedTraceId({
      key,
      keyVersion: "v1",
      scope: { kind: "app", id: "app-a" },
      traceUlid,
    });
    const otherApp = await deriveScopedTraceId({
      key,
      keyVersion: "v1",
      scope: { kind: "app", id: "app-b" },
      traceUlid,
    });

    expect(first).toBe(replay);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(otherApp).not.toBe(first);
  });

  test("samples deterministically and emits nonzero span IDs", () => {
    const traceId = "1234567890abcdef1234567890abcdef";
    expect(shouldSampleTrace(traceId, 0)).toBe(false);
    expect(shouldSampleTrace(traceId, 1)).toBe(true);
    expect(shouldSampleTrace(traceId, 0.5)).toBe(shouldSampleTrace(traceId, 0.5));
    expect(createSpanId()).toMatch(/^(?!0{16})[0-9a-f]{16}$/);
  });
});
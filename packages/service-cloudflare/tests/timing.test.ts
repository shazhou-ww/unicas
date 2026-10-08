import { describe, expect, test, vi } from "vitest";
import { ServerTiming, withStorageTracing } from "../src/timing.js";
import type { ManualSpanName, ManualTracingPort } from "@unicas/observability";

describe("ServerTiming", () => {
  test("aggregates repeated operations and preserves streamed responses", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12.5)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(23.5);
    const timing = new ServerTiming();
    await timing.time("cas_d1_node", async () => undefined);
    await timing.time("cas_d1_node", async () => undefined);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("content"));
        controller.close();
      },
    });

    const response = timing.decorate(new Response(body, {
      headers: { "Server-Timing": "cas_auth;dur=1.0" },
    }));

    expect(response.headers.get("Server-Timing"))
      .toBe('cas_auth;dur=1.0, cas_d1_node;dur=6.0;desc="2 calls"');
    expect(response.headers.get("Timing-Allow-Origin")).toBe("*");
    await expect(response.text()).resolves.toBe("content");
  });

  test("emits bounded spans only for allowlisted D1 and R2 operations", async () => {
    const spans: Array<{ name: ManualSpanName; attributes: Record<string, unknown> }> = [];
    const tracing: ManualTracingPort = {
      enterSpan(name, callback) {
        const entry = { name, attributes: {} };
        spans.push(entry);
        return callback({
          isTraced: true,
          setAttribute(key, value) {
            entry.attributes[key] = value;
          },
        });
      },
    };
    const timing = withStorageTracing({ time: (_name, operation) => operation() }, tracing);

    await timing.time("cas_d1_refs", async () => ({ results: [{}, {}] }));
    await timing.time("cas_r2_get", async () => null);
    await timing.time("unreviewed_name", async () => undefined);
    await expect(timing.time("cas_r2_put", async () => {
      throw new Error("unavailable");
    })).rejects.toThrow("unavailable");

    expect(spans).toEqual([
      {
        name: "unicas.d1",
        attributes: {
          "unicas.operation": "refs",
          "unicas.outcome": "ok",
          "unicas.rows.read": 2,
        },
      },
      {
        name: "unicas.r2",
        attributes: { "unicas.operation": "get", "unicas.outcome": "ok" },
      },
      {
        name: "unicas.r2",
        attributes: { "unicas.operation": "put", "unicas.outcome": "failed" },
      },
    ]);
  });
});
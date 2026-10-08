import { describe, expect, test, vi } from "vitest";
import { SpacesServerTiming } from "../src/timing.js";

describe("SpacesServerTiming", () => {
  test("records outer boundaries and absorbs only safe downstream metrics", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12.5);
    const timing = new SpacesServerTiming();
    await timing.time("spaces_session", async () => undefined);
    timing.absorbDownstream(
      'cas_auth;dur=4.5;desc="identifier", dynamic_principal;dur=99, '
      + "cas_d1_node;dur=2.0, cas_r2_get;dur=-1, cas_do;dur=Infinity",
    );

    expect(timing.headerValue())
      .toBe("spaces_session;dur=2.5, cas_auth;dur=4.5, cas_d1_node;dur=2.0");
    const response = timing.decorate(new Response("ok"));
    expect(response.headers.get("Timing-Allow-Origin")).toBe("*");
    expect(response.headers.get("Server-Timing")).not.toContain("identifier");
    expect(response.headers.get("Server-Timing")).not.toContain("principal");
  });

  test("ignores non-finite and unbounded durations", () => {
    const timing = new SpacesServerTiming();
    timing.record("spaces_unicas", Number.NaN);
    timing.record("spaces_unicas", -1);
    timing.record("spaces_unicas", 300_001);
    expect(timing.headerValue()).toBe("");
  });
});

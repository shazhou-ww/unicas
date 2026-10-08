import { describe, expect, test } from "vitest";
import {
  CasNodeRefsHeader,
  formatCasNodeRefsHeader,
  parseCasNodeRefsHeader,
} from "../src/index.js";

describe("CAS node response headers", () => {
  test("round-trips an ordered bounded ref list", () => {
    const refs = ["a".repeat(64), "b".repeat(64)];
    expect(CasNodeRefsHeader).toBe("X-CAS-Refs");
    expect(parseCasNodeRefsHeader(formatCasNodeRefsHeader(refs))).toEqual(refs);
    expect(parseCasNodeRefsHeader("")).toEqual([]);
  });

  test("rejects missing, malformed, or oversized ref lists", () => {
    expect(() => parseCasNodeRefsHeader(null)).toThrow("is required");
    expect(() => parseCasNodeRefsHeader("not-a-hash")).toThrow("is invalid");
    expect(() => formatCasNodeRefsHeader(Array.from({ length: 257 }, () => "a".repeat(64))))
      .toThrow("refs are invalid");
  });
});

import { describe, expect, test } from "vitest";
import { generateAccountId } from "../src/index.js";

describe("control identifiers", () => {
  test("generates unique 128-bit base64url Account IDs", () => {
    const ids = Array.from({ length: 100 }, () => generateAccountId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^acct_[A-Za-z0-9_-]{22}$/);
  });
});
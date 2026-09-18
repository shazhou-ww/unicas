import { expect, test } from "vitest";
import { AppPeopleQuerySchema, PlatformPeopleQuerySchema } from "../src/people.js";

test("unified people filters are bounded and plane-specific", () => {
  expect(AppPeopleQuerySchema.parse({ query: " Alice ", filter: "members", limit: 50 })).toEqual({ query: "Alice", filter: "members", limit: 50 });
  expect(PlatformPeopleQuerySchema.parse({ filter: "accounts", authority: "none", effectiveAccess: "no_access" })).toMatchObject({ authority: "none" });
  for (const input of [{ limit: 0 }, { limit: 101 }, { cursor: "" }, { query: "a".repeat(201) }, { unknown: true }]) {
    expect(AppPeopleQuerySchema.safeParse(input).success).toBe(false);
    expect(PlatformPeopleQuerySchema.safeParse(input).success).toBe(false);
  }
  expect(AppPeopleQuerySchema.safeParse({ filter: "principals" }).success).toBe(false);
  expect(PlatformPeopleQuerySchema.safeParse({ filter: "members" }).success).toBe(false);
});
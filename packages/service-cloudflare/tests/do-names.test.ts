import { describe, expect, test } from "vitest";
import { canonicalComposite, decodeComposite, appCanonicalNodeKey } from "../src/do-names.js";

describe("canonical DO name partitioning", () => {
  test("round-trips App + Space and App + refDomain", () => {
    for (const [appId, component] of [
      ["cas_app_a", "space-1"],
      ["cas_app_a", "doc"],
      ["app/with:slashes", "space/with:colons"],
      ["cas_应用", "空间"],
    ]) {
      const name = canonicalComposite(appId, component);
      expect(decodeComposite(name)).toEqual({ appId, component });
    }
  });

  test("ambiguous delimiter concatenation is impossible", () => {
    const a = canonicalComposite("s", "a|b");
    const b = canonicalComposite("s|a", "b");
    expect(a).not.toBe(b);
    expect(decodeComposite(a)).toEqual({ appId: "s", component: "a|b" });
    expect(decodeComposite(b)).toEqual({ appId: "s|a", component: "b" });
  });

  test("rejects empty parts and malformed composites", () => {
    expect(() => canonicalComposite("", "x")).toThrow();
    expect(() => canonicalComposite("x", "")).toThrow();
    expect(decodeComposite("no-separator")).toBeNull();
    expect(decodeComposite("|x")).toBeNull();
    expect(decodeComposite("x|")).toBeNull();
    expect(decodeComposite("%zz|x")).toBeNull();
  });

  test("R2 App/Space node keys are unambiguous", () => {
    expect(appCanonicalNodeKey("cas_app", "space-1", "a".repeat(64)))
      .toBe(`apps/cas_app/spaces/space-1/nodes-v2/${"a".repeat(64)}`);
  });
});

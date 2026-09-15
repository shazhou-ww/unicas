import { describe, expect, test, vi } from "vitest";
import { main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";

describe("cli dispatch", () => {
  test("defaults administrator requests to the console origin", () => {
    expect(loadConfig({}).adminOrigin).toBe("https://console.unicas.work");
  });

  test("prints help for `unicas help`", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      await main(["help"]);
    } finally {
      spy.mockRestore();
    }
    const output = writes.join("");
    expect(output).toContain("unicas login");
    expect(output).toContain("unicas mcp");
    expect(output).toContain("unicas apps create");
    expect(output).toContain("unicas app-members invite");
    expect(output).toContain("unicas app-oauth-issuer inspect");
    expect(output).toContain("unicas app-audit root-domain-refs");
    expect(output).toContain("--space-id S");
    expect(output).toContain("Legacy v1 compatibility");
    expect(output).toContain("unicas stacks create");
  });

  test("prints help when invoked without arguments", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      await main([]);
    } finally {
      spy.mockRestore();
    }
    expect(writes.join("")).toContain("unicas login");
  });

  test("rejects an unknown command", async () => {
    await expect(main(["frobnicate"])).rejects.toThrow(/unknown command 'frobnicate'/);
  });

  test("dispatches the App command family before session access", async () => {
    await expect(main(["apps"])).rejects.toThrow("usage: unicas apps list|get|create|update");
    await expect(main(["app-members"])).rejects.toThrow("usage: unicas app-members list|invite|remove");
    await expect(main(["app-oauth-issuer"])).rejects.toThrow("usage: unicas app-oauth-issuer get|inspect|activate");
    await expect(main(["app-ref-domains"])).rejects.toThrow("usage: unicas app-ref-domains list");
    await expect(main(["app-audit"])).rejects.toThrow("usage: unicas app-audit control|root-domain-refs|root-domain-events");
  });
});

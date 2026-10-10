import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyForwardedLocalArgs } from "../scripts/local/forward-local-args.mjs";
import { parseArgs } from "../scripts/local/generate-local-capability-keys.mjs";
import { localComposePlan } from "../scripts/local/run-local-compose.mjs";

const ROOT = join(import.meta.dirname, "..");

describe("local repository tooling", () => {
  test("forwards Docker arguments once and removes the transport variable", () => {
    const argv = ["node", "scripts/local/dev.mjs"];
    const environment = {
      KEEP: "value",
      UNICAS_LOCAL_ARGS_JSON: JSON.stringify(["--host", "0.0.0.0"]),
    };
    applyForwardedLocalArgs(argv, environment);
    expect(argv).toEqual([
      "node",
      "scripts/local/dev.mjs",
      "--host",
      "0.0.0.0",
    ]);
    expect(environment).toEqual({ KEEP: "value" });
    expect(() => applyForwardedLocalArgs([], {
      UNICAS_LOCAL_ARGS_JSON: JSON.stringify([1]),
    })).toThrow("JSON string array");
  });

  test("builds one explicit Docker Compose plan with encoded child arguments", () => {
    const composeFile = join(ROOT, "scripts", "local", "compose.yaml");
    const plan = localComposePlan(composeFile, ["--persist", "state"], { KEEP: "value" });
    expect(plan).toMatchObject({
      command: "docker",
      args: [
        "compose",
        "-f",
        composeFile,
        "up",
        "--build",
        "--remove-orphans",
      ],
      options: {
        cwd: dirname(composeFile),
        env: {
          KEEP: "value",
          UNICAS_LOCAL_ARGS_JSON: JSON.stringify(["--persist", "state"]),
        },
        stdio: "inherit",
      },
    });
    expect(readFileSync(composeFile, "utf8")).toContain("dockerfile: scripts/local/Dockerfile");
    expect(readFileSync(join(ROOT, "scripts", "local", "Dockerfile"), "utf8"))
      .toContain('CMD ["pnpm", "local:dev"]');
  });

  test("keeps local capability generation under the local command namespace", () => {
    expect(parseArgs([
      "--output", ".wrangler/test.json",
      "--issuer", "test:issuer",
      "--kid", "test-key",
    ])).toEqual({
      output: ".wrangler/test.json",
      issuer: "test:issuer",
      kid: "test-key",
    });
    const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(rootPackage.scripts).toMatchObject({
      "local:dev": "pnpm --filter @unicas/service-cloudflare build && node scripts/local/dev.mjs",
      "local:keys": "node scripts/local/generate-local-capability-keys.mjs",
      "hooks:install": "node scripts/git/git-hooks.mjs install",
      "hooks:uninstall": "node scripts/git/git-hooks.mjs uninstall",
      "hooks:status": "node scripts/git/git-hooks.mjs status",
    });
    expect(rootPackage.scripts.dev).toBeUndefined();
    expect(rootPackage.scripts["keys:local"]).toBeUndefined();
  });
});

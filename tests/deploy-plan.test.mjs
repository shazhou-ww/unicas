import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  deploymentPlan,
  parseArgs,
  validateDeploymentEnvironment,
} from "../stacks/unicas/deploy/deploy.mjs";
import { normalizeSmokeBaseUrl } from "../scripts/smoke-target.mjs";

const ROOT = join(import.meta.dirname, "..");

describe("standalone deployment plan", () => {
  test("requires an environment name after --env", () => {
    expect(() => parseArgs(["--env"])).toThrow("--env requires a lowercase environment name");
  });

  test("does not smoke the production URL after deploying a named environment", () => {
    expect(() => deploymentPlan({ env: "staging" })).toThrow("--env requires --skip-smoke");
    expect(() => deploymentPlan({ env: "staging", production: true, skipSmoke: true }))
      .toThrow("--production and --env cannot be used together");
    expect(deploymentPlan({ env: "staging", skipSmoke: true })).toEqual([
      ["pnpm", "--filter", "@unicas/service-cloudflare", "build"],
      ["pnpm", "--filter", "@unicas/service-cloudflare", "exec", "wrangler", "deploy", "--env", "staging"],
    ]);
  });

  test("does not allow production deployment to skip smoke", () => {
    expect(() => deploymentPlan({ production: true, skipSmoke: true }))
      .toThrow("production deployment cannot skip smoke validation");
  });

  test("limits smoke mutations to the product origin and local development", () => {
    expect(normalizeSmokeBaseUrl("https://unicas.work")).toBe("https://unicas.work");
    expect(normalizeSmokeBaseUrl("http://127.0.0.1:8794")).toBe("http://127.0.0.1:8794");
    expect(() => normalizeSmokeBaseUrl("https://unicas.shazhou.work"))
      .toThrow("is not allowed");
    expect(() => normalizeSmokeBaseUrl("https://docs.unicas.work"))
      .toThrow("is not allowed");
    expect(normalizeSmokeBaseUrl("https://staging.unicas.work", true))
      .toBe("https://staging.unicas.work");
  });

  test("refuses an implicit production deployment before running commands", () => {
    const result = spawnSync(
      process.execPath,
      ["stacks/unicas/deploy/deploy.mjs"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing implicit production deployment");
    expect(result.stdout).not.toContain("> ");
  });

  test("requires explicit smoke configuration before production commands", () => {
    expect(() => validateDeploymentEnvironment({ production: true }, {}))
      .toThrow("production smoke configuration is missing");

    const result = spawnSync(
      process.execPath,
      ["stacks/unicas/deploy/deploy.mjs", "--production"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { PATH: "" },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("production smoke configuration is missing");
    expect(result.stdout).not.toContain("> ");
  });

  test("dry-run prints the plan without executing external commands", () => {
    const result = spawnSync(
      process.execPath,
      ["stacks/unicas/deploy/deploy.mjs", "--dry-run"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("wrangler deploy");
    expect(result.stdout).toContain("stacks/unicas/deploy/smoke.mjs");
  });
});
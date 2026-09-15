import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  deploymentPlan,
  parseArgs,
  validateDeploymentEnvironment,
} from "../stacks/unicas/deploy/deploy.mjs";
import {
  parseResetArgs,
  r2BackupPlan,
  resetPlan,
  SCOPED_INVENTORY_QUERIES,
  validateR2BackupFiles,
  validateResetInventory,
} from "../stacks/unicas/deploy/reset-smoke.mjs";
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
    expect(normalizeSmokeBaseUrl("https://api.unicas.work")).toBe("https://api.unicas.work");
    expect(normalizeSmokeBaseUrl("http://127.0.0.1:8794")).toBe("http://127.0.0.1:8794");
    expect(() => normalizeSmokeBaseUrl("https://unicas.work"))
      .toThrow("is not allowed");
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

  test("uses App/Space smoke by default and retains an explicit v1 smoke", () => {
    const wrapper = readFileSync(join(ROOT, "stacks/unicas/deploy/smoke.mjs"), "utf8");
    const appSpaceSmoke = readFileSync(join(ROOT, "scripts/cas-app-space-smoke.mjs"), "utf8");
    const legacySmoke = readFileSync(join(ROOT, "scripts/cas-middleware-smoke.mjs"), "utf8");
    const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(wrapper).toContain("cas-app-space-smoke.mjs");
    expect(appSpaceSmoke).toContain("SpaceCapabilityVersion");
    expect(appSpaceSmoke).toContain("createSpaceCasClient");
    expect(appSpaceSmoke).toContain("cross-Space read");
    expect(appSpaceSmoke).toContain("v1 token on v2 route");
    expect(appSpaceSmoke).toContain("v2 token on v1 route");
    expect(legacySmoke).toContain("CapabilityVersion");
    expect(packageJson.scripts["smoke:v1"]).toContain("cas-middleware-smoke.mjs");
  });

  test("the smoke reset requires an explicit target and backup directory", () => {
    expect(parseResetArgs([])).toEqual({
      execute: false,
      expectedStackId: undefined,
      backupDir: undefined,
    });
    expect(() => parseResetArgs(["--execute"]))
      .toThrow("--execute requires --expected-stack-id");
    expect(() => parseResetArgs(["--execute", "--expected-stack-id", "cas_smoke"]))
      .toThrow("--execute requires --backup-dir");

    const result = spawnSync(
      process.execPath,
      ["stacks/unicas/deploy/reset-smoke.mjs"],
      { cwd: ROOT, encoding: "utf8", env: { ...process.env, PATH: "" } },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No-op");
  });

  test("the smoke reset accepts only the API-bound smoke inventory", () => {
    const stackId = "cas_smoke-id_1";
    const inventory = {
      stacks: [{ stack_id: stackId, display_name: "Production Smoke" }],
      tenants: [{ stack_id: stackId, tenant_id: "deploy-smoke" }],
      controlScopes: [
        { source: "cas_stacks", stack_id: stackId },
        { source: "cas_stack_members", stack_id: stackId },
      ],
      dataScopes: [
        { source: "cas_nodes", stack_id: stackId, tenant_id: "deploy-smoke" },
        { source: "cas_root_domain_revisions", stack_id: stackId, tenant_id: null },
      ],
      objectKeys: [`stacks/${stackId}/tenants/deploy-smoke/nodes-v2/${"a".repeat(64)}`],
      oauthKeys: ["client:example_1"],
      managedIssuers: [{
        stack_id: stackId,
        issuer: `https://api.unicas.work/managed-issuers/${stackId}`,
        audience: `https://api.unicas.work/stacks/${stackId}`,
      }],
    };
    expect(() => validateResetInventory(inventory, stackId)).not.toThrow();
    expect(() => validateResetInventory({
      ...inventory,
      tenants: [{ stack_id: stackId, tenant_id: "real-tenant" }],
    }, stackId)).toThrow("not limited to the deploy-smoke tenant");
    expect(() => validateResetInventory({
      ...inventory,
      controlScopes: [{ source: "cas_control_audit_events", stack_id: "cas_other" }],
    }, stackId)).toThrow("control data contains a stack outside the smoke target");
    expect(() => validateResetInventory({
      ...inventory,
      dataScopes: [{ source: "cas_edges", stack_id: stackId, tenant_id: "real-tenant" }],
    }, stackId)).toThrow("tenant data contains a partition outside the smoke target");
    expect(() => validateResetInventory({
      ...inventory,
      objectKeys: ["stacks/cas_other/tenants/deploy-smoke/nodes-v2/bad"],
    }, stackId)).toThrow("outside the smoke prefix");
    expect(() => validateResetInventory({
      ...inventory,
      oauthKeys: ["client:ok;remove-legacy"],
    }, stackId)).toThrow("unsafe key name");
    expect(() => validateResetInventory(inventory, "cas_bad/id"))
      .toThrow("not a canonical UniCAS stack id");
  });

  test("the smoke reset bounds compound inventory queries for remote D1", () => {
    const queries = [...SCOPED_INVENTORY_QUERIES.control, ...SCOPED_INVENTORY_QUERIES.data];
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.match(/\bSELECT\b/g)).toHaveLength(4);
    }
    const catalog = queries.join("\n");
    for (const table of [
      "cas_stacks",
      "cas_control_audit_events",
      "cas_nodes",
      "cas_direct_upload_sessions",
    ]) expect(catalog).toContain(table);
  });

  test("the smoke reset plan targets only isolated resources", () => {
    const commands = resetPlan({
      objectKeys: [`stacks/cas_smoke/tenants/deploy-smoke/nodes-v2/${"a".repeat(64)}`],
      oauthKeys: ["client:example"],
    });
    const rendered = commands.map((command) => command.join(" ")).join("\n");
    expect(rendered).toContain("unicas-content/stacks/cas_smoke/tenants/deploy-smoke");
    expect(rendered).toContain("d1 execute unicas-control --remote");
    expect(rendered).toContain("d1 execute unicas-tenant --remote");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_stacks");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_nodes");
    expect(rendered).not.toContain("DELETE FROM cas_stacks");
    expect(rendered).toContain("--binding OAUTH_KV --remote");
    expect(rendered).not.toContain("unicas.shazhou.work");
    expect(rendered).not.toContain("unidocs-cas");
  });

  test("the smoke reset backs up and verifies every R2 object before deletion", () => {
    const backupDir = mkdtempSync(join(tmpdir(), "unicas-reset-backup-"));
    try {
      const content = Buffer.from("canonical smoke node");
      const hash = createHash("sha256").update(content).digest("hex");
      const objectKey = `stacks/cas_smoke/tenants/deploy-smoke/nodes-v2/${hash}`;
      const commands = r2BackupPlan({ objectKeys: [objectKey] }, backupDir);
      const rendered = commands[0].join(" ");
      expect(rendered).toContain(`r2 object get unicas-content/${objectKey}`);
      expect(rendered).toContain(`--file ${join(backupDir, "r2", `${hash}.bin`)}`);
      expect(rendered).toContain("--remote");

      mkdirSync(join(backupDir, "r2"));
      writeFileSync(join(backupDir, "r2", `${hash}.bin`), content);
      expect(validateR2BackupFiles([objectKey], backupDir)).toEqual([{
        objectKey,
        file: `r2/${hash}.bin`,
        bytes: content.length,
        sha256: hash,
      }]);

      writeFileSync(join(backupDir, "r2", `${hash}.bin`), "corrupt");
      expect(() => validateR2BackupFiles([objectKey], backupDir))
        .toThrow("R2 backup digest does not match its canonical key");
    } finally {
      rmSync(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("assigns product and service origins to separate Workers", () => {
    const serviceConfig = readFileSync(join(ROOT, "packages/service-cloudflare/wrangler.toml"), "utf8");
    const siteConfig = JSON.parse(readFileSync(join(ROOT, "stacks/unicas/site/wrangler.jsonc"), "utf8"));
    const siteHtml = readFileSync(join(ROOT, "stacks/unicas/site/public/index.html"), "utf8");
    const docsConfig = JSON.parse(readFileSync(join(ROOT, "stacks/unicas/docs-site/wrangler.jsonc"), "utf8"));
    expect(serviceConfig).toContain('pattern = "api.unicas.work"');
    expect(serviceConfig).toContain('pattern = "console.unicas.work"');
    expect(serviceConfig).not.toContain('pattern = "unicas.work"');
    expect(serviceConfig).not.toContain("docs.unicas.work");
    expect(siteConfig.routes).toEqual([{ pattern: "unicas.work", custom_domain: true }]);
    expect(siteConfig.assets.directory).toBe("./public");
    expect(JSON.stringify(siteConfig)).not.toContain("docs.unicas.work");
    expect(siteHtml).toContain('href="https://docs.unicas.work"');
    expect(docsConfig.routes).toEqual([{ pattern: "docs.unicas.work", custom_domain: true }]);
    expect(docsConfig.assets.directory).toBe("./dist");
    expect(docsConfig).not.toHaveProperty("main");
  });
});
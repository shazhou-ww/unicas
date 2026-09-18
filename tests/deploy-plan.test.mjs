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
  ensureEncryptionSecrets,
  parseSecretNames,
} from "../stacks/unicas/deploy/ensure-encryption-secrets.mjs";
import {
  parseResetArgs,
  r2BackupPlan,
  resetPlan,
  SCOPED_INVENTORY_QUERIES,
  validateR2BackupFiles,
  validateResetInventory,
} from "../stacks/unicas/deploy/reset-smoke.mjs";
import { normalizeSmokeBaseUrl } from "../scripts/smoke-target.mjs";
import {
  fetchWorkflowCreatedAt,
  tagProductionDeployment,
} from "../scripts/tag-production-deployment.mjs";

const ROOT = join(import.meta.dirname, "..");
const CI_WORKFLOW = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const DEPLOYMENT_GUIDE = readFileSync(
  join(ROOT, "docs/deployment-and-local-configuration.md"),
  "utf8",
);
const OPERATIONS_GUIDE = readFileSync(join(ROOT, "docs/cas-operations.md"), "utf8");

function workflowTriggers() {
  const end = CI_WORKFLOW.indexOf("jobs:");
  expect(end).toBeGreaterThan(-1);
  return CI_WORKFLOW.slice(0, end);
}

function productionJob() {
  const start = CI_WORKFLOW.indexOf("  deploy-production:");
  const end = CI_WORKFLOW.indexOf("  tag-production:");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return CI_WORKFLOW.slice(start, end);
}

function productionTagJob() {
  const marker = "  tag-production:";
  const offset = CI_WORKFLOW.indexOf(marker);
  expect(offset).toBeGreaterThan(-1);
  return CI_WORKFLOW.slice(offset);
}

function validationJob() {
  const start = CI_WORKFLOW.indexOf("  validate:");
  const end = CI_WORKFLOW.indexOf("  deploy-production:");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return CI_WORKFLOW.slice(start, end);
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe("standalone deployment plan", () => {
  test("keeps production credentials and deployment commands out of validation", () => {
    const job = validationJob();
    expect(job).not.toContain("secrets.");
    expect(job).not.toContain("vars.");
    expect(job).not.toContain("pnpm deploy:production");
    expect(job).not.toMatch(/^\s+run: pnpm deploy:site\r?$/m);
    expect(job).not.toMatch(/^\s+run: pnpm deploy:docs\r?$/m);
  });

  test("builds every Worker upload bundle during unprivileged validation", () => {
    const job = validationJob();
    expect(job).toContain("wrangler deploy --dry-run");
    expect(job).toContain("run: pnpm deploy:site:plan");
    expect(job).toContain("run: pnpm deploy:docs:plan");
  });

  test("gates production deployment behind validation of a release revision", () => {
    const job = productionJob();
    expect(job).toContain("needs: validate");
    expect(job).toContain("github.ref == 'refs/heads/release'");
    expect(job).not.toContain("github.ref == 'refs/heads/main'");
    expect(job).toContain("github.event_name == 'push'");
    expect(job).toContain("github.event_name == 'workflow_dispatch'");
    expect(job).toContain("environment: Production");
    expect(job).toContain("contents: read");
    expect(job).toContain("group: unicas-production");
    expect(job).toContain("queue: max");
    expect(job).toContain("cancel-in-progress: false");
    expect(job).toContain("ref: ${{ github.sha }}");
    expect(job).not.toContain("contents: write");
  });

  test("does not run validation for tag pushes", () => {
    const triggers = workflowTriggers();
    expect(triggers).toMatch(/push:\r?\n\s+branches:\r?\n\s+- "\*\*"/);
    expect(triggers).not.toContain("tags:");
  });

  test("tags only a successfully deployed release push with narrow write access", () => {
    const job = productionTagJob();
    expect(job).toContain("needs: deploy-production");
    expect(job).toContain("success()");
    expect(job).toContain("github.event_name == 'push'");
    expect(job).toContain("github.ref == 'refs/heads/release'");
    expect(job).toContain("actions: read");
    expect(job).toContain("contents: write");
    expect(job).toContain("ref: ${{ github.sha }}");
    expect(job).toContain("persist-credentials: true");
    expect(job).toContain("run: node scripts/tag-production-deployment.mjs");
    expect(job).not.toContain("secrets.");
  });

  test("derives a stable tag from the workflow creation time", async () => {
    let requestedUrl;
    const createdAt = await fetchWorkflowCreatedAt({
      apiUrl: "https://api.github.test",
      repository: "shazhou-ww/unicas",
      runId: "1234",
      token: "test-token",
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({ created_at: "2026-09-15T23:59:59Z" }),
        };
      },
    });

    expect(requestedUrl).toBe("https://api.github.test/repos/shazhou-ww/unicas/actions/runs/1234");
    expect(createdAt).toBe("2026-09-15T23:59:59Z");
  });

  test("creates one immutable annotated tag and accepts an idempotent rerun", () => {
    const directory = mkdtempSync(join(tmpdir(), "unicas-production-tag-"));
    const remote = join(directory, "remote.git");
    const worktree = join(directory, "worktree");
    const tagName = "production-20260915-42";
    const runUrl = "https://github.com/shazhou-ww/unicas/actions/runs/1234";

    try {
      git(directory, ["init", "--bare", remote]);
      git(directory, ["init", worktree]);
      writeFileSync(join(worktree, "revision.txt"), "first\n");
      git(worktree, ["add", "revision.txt"]);
      git(worktree, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "first revision",
      ]);
      git(worktree, ["remote", "add", "origin", remote]);
      const deployedSha = git(worktree, ["rev-parse", "HEAD"]);
      const deployment = {
        createdAt: "2026-09-15T23:59:59Z",
        runNumber: "42",
        deployedSha,
        runUrl,
        cwd: worktree,
      };

      expect(tagProductionDeployment(deployment)).toEqual({
        status: "created",
        tagName,
      });
      const originalTagObject = git(directory, [
        "--git-dir",
        remote,
        "rev-parse",
        `refs/tags/${tagName}`,
      ]);
      const metadata = git(directory, [
        "--git-dir",
        remote,
        "cat-file",
        "-p",
        `refs/tags/${tagName}`,
      ]);
      expect(metadata).toContain(`object ${deployedSha}`);
      expect(metadata).toContain("type commit");
      expect(metadata).toContain(`Workflow run: ${runUrl}`);

      expect(tagProductionDeployment(deployment)).toEqual({
        status: "existing",
        tagName,
      });
      expect(git(directory, [
        "--git-dir",
        remote,
        "rev-parse",
        `refs/tags/${tagName}`,
      ])).toBe(originalTagObject);

      writeFileSync(join(worktree, "revision.txt"), "second\n");
      git(worktree, ["add", "revision.txt"]);
      git(worktree, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "second revision",
      ]);
      expect(() => tagProductionDeployment({
        ...deployment,
        deployedSha: git(worktree, ["rev-parse", "HEAD"]),
      })).toThrow("refusing to move it");
      expect(git(directory, [
        "--git-dir",
        remote,
        "rev-parse",
        `refs/tags/${tagName}`,
      ])).toBe(originalTagObject);
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("documents production tag policy and same-run recovery", () => {
    for (const expected of [
      "production-YYYYMMDD-<workflow-run-number>",
      "Immutable production deployment tags",
      "refs/tags/production-*",
      "Restrict updates",
      "Restrict deletions",
      "Restrict creations",
      "Re-run failed jobs",
      "git ls-remote --tags",
    ]) expect(DEPLOYMENT_GUIDE).toContain(expected);
    expect(OPERATIONS_GUIDE).toContain("A `tag-production` failure happens only after");
    expect(OPERATIONS_GUIDE).toContain("production is live even though its audit marker is missing");
  });

  test("deploys each production Worker in order with environment-scoped credentials", () => {
    const job = productionJob();
    const service = job.indexOf("run: pnpm deploy:production");
    const site = job.indexOf("run: pnpm deploy:site");
    const docs = job.indexOf("run: pnpm deploy:docs");
    expect(service).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(service);
    expect(docs).toBeGreaterThan(site);

    for (const binding of [
      "CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}",
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
      "OAUTH_GOOGLE_CLIENT_ID: ${{ vars.OAUTH_GOOGLE_CLIENT_ID }}",
      "OAUTH_MICROSOFT_CLIENT_ID: ${{ vars.OAUTH_MICROSOFT_CLIENT_ID }}",
      "OAUTH_GITHUB_CLIENT_ID: ${{ vars.OAUTH_GITHUB_CLIENT_ID }}",
      "UNICAS_SMOKE_APP_ID: ${{ vars.UNICAS_SMOKE_APP_ID }}",
      "UNICAS_SMOKE_ISSUER: ${{ vars.UNICAS_SMOKE_ISSUER }}",
      "UNICAS_SMOKE_AUDIENCE: ${{ vars.UNICAS_SMOKE_AUDIENCE }}",
      "UNICAS_SMOKE_KID: ${{ vars.UNICAS_SMOKE_KID }}",
      "UNICAS_SMOKE_SPACE_ID: ${{ vars.UNICAS_SMOKE_SPACE_ID }}",
    ]) expect(job).toContain(binding);
    for (const secret of [
      "OAUTH_GOOGLE_CLIENT_SECRET",
      "OAUTH_MICROSOFT_CLIENT_SECRET",
      "OAUTH_GITHUB_CLIENT_SECRET",
    ]) {
      expect(job).toContain(`${secret}: $` + `{{ secrets.${secret} }}`);
    }
    expect(job).not.toContain("secrets.SESSION_ENCRYPTION_KEYS");
    expect(job).not.toContain("secrets.OAUTH_STATE_ENCRYPTION_KEY");
    expect(job).toContain('wrangler secret put "$name"');
  });

  test("creates missing encryption secrets before a production deployment", () => {
    const plan = deploymentPlan({ production: true });
    expect(plan[0]).toEqual(["node", "stacks/unicas/deploy/ensure-encryption-secrets.mjs"]);
    expect(plan[1]).toEqual(["pnpm", "--filter", "@unicas/service-cloudflare", "build"]);

    const calls = [];
    const created = ensureEncryptionSecrets({
      execute(args, input) {
        calls.push({ args, input });
        return args[1] === "list" ? '[{"name":"OAUTH_STATE_ENCRYPTION_KEY"}]' : "";
      },
      now: new Date("2026-09-18T00:00:00Z"),
      random: () => Buffer.alloc(32, 7),
    });
    expect(created).toEqual(["SESSION_ENCRYPTION_KEYS"]);
    expect(calls).toEqual([
      { args: ["secret", "list", "--format", "json"], input: undefined },
      {
        args: ["secret", "put", "SESSION_ENCRYPTION_KEYS"],
        input: JSON.stringify({ "2026-09": Buffer.alloc(32, 7).toString("base64url") }),
      },
    ]);
  });

  test("preserves existing encryption secrets and generates valid independent values", () => {
    expect(parseSecretNames('[{"name":"SESSION_ENCRYPTION_KEYS"}]')).toEqual(
      new Set(["SESSION_ENCRYPTION_KEYS"]),
    );
    const calls = [];
    expect(ensureEncryptionSecrets({
      execute(args, input) {
        calls.push({ args, input });
        return '[{"name":"SESSION_ENCRYPTION_KEYS"},{"name":"OAUTH_STATE_ENCRYPTION_KEY"}]';
      },
    })).toEqual([]);
    expect(calls).toHaveLength(1);

    let fill = 10;
    const createdCalls = [];
    expect(ensureEncryptionSecrets({
      execute(args, input) {
        createdCalls.push({ args, input });
        return args[1] === "list" ? "[]" : "";
      },
      now: new Date("2026-09-18T00:00:00Z"),
      random: () => Buffer.alloc(32, fill++),
    })).toEqual(["SESSION_ENCRYPTION_KEYS", "OAUTH_STATE_ENCRYPTION_KEY"]);
    const sessionKey = JSON.parse(createdCalls[1].input)["2026-09"];
    const oauthStateKey = createdCalls[2].input;
    expect(Buffer.from(sessionKey, "base64url")).toHaveLength(32);
    expect(Buffer.from(oauthStateKey, "base64url")).toHaveLength(32);
    expect(sessionKey).not.toBe(oauthStateKey);
  });

  test("restricts the ephemeral smoke key and removes it after every outcome", () => {
    const job = productionJob();
    const service = job.indexOf("run: pnpm deploy:production");
    const cleanup = job.indexOf("rm -f -- .wrangler/cas-deploy/github-actions-smoke-key.pem");
    const site = job.indexOf("run: pnpm deploy:site");
    expect(job).toContain("UNICAS_SMOKE_PRIVATE_KEY_PKCS8: ${{ secrets.UNICAS_SMOKE_PRIVATE_KEY_PKCS8 }}");
    expect(job).toContain("install -d -m 700 .wrangler/cas-deploy");
    expect(job).toContain("chmod 600 .wrangler/cas-deploy/github-actions-smoke-key.pem");
    expect(job).toContain("UNICAS_SMOKE_KEY_FILE: github-actions-smoke-key.pem");
    expect(job).toContain("if: ${{ always() }}");
    expect(cleanup).toBeGreaterThan(service);
    expect(cleanup).toBeLessThan(site);
  });

  test("checks every public production origin after all deployments", () => {
    const job = productionJob();
    const docs = job.indexOf("run: pnpm deploy:docs");
    for (const target of [
      "https://api.unicas.work/health",
      "https://console.unicas.work/",
      "https://unicas.work/",
      "https://docs.unicas.work/",
    ]) expect(job.indexOf(target)).toBeGreaterThan(docs);
    expect(job).not.toContain("--location");
    expect(job.match(/--proto '=https'/g)).toHaveLength(4);
    expect(job).toContain("302 https://console.unicas.work/admin/");
    expect(job).toContain('"service":"unicas"');
    expect(job).toContain("UniCAS | Content-addressed storage infrastructure");
    expect(job).toContain("Overview | UniCAS Docs");
  });

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
      .toThrow("production deployment configuration is missing");

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
    expect(result.stderr).toContain("production deployment configuration is missing");
    expect(result.stdout).not.toContain("> ");
  });

  test("injects all OAuth client IDs into the production Worker deployment", () => {
    const environment = {
      OAUTH_GOOGLE_CLIENT_ID: "google-id",
      OAUTH_MICROSOFT_CLIENT_ID: "microsoft-id",
      OAUTH_GITHUB_CLIENT_ID: "github-id",
    };
    const deploy = deploymentPlan({ dryRun: true, environment })[1];
    expect(deploy).toEqual(expect.arrayContaining([
      "--var", "OAUTH_GOOGLE_CLIENT_ID:google-id",
      "--var", "OAUTH_MICROSOFT_CLIENT_ID:microsoft-id",
      "--var", "OAUTH_GITHUB_CLIENT_ID:github-id",
    ]));
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
    expect(appSpaceSmoke).toContain("GC keeps current leased nodes");
    expect(appSpaceSmoke).not.toContain("gc.deleted === 0");
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
      "cas_apps",
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
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_apps");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_accounts");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_nodes");
    expect(rendered).not.toContain("cas_platform_principals");
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

  test("publishes a public-key-only issuer for deployment smoke", () => {
    const site = join(ROOT, "stacks/unicas/site/public");
    const metadata = JSON.parse(readFileSync(
      join(site, ".well-known/oauth-authorization-server/deploy-smoke"),
      "utf8",
    ));
    const jwks = JSON.parse(readFileSync(join(site, "deploy-smoke/jwks.json"), "utf8"));
    const headers = readFileSync(join(site, "_headers"), "utf8");

    expect(metadata).toEqual({
      issuer: "https://unicas.work/deploy-smoke",
      authorization_endpoint: "https://unicas.work/deploy-smoke/authorize",
      token_endpoint: "https://unicas.work/deploy-smoke/token",
      jwks_uri: "https://unicas.work/deploy-smoke/jwks.json",
      scopes_supported: ["cas:read", "cas:write", "cas:manage"],
      code_challenge_methods_supported: ["S256"],
    });
    const smokeKey = jwks.keys.find((key) => key.kid === "github-actions-2026-09");
    expect(smokeKey).toMatchObject({
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      key_ops: ["verify"],
      kid: "github-actions-2026-09",
    });
    for (const key of jwks.keys) expect(key).not.toHaveProperty("d");
    expect(headers).toContain("/.well-known/oauth-authorization-server/deploy-smoke");
    expect(headers).toContain("/deploy-smoke/jwks.json");
    expect(headers.match(/Content-Type: application\/json/g)).toHaveLength(2);
  });
});
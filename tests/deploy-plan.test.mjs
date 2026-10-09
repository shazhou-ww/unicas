import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import {
  deploymentPlan,
  parseArgs,
  validateDeploymentEnvironment,
} from "../stacks/unicas/deploy/deploy.mjs";
import { resolveManualTracingDeployment } from "../stacks/unicas/deploy/manual-tracing.mjs";
import {
  parseManualTracingSecretArgs,
  syncManualTracingSecrets,
} from "../stacks/unicas/deploy/sync-manual-tracing-secrets.mjs";
import {
  ensureEncryptionSecrets,
  parseSecretNames,
} from "../stacks/unicas/deploy/ensure-encryption-secrets.mjs";
import {
  bootstrapStatements,
  inventoryDigest,
  parseResetArgs,
  r2BackupPlan,
  resetPlan,
  SCOPED_INVENTORY_QUERIES,
  validateR2BackupFiles,
  validateResetInventory,
} from "../stacks/unicas/deploy/reset-smoke.mjs";
import { CONTROL_SCHEMA_MIGRATIONS } from "../packages/service-cloudflare/src/control-schema.ts";
import { normalizeSmokeBaseUrl } from "../scripts/smoke-target.mjs";
import {
  fetchWorkflowCreatedAt,
  tagProductionDeployment,
} from "../scripts/tag-production-deployment.mjs";
import { verifyReleaseRevision } from "../scripts/verify-release-revision.mjs";
import {
  buildProductionSpacesConfig,
  writeProductionSpacesSecrets,
} from "../stacks/unicas/spaces/deployment-config.mjs";
import {
  parseSpacesDeployArgs,
  runSpacesCommand,
  spacesBootstrapEnvironment,
  spacesDeploymentPlan,
} from "../stacks/unicas/spaces/deploy.mjs";

const ROOT = join(import.meta.dirname, "..");
const CI_WORKFLOW = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const ROOT_PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const RECOVERY_WORKFLOW = readFileSync(
  join(ROOT, ".github/workflows/recover-spaces.yml"),
  "utf8",
);
const DOCS_WORKFLOW = readFileSync(
  join(ROOT, ".github/workflows/deploy-docs.yml"),
  "utf8",
);
const DEPLOYMENT_GUIDE = readFileSync(
  join(ROOT, "packages/docs-site/content/deployment-and-local-configuration.md"),
  "utf8",
);
const OPERATIONS_GUIDE = readFileSync(
  join(ROOT, "packages/docs-site/content/cas-operations.md"),
  "utf8",
);
const OBSERVABILITY_GUIDE = readFileSync(
  join(ROOT, "packages/docs-site/content/observability.md"),
  "utf8",
);
const OBSERVABILITY_SKILL = readFileSync(
  join(ROOT, ".agents/skills/unicas-observability/SKILL.md"),
  "utf8",
);
const SPACES_WRANGLER_CONFIG = JSON.parse(readFileSync(
  join(ROOT, "stacks/unicas/spaces/wrangler.jsonc"),
  "utf8",
));
const OBSERVABILITY_POLICY = {
  enabled: true,
  logs: {
    enabled: true,
    head_sampling_rate: 0.05,
    invocation_logs: false,
    persist: true,
    destinations: [],
  },
  traces: {
    enabled: false,
    head_sampling_rate: 0,
    persist: false,
    destinations: [],
  },
};
const TRACE_HMAC_KEYS = JSON.stringify({
  active: "2026-09",
  keys: { "2026-09": Buffer.alloc(32, 7).toString("base64url") },
});
const TRACE_DEPLOYMENT_ENVIRONMENT = Object.freeze({
  UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0.01",
  UNICAS_OTLP_TRACES_ENDPOINT: "https://collector.example/otlp/v1/traces",
  UNICAS_OTLP_AUTHORIZATION: "Basic synthetic-authorization",
  UNICAS_TRACE_HMAC_KEYS: TRACE_HMAC_KEYS,
});

function spacesProductionEnvironment(overrides = {}) {
  return {
    SPACES_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
    SPACES_GOOGLE_CLIENT_ID: "google-client",
    SPACES_SIGNING_KID: "spaces-key",
    SPACES_SIGNING_PUBLIC_JWKS: JSON.stringify({
      keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y", kid: "spaces-key" }],
    }),
    SPACES_SMOKE_PRINCIPAL_ID: "smoke-principal",
    SPACES_UNICAS_AUDIENCE: "https://api.unicas.work",
    SPACES_GOOGLE_CLIENT_SECRET: "google-secret",
    SPACES_SIGNING_PRIVATE_KEY_PKCS8: "private-key",
    SPACES_SMOKE_CREDENTIAL: "smoke-secret",
    ...overrides,
  };
}

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

function spacesBootstrapJob() {
  const start = RECOVERY_WORKFLOW.indexOf("  recover:");
  const end = RECOVERY_WORKFLOW.length;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return RECOVERY_WORKFLOW.slice(start, end);
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
  test("discovers the repository observability skill and keeps its safety gate aligned", () => {
    expect(OBSERVABILITY_SKILL).toMatch(/^---\r?\nname: unicas-observability\r?\n/);
    expect(OBSERVABILITY_SKILL).toContain("investigating UniCAS latency");
    for (const span of [
      "unicas.capability.verify",
      "unicas.node.validate",
      "unicas.root_refs.commit",
      "unicas.cleanup.run",
    ]) {
      expect(OBSERVABILITY_SKILL).toContain(span);
      expect(OBSERVABILITY_GUIDE).toContain(span);
    }
    expect(OBSERVABILITY_GUIDE).toContain('"invocation_logs": false');
    expect(OBSERVABILITY_GUIDE).toContain("production tracing is explicitly");
    expect(OBSERVABILITY_GUIDE).toContain("Sampling is not a confidentiality control");
    const skillsLock = readFileSync(join(ROOT, "skills-lock.json"), "utf8");
    expect(skillsLock).not.toContain("unicas-observability");
  });

  test("keeps the Spaces App on its own public bindings", () => {
    expect(SPACES_WRANGLER_CONFIG.main).toBe("../../../packages/spaces/src/worker.ts");
    expect(SPACES_WRANGLER_CONFIG.placement).toEqual({ region: "aws:ap-southeast-1" });
    expect(SPACES_WRANGLER_CONFIG.routes).toEqual([
      { pattern: "spaces.unicas.work", custom_domain: true },
    ]);
    expect(SPACES_WRANGLER_CONFIG.d1_databases).toEqual([
      expect.objectContaining({ binding: "SPACES_DB", database_name: "unicas-spaces" }),
    ]);
    expect(SPACES_WRANGLER_CONFIG.assets.run_worker_first).toEqual([
      "/api", "/api/*", "/auth", "/auth/*", "/.well-known", "/.well-known/*", "/oauth", "/oauth/*",
    ]);
    expect(SPACES_WRANGLER_CONFIG.observability).toEqual(OBSERVABILITY_POLICY);
    expect(SPACES_WRANGLER_CONFIG.vars.UNICAS_MANUAL_TRACE_SAMPLE_RATE).toBe("0");
    expect(JSON.stringify(SPACES_WRANGLER_CONFIG)).not.toMatch(/CAS_CONTROL_DB|CAS_DB|CAS_R2|durable_objects|kv_namespaces/);
  });

  test("requires one complete validated profile for nonzero manual tracing", () => {
    expect(resolveManualTracingDeployment({})).toEqual({
      enabled: false,
      variables: {},
      secrets: {},
    });
    expect(resolveManualTracingDeployment({
      UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0",
      UNICAS_OTLP_TRACES_ENDPOINT: "http://inactive.invalid",
      UNICAS_OTLP_AUTHORIZATION: "inactive",
      UNICAS_TRACE_HMAC_KEYS: "inactive",
    })).toEqual({
      enabled: false,
      variables: {},
      secrets: {},
    });
    expect(resolveManualTracingDeployment(TRACE_DEPLOYMENT_ENVIRONMENT)).toEqual({
      enabled: true,
      variables: {
        UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0.01",
        UNICAS_OTLP_TRACES_ENDPOINT: "https://collector.example/otlp/v1/traces",
      },
      secrets: {
        UNICAS_OTLP_AUTHORIZATION: "Basic synthetic-authorization",
        UNICAS_TRACE_HMAC_KEYS: TRACE_HMAC_KEYS,
      },
    });

    for (const name of [
      "UNICAS_OTLP_TRACES_ENDPOINT",
      "UNICAS_OTLP_AUTHORIZATION",
      "UNICAS_TRACE_HMAC_KEYS",
    ]) {
      const incomplete = { ...TRACE_DEPLOYMENT_ENVIRONMENT };
      delete incomplete[name];
      expect(() => resolveManualTracingDeployment(incomplete)).toThrow(
        `${name} is required when manual tracing is sampled`,
      );
    }
    expect(() => resolveManualTracingDeployment({
      ...TRACE_DEPLOYMENT_ENVIRONMENT,
      UNICAS_OTLP_TRACES_ENDPOINT: "https://user@example.com/otlp/v1/traces",
    })).toThrow("credential-free HTTPS");
    expect(() => resolveManualTracingDeployment({
      ...TRACE_DEPLOYMENT_ENVIRONMENT,
      UNICAS_OTLP_AUTHORIZATION: "Basic value\r\nunsafe: header",
    })).toThrow("single HTTP header value");
    expect(() => resolveManualTracingDeployment({
      ...TRACE_DEPLOYMENT_ENVIRONMENT,
      UNICAS_TRACE_HMAC_KEYS: JSON.stringify({
        active: "short",
        keys: { short: Buffer.alloc(8).toString("base64url") },
      }),
    })).toThrow("short key");
  });

  test("synchronizes service tracing secrets through stdin without exposing values in arguments", () => {
    expect(parseManualTracingSecretArgs([])).toEqual({ env: undefined });
    expect(parseManualTracingSecretArgs(["--env", "staging"])).toEqual({ env: "staging" });
    expect(() => parseManualTracingSecretArgs(["--env", "Staging"]))
      .toThrow("lowercase-environment");

    const calls = [];
    expect(syncManualTracingSecrets({
      environment: TRACE_DEPLOYMENT_ENVIRONMENT,
      env: "staging",
      execute(args, input) {
        calls.push({ args, input });
      },
    })).toEqual(["UNICAS_OTLP_AUTHORIZATION", "UNICAS_TRACE_HMAC_KEYS"]);
    expect(calls).toEqual([
      {
        args: ["secret", "put", "UNICAS_OTLP_AUTHORIZATION", "--env", "staging"],
        input: "Basic synthetic-authorization",
      },
      {
        args: ["secret", "put", "UNICAS_TRACE_HMAC_KEYS", "--env", "staging"],
        input: TRACE_HMAC_KEYS,
      },
    ]);
    expect(calls.map(({ args }) => args.join(" ")).join("\n"))
      .not.toContain("synthetic-authorization");

    expect(syncManualTracingSecrets({
      environment: { UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0" },
      execute() {
        throw new Error("disabled tracing must not synchronize secrets");
      },
    })).toEqual([]);
  });

  test("generates a secret-free Spaces production config and a separate ephemeral secrets file", () => {
    const environment = spacesProductionEnvironment();
    const config = buildProductionSpacesConfig(SPACES_WRANGLER_CONFIG, environment);
    expect(config.d1_databases[0].database_id).toBe(environment.SPACES_D1_DATABASE_ID);
    expect(config.vars).toMatchObject({
      GOOGLE_CLIENT_ID: "google-client",
      SPACES_SIGNING_KID: "spaces-key",
      SPACES_SMOKE_ENABLED: "true",
      SPACES_SMOKE_PRINCIPAL_ID: "smoke-principal",
      UNICAS_AUDIENCE: "https://api.unicas.work",
      UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0",
    });
    expect(config.observability).toEqual(OBSERVABILITY_POLICY);
    expect(JSON.stringify(config)).not.toContain("google-secret");
    expect(JSON.stringify(config)).not.toContain("private-key");
    expect(JSON.stringify(config)).not.toContain("smoke-secret");

    const directory = mkdtempSync(join(tmpdir(), "unicas-spaces-secrets-"));
    const output = join(directory, "secrets.json");
    try {
      writeProductionSpacesSecrets(environment, output);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
        GOOGLE_CLIENT_SECRET: "google-secret",
        SPACES_SIGNING_PRIVATE_KEY: "private-key",
        SPACES_SMOKE_CREDENTIAL: "smoke-secret",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("adds the same nonzero tracing profile only to Spaces variables and its ephemeral secrets file", () => {
    const environment = spacesProductionEnvironment(TRACE_DEPLOYMENT_ENVIRONMENT);
    const config = buildProductionSpacesConfig(SPACES_WRANGLER_CONFIG, environment);
    expect(config.vars).toMatchObject({
      UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0.01",
      UNICAS_OTLP_TRACES_ENDPOINT: "https://collector.example/otlp/v1/traces",
    });
    expect(JSON.stringify(config)).not.toContain("synthetic-authorization");
    expect(JSON.stringify(config)).not.toContain(TRACE_HMAC_KEYS);

    const directory = mkdtempSync(join(tmpdir(), "unicas-spaces-tracing-secrets-"));
    const output = join(directory, "secrets.json");
    try {
      writeProductionSpacesSecrets(environment, output);
      expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
        UNICAS_OTLP_AUTHORIZATION: "Basic synthetic-authorization",
        UNICAS_TRACE_HMAC_KEYS: TRACE_HMAC_KEYS,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("orders Spaces build, migration, deploy, and smoke and refuses implicit deployment", () => {
    expect(() => parseSpacesDeployArgs([])).toThrow("implicit production deployment is refused");
    expect(spacesDeploymentPlan({ dryRun: true, production: false })).toEqual([
      ["pnpm", "--filter", "@unicas/spaces", "build"],
      [
        "pnpm", "--filter", "@unicas/service-cloudflare", "exec", "wrangler", "deploy",
        "--dry-run", "--config", "../../stacks/unicas/spaces/wrangler.jsonc",
      ],
    ]);
    const production = spacesDeploymentPlan({ dryRun: false, production: true });
    expect(production.map((command) => command.join(" "))).toEqual([
      "pnpm --filter @unicas/spaces build",
      "pnpm --filter @unicas/service-cloudflare exec wrangler d1 migrations apply SPACES_DB --remote --config ../../.wrangler/spaces/wrangler.production.json",
      "node packages/spaces/scripts/preflight.mjs",
      "pnpm --filter @unicas/service-cloudflare exec wrangler deploy --config ../../.wrangler/spaces/wrangler.production.json --secrets-file ../../.wrangler/spaces/secrets.json",
      "pnpm spaces:smoke --base-url https://spaces.unicas.work",
    ]);
    expect(() => spacesDeploymentPlan({ bootstrap: true, dryRun: false, production: false }, {}))
      .toThrow("SPACES_BOOTSTRAP_DEPLOY_CONFIRM=spaces.unicas.work");
    const bootstrap = spacesDeploymentPlan(
      { bootstrap: true, dryRun: false, production: false },
      { SPACES_BOOTSTRAP_DEPLOY_CONFIRM: "spaces.unicas.work" },
    );
    expect(bootstrap.map((command) => command.join(" "))).toEqual([
      "pnpm --filter @unicas/spaces build",
      "pnpm --filter @unicas/service-cloudflare exec wrangler d1 migrations apply SPACES_DB --remote --config ../../.wrangler/spaces/wrangler.production.json",
      "pnpm --filter @unicas/service-cloudflare exec wrangler deploy --config ../../.wrangler/spaces/wrangler.production.json --secrets-file ../../.wrangler/spaces/secrets.json",
    ]);
  });

  test("throws a Spaces command failure so outer secret cleanup can run", () => {
    expect(() => runSpacesCommand(["failing-command"], () => ({ status: 7 })))
      .toThrow("Spaces deployment command failed");
  });

  test("uses disabled Google placeholders only for the one-time Spaces bootstrap", () => {
    expect(spacesBootstrapEnvironment({
      SPACES_SMOKE_ENABLED: "true",
      UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0.01",
    })).toMatchObject({
      SPACES_GOOGLE_CLIENT_ID: "bootstrap-disabled",
      SPACES_GOOGLE_CLIENT_SECRET: "bootstrap-disabled",
      SPACES_SMOKE_ENABLED: "false",
      UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0",
    });
    expect(spacesBootstrapEnvironment({
      SPACES_GOOGLE_CLIENT_ID: "configured-client",
      SPACES_GOOGLE_CLIENT_SECRET: "configured-secret",
    })).toMatchObject({
      SPACES_GOOGLE_CLIENT_ID: "configured-client",
      SPACES_GOOGLE_CLIENT_SECRET: "configured-secret",
      SPACES_SMOKE_ENABLED: "false",
    });
  });

  test("keeps production credentials and deployment commands out of validation", () => {
    const job = validationJob();
    expect(job).not.toContain("secrets.");
    expect(job).not.toContain("vars.");
    expect(job).not.toContain("pnpm deploy:production");
    expect(job).not.toMatch(/^\s+run: pnpm deploy:site\r?$/m);
    expect(job).not.toMatch(/^\s+run: pnpm deploy:docs\r?$/m);
  });

  test("keeps validation authoritative at release and explicit preflight boundaries", () => {
    const job = validationJob();
    expect(job).toContain("run: pnpm validate:release");
    expect(job).not.toMatch(/^\s+run: pnpm validate\r?$/mu);
    expect(job).toContain("github.ref == 'refs/heads/release'");
    expect(job).toContain("github.event_name == 'workflow_dispatch'");
    expect(job).toContain(
      "node scripts/verify-release-revision.mjs \"$GITHUB_SHA\" origin/main",
    );
    expect(job).not.toContain(
      "git merge-base --is-ancestor \"$GITHUB_SHA\" origin/main",
    );
    expect(job).not.toContain("pnpm test:exhaustive");
    expect(job).not.toContain("wrangler deploy --dry-run");
    expect(job).not.toContain("DOCS_SOURCE_REVISION");
    expect(ROOT_PACKAGE.scripts.validate).toContain("pnpm test:quick");
    expect(ROOT_PACKAGE.scripts.validate).toContain("pnpm build");
    expect(ROOT_PACKAGE.scripts.validate).toContain("pnpm typecheck");
    expect(ROOT_PACKAGE.scripts["validate:release"]).toMatch(/^pnpm validate && /);
    expect(ROOT_PACKAGE.scripts["validate:release"]).toContain("pnpm check:release");
    expect(ROOT_PACKAGE.scripts["validate:release"]).toContain(
      "pnpm --filter @unicas/service-cloudflare test",
    );
    expect(ROOT_PACKAGE.scripts["validate:release"]).toContain("pnpm sdk:artifacts");
    expect(ROOT_PACKAGE.scripts["validate:release"]).toContain("test:browser");
    expect(ROOT_PACKAGE.scripts["validate:release"]).toContain("wrangler deploy --dry-run");
    expect(CI_WORKFLOW).not.toContain("run: pnpm check:ideas:remote");
    expect(CI_WORKFLOW).toContain("DOCS_SOURCE_REVISION: ${{ github.sha }}");
  });

  test("gates production deployment behind validation of a release revision", () => {
    const job = productionJob();
    expect(job).toContain("needs: validate");
    expect(job).toContain("github.ref == 'refs/heads/release'");
    expect(job).toContain("vars.SPACES_RELEASE_ENABLED == 'true'");
    expect(job).not.toContain("github.ref == 'refs/heads/main'");
    expect(job).toContain("github.event_name == 'push'");
    expect(job).not.toContain("github.event_name == 'workflow_dispatch'");
    expect(job).toContain("environment: Production");
    expect(job).toContain("contents: read");
    expect(job).toContain("group: unicas-production");
    expect(job).toContain("queue: max");
    expect(job).toContain("cancel-in-progress: false");
    expect(job).toContain("ref: ${{ github.sha }}");
    expect(job).toContain(
      "node scripts/verify-release-revision.mjs \"$GITHUB_SHA\" origin/main",
    );
    expect(job).not.toContain(
      "git merge-base --is-ancestor \"$GITHUB_SHA\" origin/main",
    );
    expect(job).not.toContain("contents: write");
  });

  test("accepts only tree-identical promotion merges from main", () => {
    const directory = mkdtempSync(join(tmpdir(), "unicas-release-revision-"));
    try {
      git(directory, ["init", "--initial-branch=main"]);
      git(directory, ["config", "user.name", "Release Test"]);
      git(directory, ["config", "user.email", "release-test@example.com"]);
      writeFileSync(join(directory, "candidate.txt"), "base\n");
      git(directory, ["add", "candidate.txt"]);
      git(directory, ["commit", "-m", "base"]);
      git(directory, ["branch", "release"]);

      writeFileSync(join(directory, "candidate.txt"), "candidate\n");
      git(directory, ["commit", "-am", "candidate"]);
      const mainParent = git(directory, ["rev-parse", "HEAD"]);

      git(directory, ["checkout", "release"]);
      git(directory, ["merge", "--no-ff", "main", "-m", "promote main"]);
      const releaseRevision = git(directory, ["rev-parse", "HEAD"]);
      expect(verifyReleaseRevision({
        revision: releaseRevision,
        mainRef: "main",
        cwd: directory,
      })).toEqual({
        releaseParent: expect.any(String),
        mainParent,
      });

      git(directory, ["checkout", "main"]);
      writeFileSync(join(directory, "later.txt"), "later\n");
      git(directory, ["add", "later.txt"]);
      git(directory, ["commit", "-m", "later main change"]);
      git(directory, ["checkout", "release"]);
      expect(verifyReleaseRevision({
        revision: releaseRevision,
        mainRef: "main",
        cwd: directory,
      })).toEqual({
        releaseParent: expect.any(String),
        mainParent,
      });

      git(directory, ["checkout", "-b", "release-with-change", `${releaseRevision}^1`]);
      writeFileSync(join(directory, "release-only.txt"), "release-only\n");
      git(directory, ["add", "release-only.txt"]);
      git(directory, ["commit", "-m", "release-only change"]);
      git(directory, ["merge", "--no-ff", mainParent, "-m", "invalid promotion"]);
      const invalidRevision = git(directory, ["rev-parse", "HEAD"]);
      expect(() => verifyReleaseRevision({
        revision: invalidRevision,
        mainRef: "main",
        cwd: directory,
      })).toThrow("release promotion tree differs from its main parent");

      git(directory, ["checkout", "main"]);
      const nonMergeRevision = git(directory, ["rev-parse", "HEAD"]);
      expect(() => verifyReleaseRevision({
        revision: nonMergeRevision,
        mainRef: "main",
        cwd: directory,
      })).toThrow("two-parent promotion merge");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);

  test("isolates Spaces recovery behind manual dispatch and Production review", () => {
    const job = spacesBootstrapJob();
    expect(RECOVERY_WORKFLOW).toMatch(/on:\r?\n\s+workflow_dispatch:/);
    expect(RECOVERY_WORKFLOW).not.toMatch(/\n\s+push:/);
    expect(RECOVERY_WORKFLOW).not.toMatch(/\n\s+pull_request:/);
    expect(workflowTriggers()).not.toContain("spaces_action:");
    expect(CI_WORKFLOW).not.toContain("bootstrap-spaces");
    expect(job).toContain("environment: Production");
    expect(job).toContain("group: unicas-production");
    expect(job).toContain("queue: max");
    expect(job).toContain("cancel-in-progress: false");
    expect(job).toContain("inputs.action == 'provision-deploy'");
    expect(job).toContain("inputs.revision");
    expect(job).toContain("git merge-base --is-ancestor \"$REVISION\" origin/main");
    expect(job).toContain("wrangler d1 create unicas-spaces --location enam");
    expect(job).toContain("run: pnpm deploy:spaces:bootstrap");
    expect(job).toContain("inputs.action == 'principals'");
    expect(job).toContain("pnpm spaces:bootstrap -- --mode google");
    expect(job).toContain("pnpm spaces:bootstrap -- --mode smoke");
    expect(job).toContain("if: ${{ always() && inputs.action == 'principals' }}");
  });

  test("isolates documentation deployment behind exact-primary Production review", () => {
    const workflow = DOCS_WORKFLOW;
    const checkout = workflow.indexOf("- name: Check out requested revision");
    const verify = workflow.indexOf("- name: Verify exact authoritative primary revision");
    const install = workflow.indexOf("- name: Install dependencies");
    const deploy = workflow.indexOf("- name: Deploy documentation");
    const smoke = workflow.indexOf("- name: Verify documentation routes and source revision");

    expect(workflow).toMatch(/on:\r?\n\s+workflow_dispatch:/u);
    expect(workflow).not.toMatch(/\n\s+push:/u);
    expect(workflow).not.toMatch(/\n\s+pull_request:/u);
    expect(workflow).toContain("description: Full lowercase commit SHA equal to current main");
    expect(workflow).toContain('[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]]');
    expect(checkout).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(checkout);
    expect(install).toBeGreaterThan(verify);
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$REVISION"');
    expect(workflow).toContain("git fetch --no-tags origin main:refs/remotes/origin/main");
    expect(workflow).toContain('test "$(git rev-parse origin/main)" = "$REVISION"');
    expect(workflow).not.toContain("git merge-base --is-ancestor");

    expect(workflow).toContain("environment: Production");
    expect(workflow.match(/contents: read/gu)).toHaveLength(2);
    expect(workflow).not.toContain("id-token:");
    expect(workflow).toContain("group: unicas-production");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("persist-credentials: false");

    expect(workflow).toContain("pnpm check:ideas:commit");
    expect(workflow).toContain("pnpm --filter @unicas/docs-site test");
    expect(workflow).toContain("pnpm --filter @unicas/docs-site typecheck");
    expect(workflow).toContain("pnpm --filter @unicas/docs-site test:browser");
    expect(workflow).toContain("run: pnpm deploy:docs:plan");
    expect(workflow).toContain("run: pnpm deploy:docs");
    expect(deploy).toBeGreaterThan(install);
    expect(smoke).toBeGreaterThan(deploy);
    expect(workflow.match(/^\s+CLOUDFLARE_API_TOKEN:/gmu)).toHaveLength(1);
    expect(workflow).toContain("DOCS_SOURCE_REVISION: ${{ inputs.revision }}");
    expect(workflow).toContain("https://docs.unicas.work/artifact-manifest.json");
    for (const path of [
      "/app-user-api/sdk/",
      "/app-user-api/quickstart/",
      "/app-user-api/compatibility/",
      "/app-user-api/sdk-reference/",
      "/app-user-api/versioning/",
      "/app-user-api/changelog/",
      "/app-user-api/troubleshooting/",
    ]) expect(workflow).toContain(`https://docs.unicas.work${path}`);

    for (const forbidden of [
      "pnpm deploy:production",
      "pnpm deploy:spaces",
      "pnpm deploy:site",
      "npm publish",
      "git tag",
      "git push",
    ]) expect(workflow).not.toContain(forbidden);
  });

  test("runs validation only for release pushes and manual preflight", () => {
    const triggers = workflowTriggers();
    expect(triggers).toMatch(/push:\r?\n\s+branches:\r?\n\s+- release/);
    expect(triggers).toContain("workflow_dispatch:");
    expect(triggers).not.toContain("pull_request:");
    expect(triggers).not.toContain('      - "**"');
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
    const serviceStepStart = job.indexOf("- name: Deploy API and console service");
    const spacesStepStart = job.indexOf("- name: Deploy Spaces App");
    const siteStepStart = job.indexOf("- name: Deploy product site");
    const service = job.indexOf("run: pnpm deploy:production");
    const spaces = job.indexOf("run: pnpm deploy:spaces");
    const site = job.indexOf("run: pnpm deploy:site");
    const docs = job.indexOf("run: pnpm deploy:docs");
    expect(serviceStepStart).toBeGreaterThan(-1);
    expect(spacesStepStart).toBeGreaterThan(serviceStepStart);
    expect(siteStepStart).toBeGreaterThan(spacesStepStart);
    expect(service).toBeGreaterThan(-1);
    expect(spaces).toBeGreaterThan(service);
    expect(site).toBeGreaterThan(spaces);
    expect(docs).toBeGreaterThan(site);
    const serviceStep = job.slice(serviceStepStart, spacesStepStart);
    const spacesStep = job.slice(spacesStepStart, siteStepStart);

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
      "CAS_R2_ACCESS_KEY_ID",
      "CAS_R2_SECRET_ACCESS_KEY",
      "OAUTH_GOOGLE_CLIENT_SECRET",
      "OAUTH_MICROSOFT_CLIENT_SECRET",
      "OAUTH_GITHUB_CLIENT_SECRET",
      "UNICAS_OTLP_AUTHORIZATION",
      "UNICAS_TRACE_HMAC_KEYS",
    ]) {
      expect(job).toContain(`${secret}: $` + `{{ secrets.${secret} }}`);
    }
    for (const binding of [
      "SPACES_D1_DATABASE_ID: ${{ vars.SPACES_D1_DATABASE_ID }}",
      "SPACES_GOOGLE_CLIENT_ID: ${{ vars.SPACES_GOOGLE_CLIENT_ID }}",
      "SPACES_SIGNING_KID: ${{ vars.SPACES_SIGNING_KID }}",
      "SPACES_SIGNING_PUBLIC_JWKS: ${{ vars.SPACES_SIGNING_PUBLIC_JWKS }}",
      "SPACES_SMOKE_PRINCIPAL_ID: ${{ vars.SPACES_SMOKE_PRINCIPAL_ID }}",
      "SPACES_UNICAS_AUDIENCE: ${{ vars.SPACES_UNICAS_AUDIENCE }}",
      "SPACES_GOOGLE_CLIENT_SECRET: ${{ secrets.SPACES_GOOGLE_CLIENT_SECRET }}",
      "SPACES_SIGNING_PRIVATE_KEY_PKCS8: ${{ secrets.SPACES_SIGNING_PRIVATE_KEY_PKCS8 }}",
      "SPACES_SMOKE_CREDENTIAL: ${{ secrets.SPACES_SMOKE_CREDENTIAL }}",
    ]) expect(job).toContain(binding);
    for (const binding of [
      "UNICAS_MANUAL_TRACE_SAMPLE_RATE: ${{ vars.UNICAS_MANUAL_TRACE_SAMPLE_RATE }}",
      "UNICAS_OTLP_TRACES_ENDPOINT: ${{ vars.UNICAS_OTLP_TRACES_ENDPOINT }}",
      "UNICAS_OTLP_AUTHORIZATION: ${{ secrets.UNICAS_OTLP_AUTHORIZATION }}",
      "UNICAS_TRACE_HMAC_KEYS: ${{ secrets.UNICAS_TRACE_HMAC_KEYS }}",
    ]) {
      expect(serviceStep).toContain(binding);
      expect(spacesStep).toContain(binding);
    }
    expect(job).not.toContain("secrets.SESSION_ENCRYPTION_KEYS");
    expect(job).not.toContain("secrets.OAUTH_STATE_ENCRYPTION_KEY");
    expect(job).toContain('wrangler secret put "$name"');
    expect(job).not.toContain("APP_SPACE_V1_CUTOVER_ENABLED");
    expect(job).not.toContain("UNICAS_RELEASE_ADMIN_SESSION");
    expect(job).not.toContain("cut-over-app-space-v1-issuers.mjs");
    expect(job).toContain("UNICAS_SMOKE_AUDIENCE: ${{ vars.UNICAS_SMOKE_AUDIENCE }}");
    expect(job).not.toContain("format('https://api.unicas.work/stacks/{0}'");
    expect(job).not.toContain("UNICAS_SMOKE_STACK_ID");
    expect(job).not.toContain("run: pnpm smoke:v1");
  });

  test("creates missing encryption secrets before a production deployment", () => {
    const plan = deploymentPlan({ production: true });
    expect(plan[0]).toEqual(["node", "stacks/unicas/deploy/ensure-encryption-secrets.mjs"]);
    expect(plan[1]).toEqual(["pnpm", "--filter", "@unicas/service-cloudflare", "build"]);
    expect(plan[2]).toEqual([
      "pnpm", "--filter", "@unicas/service-cloudflare", "exec", "wrangler",
      "d1", "migrations", "apply", "CAS_DB", "--remote",
    ]);

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
      "https://spaces.unicas.work/",
      "https://unicas.work/",
      "https://docs.unicas.work/",
    ]) expect(job.indexOf(target)).toBeGreaterThan(docs);
    expect(job).not.toContain("--location");
    expect(job.match(/--proto '=https'/g)).toHaveLength(5);
    expect(job).toContain("302 https://console.unicas.work/admin/");
    expect(job).toContain('"service":"unicas"');
    expect(job).toContain("UniCAS | Content-addressed storage infrastructure");
    expect(job).toContain("Overview | UniCAS Docs");
    expect(job).toContain("UniCAS Spaces");
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
      [
        "pnpm", "--filter", "@unicas/service-cloudflare", "exec", "wrangler",
        "d1", "migrations", "apply", "CAS_DB", "--remote", "--env", "staging",
      ],
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
    const deploy = deploymentPlan({ dryRun: true, environment })
      .find((command) => command.includes("wrangler") && command.includes("deploy"));
    expect(deploy).toEqual(expect.arrayContaining([
      "--var", "OAUTH_GOOGLE_CLIENT_ID:google-id",
      "--var", "OAUTH_MICROSOFT_CLIENT_ID:microsoft-id",
      "--var", "OAUTH_GITHUB_CLIENT_ID:github-id",
    ]));
  });

  test("threads nonzero tracing variables through service deployment without putting secrets in commands", () => {
    const plan = deploymentPlan({
      dryRun: true,
      environment: TRACE_DEPLOYMENT_ENVIRONMENT,
    });
    expect(plan[0]).toEqual([
      "node",
      "stacks/unicas/deploy/sync-manual-tracing-secrets.mjs",
    ]);
    const deploy = plan.find((command) => command.includes("wrangler") && command.includes("deploy"));
    expect(deploy).toEqual(expect.arrayContaining([
      "--var", "UNICAS_MANUAL_TRACE_SAMPLE_RATE:0.01",
      "--var", "UNICAS_OTLP_TRACES_ENDPOINT:https://collector.example/otlp/v1/traces",
    ]));
    const serializedPlan = JSON.stringify(plan);
    expect(serializedPlan).not.toContain("synthetic-authorization");
    expect(serializedPlan).not.toContain(TRACE_HMAC_KEYS);
  });

  test("keeps the service deployment plan dormant at an explicit zero rate", () => {
    const plan = deploymentPlan({
      dryRun: true,
      environment: {
        ...TRACE_DEPLOYMENT_ENVIRONMENT,
        UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0",
      },
    });
    const serializedPlan = JSON.stringify(plan);
    expect(serializedPlan).not.toContain("sync-manual-tracing-secrets");
    expect(serializedPlan).not.toContain("UNICAS_OTLP_TRACES_ENDPOINT");
    expect(serializedPlan).not.toContain("UNICAS_OTLP_AUTHORIZATION");
    expect(serializedPlan).not.toContain("UNICAS_TRACE_HMAC_KEYS");
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

  test("uses App/Space smoke with retirement rejection probes", () => {
    const wrapper = readFileSync(join(ROOT, "stacks/unicas/deploy/smoke.mjs"), "utf8");
    const appSpaceSmoke = readFileSync(join(ROOT, "scripts/cas-app-space-smoke.mjs"), "utf8");
    const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(wrapper).toContain("cas-app-space-smoke.mjs");
    expect(appSpaceSmoke).toContain("SpaceCapabilityVersion");
    expect(appSpaceSmoke).not.toContain("space-protocol/dist/v1.js");
    expect(appSpaceSmoke).toContain("createSpaceCasClient");
    expect(appSpaceSmoke).toContain("GC keeps current leased nodes");
    expect(appSpaceSmoke).not.toContain("gc.deleted === 0");
    expect(appSpaceSmoke).toContain("cross-Space read");
    expect(appSpaceSmoke).toContain("prototype App/Space v2 route");
    expect(appSpaceSmoke).toContain("prototype Space claim v");
    expect(appSpaceSmoke).toContain("broad prototype Space permission");
    expect(appSpaceSmoke).toContain("mixed-sign Root Ref replacement succeeds atomically");
    expect(appSpaceSmoke).toContain("retired Tenant claim on App/Space v1 route");
    expect(appSpaceSmoke).toContain("App/Space token on retired route");
    expect(packageJson.scripts["smoke:v1"]).toBeUndefined();
  });

  test("the smoke reset requires an explicit target and backup or waiver", () => {
    expect(parseResetArgs([])).toEqual({
      execute: false,
      verifyCurrent: false,
      expectedStackId: undefined,
      backupDir: undefined,
      confirmation: undefined,
    });
    expect(() => parseResetArgs(["--execute"]))
      .toThrow("--execute and --verify-current require --expected-stack-id");
    expect(() => parseResetArgs(["--execute", "--expected-stack-id", "cas_smoke"]))
      .toThrow("backup-free execution requires --confirm DELETE-ALL-TEST-DATA-NO-BACKUP");
    expect(parseResetArgs([
      "--execute",
      "--expected-stack-id", "cas_smoke",
      "--confirm", "DELETE-ALL-TEST-DATA-NO-BACKUP",
    ])).toEqual({
      execute: true,
      verifyCurrent: false,
      expectedStackId: "cas_smoke",
      backupDir: undefined,
      confirmation: "DELETE-ALL-TEST-DATA-NO-BACKUP",
    });
    expect(parseResetArgs([
      "--verify-current",
      "--expected-stack-id", "cas_smoke",
    ])).toEqual({
      execute: false,
      verifyCurrent: true,
      expectedStackId: "cas_smoke",
      backupDir: undefined,
      confirmation: undefined,
    });
    expect(() => parseResetArgs([
      "--execute", "--verify-current", "--expected-stack-id", "cas_smoke",
    ])).toThrow("cannot be combined");

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
      pendingUploads: 0,
      controlScopes: [
        { source: "cas_stacks", stack_id: stackId },
        { source: "cas_stack_members", stack_id: stackId },
      ],
      dataScopes: [
        { source: "cas_nodes", stack_id: stackId, tenant_id: "deploy-smoke" },
        { source: "cas_root_domain_revisions", stack_id: stackId, tenant_id: null },
      ],
      objectKeys: [`apps/${stackId}/spaces/deploy-smoke/nodes-v2/${"a".repeat(64)}`],
      oauthKeys: ["client:example_1"],
      workerSecrets: ["SESSION_ENCRYPTION_KEYS"],
      controlTables: ["cas_apps", "cas_platform_principals"],
      tenantTables: ["cas_nodes"],
      externalIssuers: [{
        stack_id: stackId,
        mode: "external",
        issuer: "https://unicas.work/deploy-smoke",
        audience: "https://api.unicas.work/v1/cas/",
        metadata_url: "https://unicas.work/.well-known/oauth-authorization-server/deploy-smoke",
        metadata_type: "oauth",
        authorization_endpoint: "https://unicas.work/deploy-smoke/authorize",
        token_endpoint: "https://unicas.work/deploy-smoke/token",
        jwks_uri: "https://unicas.work/deploy-smoke/jwks.json",
        registration_endpoint: null,
        scopes_supported: "[]",
        code_challenge_methods_supported: '["S256"]',
        status: "active",
        verified_at: 1,
        last_refresh_at: 1,
        last_refresh_error: null,
        jwks_digest: "digest",
        capability_max_lifetime_seconds: 3600,
        revision: 1,
      }],
      bootstrapIdentities: [{
        identity_issuer: "https://accounts.google.com",
        subject: "google's-subject",
        display_name: "Scott",
        app_id: stackId,
        joined_at: 1,
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
    expect(() => validateResetInventory({
      ...inventory,
      pendingUploads: 1,
    }, stackId)).toThrow("pending direct uploads");
    expect(() => validateResetInventory({
      ...inventory,
      workerSecrets: [...inventory.workerSecrets, "CAS_R2_SECRET_ACCESS_KEY"],
    }, stackId)).toThrow("signing credentials must be revoked");
    expect(() => validateResetInventory({
      ...inventory,
      controlTables: [...inventory.controlTables, "customer_records"],
    }, stackId)).toThrow("unknown tables: customer_records");
    expect(() => validateResetInventory(inventory, "cas_bad/id"))
      .toThrow("not a canonical UniCAS stack id");

    expect(inventoryDigest({ ...inventory, controlScopes: [...inventory.controlScopes].reverse() }))
      .toBe(inventoryDigest(inventory));
  });

  test("the smoke reset bounds compound inventory queries for remote D1", () => {
    const queries = [...SCOPED_INVENTORY_QUERIES.control, ...SCOPED_INVENTORY_QUERIES.data];
    expect(queries).toHaveLength(5);
    expect(queries.map(query => query.match(/\bSELECT\b/g)?.length)).toEqual([4, 3, 4, 4, 1]);
    const catalog = queries.join("\n");
    for (const table of [
      "cas_apps",
      "cas_control_audit_events",
      "cas_nodes",
      "cas_direct_upload_sessions",
      "cas_space_usage",
    ]) expect(catalog).toContain(table);
  });

  test("the smoke reset plan targets only isolated resources", () => {
    const commands = resetPlan({
      objectKeys: [`apps/cas_smoke/spaces/deploy-smoke/nodes-v2/${"a".repeat(64)}`],
      oauthKeys: ["client:example"],
    });
    const rendered = commands.map((command) => command.join(" ")).join("\n");
    expect(rendered).toContain("unicas-content/apps/cas_smoke/spaces/deploy-smoke");
    expect(rendered).toContain("d1 execute unicas-control --remote");
    expect(rendered).toContain("d1 execute unicas-tenant --remote");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_apps");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_accounts");
    expect(rendered).toContain("DROP TABLE IF EXISTS cas_nodes");
    for (const retired of [
      "cas_platform_principals",
      "cas_operator_identities",
      "cas_control_idempotency",
    ]) expect(rendered).toContain(`DROP TABLE IF EXISTS ${retired}`);
    expect(rendered).toContain("--binding OAUTH_KV --remote");
    expect(rendered).not.toContain("unicas.shazhou.work");
    expect(rendered).not.toContain("unidocs-cas");
  });

  test("bootstraps the current Account model and preserves the smoke App issuer", () => {
    const inventory = {
      stacks: [{
        stack_id: "cas_smoke",
        display_name: "Production Smoke",
        description: "Canonical deployment smoke",
        status: "active",
        created_at: 1,
        revision: 2,
      }],
      bootstrapIdentities: [{
        identity_issuer: "https://accounts.google.com",
        subject: "google's-subject",
        display_name: "Scott",
        app_id: "cas_smoke",
        joined_at: 2,
      }],
      externalIssuers: [{
        stack_id: "cas_smoke",
        mode: "external",
        issuer: "https://unicas.work/deploy-smoke",
        audience: "https://api.unicas.work/v1/cas/",
        metadata_url: "https://unicas.work/.well-known/oauth-authorization-server/deploy-smoke",
        metadata_type: "oauth",
        authorization_endpoint: "https://unicas.work/deploy-smoke/authorize",
        token_endpoint: "https://unicas.work/deploy-smoke/token",
        jwks_uri: "https://unicas.work/deploy-smoke/jwks.json",
        registration_endpoint: null,
        scopes_supported: "[]",
        code_challenge_methods_supported: '["S256"]',
        status: "active",
        verified_at: 3,
        last_refresh_at: 4,
        last_refresh_error: null,
        jwks_digest: "digest",
        capability_max_lifetime_seconds: 3600,
        revision: 1,
      }],
    };
    let fill = 1;
    const bootstrap = bootstrapStatements(inventory, {
      now: 5,
      random: (length) => Buffer.alloc(length, fill++),
    });
    expect([...bootstrap.captureStatements, ...bootstrap.statements].join("\n"))
      .not.toContain("google's-subject");
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("CREATE TABLE cas_operator_identities (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, display_name TEXT, email_for_display TEXT, created_at INTEGER NOT NULL)");
      database.exec("CREATE TABLE cas_platform_principals (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, platform_admin INTEGER NOT NULL, apps_create INTEGER NOT NULL)");
      database.exec("CREATE TABLE cas_app_members (app_id TEXT NOT NULL, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, joined_at INTEGER NOT NULL)");
      database.exec("INSERT INTO cas_operator_identities VALUES ('https://accounts.google.com', 'google''s-subject', 'Scott', 'shazhou.ww@gmail.com', 1)");
      database.exec("INSERT INTO cas_platform_principals VALUES ('https://accounts.google.com', 'google''s-subject', 'active', 1, 1)");
      database.exec("INSERT INTO cas_app_members VALUES ('cas_smoke', 'https://accounts.google.com', 'google''s-subject', 2)");
      for (const statement of bootstrap.captureStatements) database.exec(statement);
      database.exec("DROP TABLE cas_operator_identities");
      database.exec("DROP TABLE cas_platform_principals");
      database.exec("DROP TABLE cas_app_members");
      for (const migration of CONTROL_SCHEMA_MIGRATIONS) database.exec(migration);
      for (const statement of bootstrap.statements) database.exec(statement);
      expect(bootstrap.accountId).toMatch(/^acct_[A-Za-z0-9_-]{22}$/);
      expect(bootstrap.externalIdentityId).toMatch(/^ext_[A-Za-z0-9_-]{22}$/);
      expect(database.prepare("SELECT subject FROM cas_external_identities").get()).toEqual({
        subject: "google's-subject",
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM cas_account_platform_authorities").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT account_id FROM cas_app_members WHERE app_id='cas_smoke'").get()).toEqual({
        account_id: bootstrap.accountId,
      });
      expect(database.prepare("SELECT issuer, audience, status FROM cas_app_oauth_issuers").get()).toEqual({
        issuer: "https://unicas.work/deploy-smoke",
        audience: "https://api.unicas.work/v1/cas/",
        status: "active",
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM cas_platform_audit_events").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM cas_control_audit_events").get()).toEqual({ count: 1 });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='cas_cutover_identity'",
      ).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
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

      const uploadKey = "_uploads/v1/upload-1";
      const uploadName = `${createHash("sha256").update(uploadKey).digest("hex")}.bin`;
      writeFileSync(join(backupDir, "r2", uploadName), "temporary upload");
      expect(validateR2BackupFiles([uploadKey], backupDir)).toEqual([{
        objectKey: uploadKey,
        file: `r2/${uploadName}`,
        bytes: Buffer.byteLength("temporary upload"),
        sha256: createHash("sha256").update("temporary upload").digest("hex"),
      }]);
    } finally {
      rmSync(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test("assigns product and service origins to separate Workers", () => {
    const serviceConfig = readFileSync(join(ROOT, "packages/service-cloudflare/wrangler.toml"), "utf8");
    const normalizedServiceConfig = serviceConfig.replaceAll("\r\n", "\n");
    const siteConfig = JSON.parse(readFileSync(join(ROOT, "stacks/unicas/site/wrangler.jsonc"), "utf8"));
    const siteHtml = readFileSync(join(ROOT, "stacks/unicas/site/public/index.html"), "utf8");
    const docsConfig = JSON.parse(readFileSync(join(ROOT, "packages/docs-site/wrangler.jsonc"), "utf8"));
    expect(serviceConfig).toContain('pattern = "api.unicas.work"');
    expect(serviceConfig).toContain('pattern = "console.unicas.work"');
    expect(normalizedServiceConfig).toContain([
      "[observability]",
      "enabled = true",
      "",
      "[observability.logs]",
      "enabled = true",
      "head_sampling_rate = 0.05",
      "invocation_logs = false",
      "persist = true",
      "destinations = []",
      "",
      "[observability.traces]",
      "enabled = false",
      "head_sampling_rate = 0",
      "persist = false",
      "destinations = []",
    ].join("\n"));
    expect(serviceConfig).toContain('UNICAS_MANUAL_TRACE_SAMPLE_RATE = "0"');
    expect(serviceConfig).not.toContain('pattern = "unicas.work"');
    expect(serviceConfig).not.toContain("docs.unicas.work");
    expect(siteConfig.routes).toEqual([{ pattern: "unicas.work", custom_domain: true }]);
    expect(siteConfig.assets.directory).toBe("./public");
    expect(siteConfig).not.toHaveProperty("observability");
    expect(JSON.stringify(siteConfig)).not.toContain("docs.unicas.work");
    expect(siteHtml).toContain('href="https://docs.unicas.work"');
    expect(docsConfig.routes).toEqual([{ pattern: "docs.unicas.work", custom_domain: true }]);
    expect(docsConfig.assets.directory).toBe("./dist");
    expect(docsConfig).not.toHaveProperty("main");
    expect(docsConfig).not.toHaveProperty("observability");
    expect(JSON.stringify(docsConfig)).not.toMatch(/d1_databases|durable_objects|kv_namespaces|r2_buckets|services|vars|secrets|oauth/i);
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
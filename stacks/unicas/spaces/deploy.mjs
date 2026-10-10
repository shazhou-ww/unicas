import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SpacesProductionConfigPath,
  SpacesProductionSecretsPath,
  writeProductionSpacesConfig,
  writeProductionSpacesSecrets,
} from "./deployment-config.mjs";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SPACES_PACKAGE_DIRECTORY = fileURLToPath(new URL("../../../packages/spaces/", import.meta.url));
const TEMPLATE_CONFIG = "wrangler.jsonc";

export function parseSpacesDeployArgs(argv) {
  if (argv.length !== 1 || !["--dry-run", "--production", "--bootstrap"].includes(argv[0])) {
    throw new Error("use --dry-run, --production, or --bootstrap; implicit production deployment is refused");
  }
  return {
    bootstrap: argv[0] === "--bootstrap",
    dryRun: argv[0] === "--dry-run",
    production: argv[0] === "--production",
  };
}

export function spacesDeploymentPlan(options, environment = process.env) {
  if ([options.bootstrap, options.dryRun, options.production].filter(Boolean).length !== 1) {
    throw new Error("choose exactly one Spaces deployment mode");
  }
  const commands = [["pnpm", "--filter", "@unicas/spaces", "build"]];
  if (options.dryRun) {
    commands.push([
      "pnpm", "--filter", "@unicas/spaces", "exec", "wrangler", "deploy",
      "--dry-run", "--config", TEMPLATE_CONFIG,
    ]);
    return commands;
  }
  if (options.bootstrap && environment.SPACES_BOOTSTRAP_DEPLOY_CONFIRM !== "spaces.unicas.work") {
    throw new Error("bootstrap deployment requires SPACES_BOOTSTRAP_DEPLOY_CONFIRM=spaces.unicas.work");
  }
  const generatedConfig = relativeFromSpacesPackage(SpacesProductionConfigPath);
  const secretsFile = relativeFromSpacesPackage(SpacesProductionSecretsPath);
  commands.push(
    ["pnpm", "--filter", "@unicas/spaces", "exec", "wrangler", "d1", "migrations", "apply", "SPACES_DB", "--remote", "--config", generatedConfig],
  );
  if (options.production) {
    commands.push(["node", "packages/spaces/scripts/preflight.mjs"]);
  }
  commands.push(
    ["pnpm", "--filter", "@unicas/spaces", "exec", "wrangler", "deploy", "--config", generatedConfig, "--secrets-file", secretsFile],
  );
  if (options.production) {
    commands.push(["pnpm", "spaces:smoke", "--base-url", "https://spaces.unicas.work"]);
  }
  return commands;
}

export function spacesBootstrapEnvironment(environment = process.env) {
  return {
    ...environment,
    SPACES_GOOGLE_CLIENT_ID: environment.SPACES_GOOGLE_CLIENT_ID || "bootstrap-disabled",
    SPACES_GOOGLE_CLIENT_SECRET: environment.SPACES_GOOGLE_CLIENT_SECRET || "bootstrap-disabled",
    SPACES_SMOKE_ENABLED: "false",
    UNICAS_MANUAL_TRACE_SAMPLE_RATE: "0",
  };
}

export function runSpacesCommand(command, spawn = spawnSync) {
  console.log(`> ${command.join(" ")}`);
  const result = spawn(command[0], command.slice(1), {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw Object.assign(new Error(`Spaces deployment command failed: ${command[0]}`), {
      exitCode: result.status ?? 1,
    });
  }
}

function relativeFromSpacesPackage(path) {
  return relative(SPACES_PACKAGE_DIRECTORY, path).replace(/\\/g, "/");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSpacesDeployArgs(process.argv.slice(2));
    const materializesSecrets = options.production || options.bootstrap;
    try {
      if (materializesSecrets) {
        const environment = options.bootstrap ? spacesBootstrapEnvironment() : process.env;
        writeProductionSpacesConfig(environment);
        writeProductionSpacesSecrets(environment);
      }
      for (const command of spacesDeploymentPlan(options)) runSpacesCommand(command);
    } finally {
      if (materializesSecrets) rmSync(SpacesProductionSecretsPath, { force: true });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
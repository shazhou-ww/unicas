import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVICE_PACKAGE = "@unicas/service-cloudflare";
const SMOKE_ENVIRONMENT_KEYS = [
  "UNICAS_SMOKE_APP_ID",
  "UNICAS_SMOKE_ISSUER",
  "UNICAS_SMOKE_AUDIENCE",
  "UNICAS_SMOKE_KID",
  "UNICAS_SMOKE_KEY_FILE",
];
const OAUTH_VARIABLE_KEYS = [
  "OAUTH_GOOGLE_CLIENT_ID",
  "OAUTH_MICROSOFT_CLIENT_ID",
  "OAUTH_GITHUB_CLIENT_ID",
];

export function parseArgs(argv) {
  const options = { dryRun: false, production: false, skipSmoke: false, env: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--production") options.production = true;
    else if (arg === "--skip-smoke") options.skipSmoke = true;
    else if (arg === "--env") {
      options.env = argv[++index];
      if (options.env === undefined) throw new Error("--env requires a lowercase environment name");
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.env !== undefined && !/^[a-z][a-z0-9-]*$/.test(options.env ?? "")) {
    throw new Error("--env requires a lowercase environment name");
  }
  return options;
}

export function deploymentPlan({ dryRun = false, env, production = false, skipSmoke, environment = process.env } = {}) {
  if (env && production) {
    throw new Error("--production and --env cannot be used together");
  }
  if (production && skipSmoke) {
    throw new Error("production deployment cannot skip smoke validation");
  }
  if (!dryRun && !env && !production) {
    throw new Error("refusing implicit production deployment; run pnpm deploy:production");
  }
  if (env && !skipSmoke) {
    throw new Error("--env requires --skip-smoke; run smoke separately with an explicit base URL");
  }
  const envArgs = env ? ["--env", env] : [];
  const workerVars = OAUTH_VARIABLE_KEYS.flatMap(key => environment[key]
    ? ["--var", `${key}:${environment[key]}`]
    : []);
  const commands = [
    ["pnpm", "--filter", SERVICE_PACKAGE, "build"],
    ["pnpm", "--filter", SERVICE_PACKAGE, "exec", "wrangler", "deploy", ...envArgs, ...workerVars],
  ];
  if (!skipSmoke) {
    commands.push(["pnpm", "--filter", "@unicas/codec", "build"]);
    commands.push(["pnpm", "--filter", "@unicas/tenant-protocol", "build"]);
    commands.push(["pnpm", "--filter", "@unicas/tenant-client", "build"]);
    commands.push(["node", "stacks/unicas/deploy/smoke.mjs"]);
  }
  return commands;
}

export function validateDeploymentEnvironment(options, environment = process.env) {
  if (options.dryRun || options.skipSmoke) return;
  const missing = [...SMOKE_ENVIRONMENT_KEYS, ...OAUTH_VARIABLE_KEYS].filter((key) => !environment[key]);
  if (missing.length > 0) {
    throw new Error(`production deployment configuration is missing: ${missing.join(", ")}`);
  }
}

function run(command) {
  console.log(`> ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = deploymentPlan(options);
    validateDeploymentEnvironment(options);
    if (options.dryRun) {
      plan.forEach((command) => console.log(command.join(" ")));
    } else {
      plan.forEach(run);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function parseDocsDeployArgs(argv) {
  if (argv.length !== 1 || !["--dry-run", "--production"].includes(argv[0])) {
    throw new Error("use --dry-run or --production; implicit production deployment is refused");
  }
  return { dryRun: argv[0] === "--dry-run", production: argv[0] === "--production" };
}

export function docsDeploymentPlan(options) {
  if ([options.dryRun, options.production].filter(Boolean).length !== 1) {
    throw new Error("choose exactly one documentation deployment mode");
  }
  return [
    ["pnpm", "--filter", "@unicas/docs-site", "build"],
    [
      "pnpm", "--filter", "@unicas/docs-site", "exec", "wrangler", "deploy",
      ...(options.dryRun ? ["--dry-run"] : []),
      "--config", "wrangler.jsonc",
    ],
  ];
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
    docsDeploymentPlan(parseDocsDeployArgs(process.argv.slice(2))).forEach(run);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

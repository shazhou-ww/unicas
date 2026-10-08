import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ManualTracingSecretNames,
  resolveManualTracingDeployment,
} from "./manual-tracing.mjs";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVICE_PACKAGE = "@unicas/service-cloudflare";

export function parseManualTracingSecretArgs(argv) {
  if (argv.length === 0) return { env: undefined };
  if (
    argv.length === 2
    && argv[0] === "--env"
    && /^[a-z][a-z0-9-]*$/.test(argv[1] ?? "")
  ) {
    return { env: argv[1] };
  }
  throw new Error("use no arguments or --env <lowercase-environment>");
}

function runWrangler(args, input) {
  const result = spawnSync(
    "pnpm",
    ["--filter", SERVICE_PACKAGE, "exec", "wrangler", ...args],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      input,
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

export function syncManualTracingSecrets({
  environment = process.env,
  env,
  execute = runWrangler,
} = {}) {
  const tracing = resolveManualTracingDeployment(environment);
  if (!tracing.enabled) return [];

  const envArgs = env ? ["--env", env] : [];
  for (const name of ManualTracingSecretNames) {
    execute(["secret", "put", name, ...envArgs], tracing.secrets[name]);
  }
  return [...ManualTracingSecretNames];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseManualTracingSecretArgs(process.argv.slice(2));
    const synchronized = syncManualTracingSecrets(options);
    console.log(synchronized.length === 0
      ? "Manual tracing is disabled; no tracing secrets were synchronized."
      : `Synchronized manual tracing secrets: ${synchronized.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

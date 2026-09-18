import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVICE_PACKAGE = "@unicas/service-cloudflare";
export const ENCRYPTION_SECRET_NAMES = [
  "SESSION_ENCRYPTION_KEYS",
  "OAUTH_STATE_ENCRYPTION_KEY",
];

export function parseSecretNames(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("wrangler secret list returned an unexpected response");
  return new Set(parsed.map((entry) => entry?.name).filter((name) => typeof name === "string"));
}

export function generateEncryptionSecret(name, now = new Date(), random = randomBytes) {
  const key = random(32).toString("base64url");
  if (name === "SESSION_ENCRYPTION_KEYS") {
    const kid = now.toISOString().slice(0, 7);
    return JSON.stringify({ [kid]: key });
  }
  if (name === "OAUTH_STATE_ENCRYPTION_KEY") return key;
  throw new Error(`unsupported encryption secret: ${name}`);
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
      stdio: input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed with exit code ${result.status}`);
  return result.stdout ?? "";
}

export function ensureEncryptionSecrets({ execute = runWrangler, now = new Date(), random = randomBytes } = {}) {
  const existing = parseSecretNames(execute(["secret", "list", "--format", "json"]));
  const created = [];
  for (const name of ENCRYPTION_SECRET_NAMES) {
    if (existing.has(name)) continue;
    execute(["secret", "put", name], generateEncryptionSecret(name, now, random));
    created.push(name);
  }
  return created;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const created = ensureEncryptionSecrets();
    console.log(created.length === 0
      ? "Production encryption secrets already exist."
      : `Created missing production encryption secrets: ${created.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function findWorkspaceRoot(start = dirname(fileURLToPath(import.meta.url))) {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))
      && existsSync(join(directory, "stacks/unicas/local/runtime.mjs"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate the UniCAS workspace above the acceptance runner");
    directory = parent;
  }
}

async function main() {
  const port = Number(process.env.UNICAS_ACCEPTANCE_PORT ?? 8892);
  if (!Number.isInteger(port) || port < 1024 || port > 65533) {
    throw new Error("UNICAS_ACCEPTANCE_PORT must be an integer between 1024 and 65533");
  }
  const { startLocalUnicasRuntime } = await import(pathToFileURL(
    join(findWorkspaceRoot(), "stacks/unicas/local/runtime.mjs"),
  ).href);
  const origin = `http://127.0.0.1:${port}`;
  delete process.env.GOOGLE_OIDC_CLIENT_ID;
  delete process.env.GOOGLE_OIDC_CLIENT_SECRET;
  process.env.UNICAS_ADMIN_ORIGIN = origin;
  process.env.UNICAS_LOCAL_PUBLIC_HOST = "127.0.0.1";
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.MANAGED_ISSUER_PRIVATE_KEY_PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" });
  process.env.MANAGED_ISSUER_KEY_ID = "local-acceptance";
  const persistPath = await mkdtemp(join(tmpdir(), "unicas-acceptance-"));
  const runtime = await startLocalUnicasRuntime({
    ports: { admin: port, mockOidc: port + 1, edge: port + 2 },
    persistPath,
  });
  console.log(`Isolated acceptance ready at ${origin}/admin/`);
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await runtime.dispose();
    await rm(persistPath, { recursive: true, force: true });
    process.exit(0);
  }
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
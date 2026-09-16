import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalUnicasRuntime } from "../../../../stacks/unicas/local/runtime.mjs";

const port = Number(process.env.UNICAS_ACCEPTANCE_PORT ?? 8892);
if (!Number.isInteger(port) || port < 1024 || port > 65533) {
  throw new Error("UNICAS_ACCEPTANCE_PORT must be an integer between 1024 and 65533");
}
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
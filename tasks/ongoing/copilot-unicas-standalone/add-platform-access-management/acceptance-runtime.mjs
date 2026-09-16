import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalUnicasRuntime } from "../../../../stacks/unicas/local/runtime.mjs";

delete process.env.GOOGLE_OIDC_CLIENT_ID;
delete process.env.GOOGLE_OIDC_CLIENT_SECRET;
process.env.UNICAS_ADMIN_ORIGIN = "http://127.0.0.1:8892";
process.env.UNICAS_LOCAL_PUBLIC_HOST = "127.0.0.1";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
process.env.MANAGED_ISSUER_PRIVATE_KEY_PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.MANAGED_ISSUER_KEY_ID = "local-acceptance";
const persistPath = await mkdtemp(join(tmpdir(), "unicas-acceptance-"));
const runtime = await startLocalUnicasRuntime({
  ports: { admin: 8892, mockOidc: 8893, edge: 8894 },
  persistPath,
});
console.log("Isolated acceptance ready at http://127.0.0.1:8892/admin/");
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
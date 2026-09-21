import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importPKCS8, SignJWT } from "jose";
import { createSpaceCasClient } from "@unicas/space-client";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  spaceRootRefsReadPermission,
} from "@unicas/space-protocol";
import { executeD1 } from "./bootstrap.mjs";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG = resolve(ROOT, ".wrangler/spaces/wrangler.production.json");

export function smokePreflightQuery(principalId) {
  const value = `'${principalId.replaceAll("'", "''")}'`;
  return `SELECT
    (SELECT status FROM spaces_principals WHERE principal_id = ${value}) AS principal_status,
    (SELECT app_id FROM spaces_principal_spaces WHERE principal_id = ${value}) AS app_id,
    (SELECT space_id FROM spaces_principal_spaces WHERE principal_id = ${value}) AS space_id,
    (SELECT ref_domain FROM spaces_principal_spaces WHERE principal_id = ${value}) AS ref_domain,
    (SELECT COUNT(*) FROM spaces_external_identities WHERE principal_id = ${value}) AS identity_count,
    (SELECT COUNT(*) FROM spaces_file_system_roots WHERE principal_id = ${value}) AS root_count,
    (SELECT COUNT(*) FROM spaces_smoke_runs
      WHERE principal_id = ${value} AND cleanup_state = 'active'
        AND expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000) AS blocking_run_count,
    (SELECT COUNT(*) FROM spaces_smoke_runs
      WHERE principal_id = ${value} AND cleanup_state <> 'complete'
        AND (cleanup_state IN ('pending', 'failed')
          OR expires_at <= CAST(strftime('%s', 'now') AS INTEGER) * 1000)) AS recoverable_run_count;`;
}

export function validateSmokePreflightRow(row) {
  if (row?.principal_status !== "active") throw new Error("smoke_principal_not_active");
  if (typeof row.app_id !== "string" || typeof row.space_id !== "string" || typeof row.ref_domain !== "string") {
    throw new Error("smoke_space_mapping_missing");
  }
  if (row.identity_count !== 0) throw new Error("smoke_principal_has_external_identity");
  if (row.blocking_run_count !== 0) throw new Error("active_smoke_run_present");
  if (row.recoverable_run_count > 1) throw new Error("multiple_recoverable_smoke_runs");
  if (row.root_count > 1 || (row.root_count === 1 && row.recoverable_run_count !== 1)) {
    throw new Error("stale_smoke_root_present");
  }
  return {
    principalId: row.principal_id,
    appId: row.app_id,
    spaceId: row.space_id,
    refDomain: row.ref_domain,
  };
}

export async function runSpacesPreflight(environment = process.env, execute = executeQuery) {
  const principalId = required(environment.SPACES_SMOKE_PRINCIPAL_ID, "SPACES_SMOKE_PRINCIPAL_ID");
  const rows = await execute(smokePreflightQuery(principalId));
  const mapping = validateSmokePreflightRow({ ...rows[0], principal_id: principalId });
  const issuedAt = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(
    required(environment.SPACES_SIGNING_PRIVATE_KEY_PKCS8, "SPACES_SIGNING_PRIVATE_KEY_PKCS8"),
    CapabilityAlgorithm,
  );
  const token = await new SignJWT({
    ver: SpaceCapabilityVersion,
    spaceId: mapping.spaceId,
    permissions: [spaceRootRefsReadPermission()],
    refDomain: mapping.refDomain,
  })
    .setProtectedHeader({
      alg: CapabilityAlgorithm,
      kid: required(environment.SPACES_SIGNING_KID, "SPACES_SIGNING_KID"),
      typ: CapabilityTokenType,
    })
    .setIssuer(environment.SPACES_ISSUER ?? "https://spaces.unicas.work")
    .setSubject(mapping.principalId)
    .setAudience(required(environment.SPACES_UNICAS_AUDIENCE, "SPACES_UNICAS_AUDIENCE"))
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .setJti(crypto.randomUUID())
    .sign(privateKey);
  const client = createSpaceCasClient({
    baseUrl: environment.SPACES_UNICAS_BASE_URL ?? "https://api.unicas.work",
    appId: mapping.appId,
    spaceId: mapping.spaceId,
    getToken: async () => token,
  });
  await client.listRootRefs({ limit: 1 });
  return { status: "ready" };
}

async function executeQuery(query) {
  return executeD1({ wranglerConfig: CONFIG }, query);
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runSpacesPreflight();
    console.log("Spaces production preflight passed.");
  } catch (error) {
    console.error(`Spaces production preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
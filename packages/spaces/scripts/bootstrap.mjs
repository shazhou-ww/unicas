import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importPKCS8, SignJWT } from "jose";
import { createSpaceCasClient } from "@unicas/tenant-client";
import { createTenantFileSystem } from "@unicas/tenant-file-client";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  spaceNodeLeasePermission,
  spaceNodeReadPermission,
  spaceRootRefsReadPermission,
  spaceRootRefsUpdatePermission,
  validateRefDomainClaim,
} from "@unicas/tenant-protocol";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const requireFromServicePackage = createRequire(new URL("../../service-cloudflare/package.json", import.meta.url));
const WRANGLER_CLI = requireFromServicePackage.resolve("wrangler");
const DEFAULT_WRANGLER_CONFIG = resolve(ROOT, ".wrangler/spaces/wrangler.production.json");
const TEMP_SQL = resolve(ROOT, ".wrangler/spaces/bootstrap.sql");

export function parseBootstrapArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--mode" || (argv[1] !== "google" && argv[1] !== "smoke")) {
    throw new Error("usage: pnpm spaces:bootstrap -- --mode <google|smoke>");
  }
  return { mode: argv[1] };
}

export function readBootstrapConfig(mode, environment = process.env) {
  const requiredNames = [
    "SPACES_BOOTSTRAP_APP_ID",
    "SPACES_BOOTSTRAP_SPACE_ID",
    "SPACES_BOOTSTRAP_PRINCIPAL_ID",
    "SPACES_BOOTSTRAP_DISPLAY_NAME",
    "SPACES_SIGNING_KID",
    "SPACES_UNICAS_AUDIENCE",
  ];
  if (mode === "google") requiredNames.push("SPACES_BOOTSTRAP_GOOGLE_SUBJECT", "SPACES_BOOTSTRAP_KEY_FILE");
  const missing = requiredNames.filter((name) => !environment[name]);
  if (missing.length > 0) throw new Error(`Spaces bootstrap configuration is missing: ${missing.join(", ")}`);
  const refDomain = environment.SPACES_BOOTSTRAP_REF_DOMAIN ?? (mode === "smoke" ? "spaces:smoke" : "spaces:files");
  const refDomainError = validateRefDomainClaim(refDomain);
  if (refDomainError) throw new Error(`SPACES_BOOTSTRAP_REF_DOMAIN: ${refDomainError}`);
  return {
    mode,
    appId: boundedText(environment.SPACES_BOOTSTRAP_APP_ID, "SPACES_BOOTSTRAP_APP_ID"),
    spaceId: boundedText(environment.SPACES_BOOTSTRAP_SPACE_ID, "SPACES_BOOTSTRAP_SPACE_ID"),
    principalId: boundedText(environment.SPACES_BOOTSTRAP_PRINCIPAL_ID, "SPACES_BOOTSTRAP_PRINCIPAL_ID"),
    displayName: boundedText(environment.SPACES_BOOTSTRAP_DISPLAY_NAME, "SPACES_BOOTSTRAP_DISPLAY_NAME"),
    googleSubject: mode === "google"
      ? boundedText(environment.SPACES_BOOTSTRAP_GOOGLE_SUBJECT, "SPACES_BOOTSTRAP_GOOGLE_SUBJECT")
      : null,
    refDomain,
    issuer: environment.SPACES_ISSUER ?? "https://spaces.unicas.work",
    audience: environment.SPACES_UNICAS_AUDIENCE,
    keyId: environment.SPACES_SIGNING_KID,
    privateKeyFile: mode === "google" ? resolve(environment.SPACES_BOOTSTRAP_KEY_FILE) : null,
    unicasBaseUrl: environment.SPACES_UNICAS_BASE_URL ?? "https://api.unicas.work",
    wranglerConfig: resolve(environment.SPACES_WRANGLER_CONFIG ?? DEFAULT_WRANGLER_CONFIG),
  };
}

export function bootstrapStateQuery(config) {
  const identityOwner = config.googleSubject === null
    ? "NULL"
    : `(SELECT principal_id FROM spaces_external_identities WHERE provider = 'google' AND provider_subject = ${sql(config.googleSubject)})`;
  return `SELECT
    (SELECT status FROM spaces_principals WHERE principal_id = ${sql(config.principalId)}) AS principal_status,
    (SELECT display_name FROM spaces_principals WHERE principal_id = ${sql(config.principalId)}) AS display_name,
    (SELECT app_id FROM spaces_principal_spaces WHERE principal_id = ${sql(config.principalId)}) AS app_id,
    (SELECT space_id FROM spaces_principal_spaces WHERE principal_id = ${sql(config.principalId)}) AS space_id,
    (SELECT ref_domain FROM spaces_principal_spaces WHERE principal_id = ${sql(config.principalId)}) AS ref_domain,
    (SELECT root_id FROM spaces_file_system_roots WHERE principal_id = ${sql(config.principalId)}) AS root_id,
    (SELECT COUNT(*) FROM spaces_external_identities WHERE principal_id = ${sql(config.principalId)}) AS identity_count,
    ${identityOwner} AS identity_owner,
    (SELECT principal_id FROM spaces_principal_spaces WHERE app_id = ${sql(config.appId)} AND space_id = ${sql(config.spaceId)}) AS space_owner;`;
}

export function bootstrapInsertSql(config, root, now) {
  const statements = [
    `INSERT INTO spaces_principals (principal_id, status, display_name, created_at, updated_at) VALUES (${sql(config.principalId)}, 'active', ${sql(config.displayName)}, ${now}, ${now});`,
    `INSERT INTO spaces_principal_spaces (principal_id, app_id, space_id, ref_domain, created_at, updated_at) VALUES (${sql(config.principalId)}, ${sql(config.appId)}, ${sql(config.spaceId)}, ${sql(config.refDomain)}, ${now}, ${now});`,
  ];
  if (config.googleSubject !== null) {
    statements.push(`INSERT INTO spaces_external_identities (provider, provider_subject, principal_id, display_email, created_at, updated_at) VALUES ('google', ${sql(config.googleSubject)}, ${sql(config.principalId)}, NULL, ${now}, ${now});`);
  }
  if (root !== null) {
    statements.push(`INSERT INTO spaces_file_system_roots (root_id, principal_id, name, manifest_hash, revision, created_at, updated_at) VALUES (${sql(root.rootId)}, ${sql(config.principalId)}, ${sql(root.name)}, ${sql(root.manifestHash)}, ${root.revision}, ${root.createdAt}, ${root.updatedAt});`);
  }
  return statements.join("\n");
}

export function parseD1Rows(output) {
  const lines = output.trim().split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trimStart().startsWith("[")) continue;
    try {
      const parsed = JSON.parse(lines.slice(index).join("\n"));
      if (Array.isArray(parsed)) {
        return parsed.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
      }
    } catch {
      continue;
    }
  }
  throw new Error("Unexpected D1 response");
}

export function classifyBootstrapState(config, row) {
  const empty = row.principal_status == null
    && row.display_name == null
    && row.app_id == null
    && row.space_id == null
    && row.ref_domain == null
    && row.root_id == null
    && row.identity_owner == null
    && row.space_owner == null
    && (row.identity_count == null || row.identity_count === 0);
  if (empty) return "create";
  const identityMatches = config.googleSubject === null
    ? row.identity_owner === null && row.identity_count === 0
    : row.identity_owner === config.principalId && row.identity_count === 1;
  const rootMatches = config.mode === "smoke" ? row.root_id === null : typeof row.root_id === "string";
  if (row.principal_status === "active"
    && row.display_name === config.displayName
    && row.app_id === config.appId
    && row.space_id === config.spaceId
    && row.ref_domain === config.refDomain
    && rootMatches
    && identityMatches
    && row.space_owner === config.principalId) {
    return "existing";
  }
  throw new Error("Spaces bootstrap found conflicting or partial state; inspect it before retrying");
}

export async function bootstrapSpacesPrincipal(config, execute = executeD1) {
  const rows = await execute(config, bootstrapStateQuery(config));
  const state = classifyBootstrapState(config, rows[0] ?? {});
  if (state === "existing") return { status: "existing" };

  if (config.mode === "smoke") {
    await execute(config, bootstrapInsertSql(config, null, Date.now()));
    return { status: "created" };
  }

  const privateKey = await importPKCS8(readPrivateKey(config.privateKeyFile), CapabilityAlgorithm);
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    ver: SpaceCapabilityVersion,
    spaceId: config.spaceId,
    permissions: [
      spaceNodeReadPermission(),
      spaceNodeLeasePermission(),
      spaceRootRefsReadPermission(),
      spaceRootRefsUpdatePermission(),
    ],
    refDomain: config.refDomain,
  })
    .setProtectedHeader({ alg: CapabilityAlgorithm, kid: config.keyId, typ: CapabilityTokenType })
    .setIssuer(config.issuer)
    .setSubject(config.principalId)
    .setAudience(config.audience)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .setJti(crypto.randomUUID())
    .sign(privateKey);
  const cas = createSpaceCasClient({
    baseUrl: config.unicasBaseUrl,
    appId: config.appId,
    spaceId: config.spaceId,
    getToken: async () => token,
  });
  const catalog = memoryCatalog();
  const files = createTenantFileSystem({ cas, catalog, blobOptions: { chunkBytes: 1024 * 1024 } });
  const root = await files.createRoot("Files");
  try {
    await execute(config, bootstrapInsertSql(config, root.info, Date.now()));
  } catch (error) {
    await files.deleteRoot(root.info.rootId).catch(() => undefined);
    throw error;
  }
  return { status: "created" };
}

function memoryCatalog() {
  let value = null;
  return {
    list: async () => value === null ? [] : [value],
    create: async (input) => {
      const now = Date.now();
      value = { ...input, revision: 1, createdAt: now, updatedAt: now };
      return value;
    },
    update: async (input) => {
      if (!value || value.rootId !== input.rootId || value.revision !== input.revision) {
        throw new Error("Bootstrap catalog revision mismatch");
      }
      value = { ...value, ...input, revision: value.revision + 1, updatedAt: Date.now() };
      return value;
    },
    delete: async (input) => {
      if (!value || value.rootId !== input.rootId || value.revision !== input.revision) {
        throw new Error("Bootstrap catalog revision mismatch");
      }
      value = null;
    },
  };
}

export async function executeD1(config, statement) {
  const isQuery = /^\s*SELECT\b/i.test(statement);
  if (!isQuery) {
    mkdirSync(dirname(TEMP_SQL), { recursive: true });
    writeFileSync(TEMP_SQL, `${statement}\n`, { mode: 0o600 });
  }
  try {
    const result = spawnSync(process.execPath, [
      WRANGLER_CLI,
      "d1", "execute", "SPACES_DB", "--remote", "--config", config.wranglerConfig,
      ...(isQuery ? ["--command", statement] : ["--file", TEMP_SQL]),
      "--json",
    ], { cwd: ROOT, encoding: "utf8", shell: false });
    if (result.error || result.status !== 0) throw new Error("Spaces D1 bootstrap command failed");
    return isQuery ? parseD1Rows(result.stdout) : [];
  } finally {
    if (!isQuery) rmSync(TEMP_SQL, { force: true });
  }
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function boundedText(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be 1-256 characters without controls`);
  }
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = readBootstrapConfig(parseBootstrapArgs(process.argv.slice(2)).mode);
    const result = await bootstrapSpacesPrincipal(config);
    console.log(`Spaces bootstrap ${result.status}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function readPrivateKey(path) {
  const content = readFileSync(path, "utf8");
  if (!content.trimStart().startsWith("{")) return content;
  const fixture = JSON.parse(content);
  if (typeof fixture.privateKeyPkcs8 !== "string" || fixture.privateKeyPkcs8.length === 0) {
    throw new Error("Spaces signing-key fixture has no privateKeyPkcs8");
  }
  return fixture.privateKeyPkcs8;
}
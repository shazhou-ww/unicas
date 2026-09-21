import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONTROL_SCHEMA_MIGRATIONS } from "../../../packages/service-cloudflare/src/control-schema.ts";
import { APP_SPACE_SCHEMA_MIGRATIONS } from "../../../packages/service-cloudflare/src/schema.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVICE_PACKAGE = "@unicas/service-cloudflare";
const EXPECTED_STACK_NAME = "Production Smoke";
const EXPECTED_TENANT_ID = "deploy-smoke";
const EXPECTED_API_ORIGIN = "https://api.unicas.work";
const EXPECTED_SMOKE_ISSUER = "https://unicas.work/deploy-smoke";
const CONTROL_DATABASE = "unicas-control";
const TENANT_DATABASE = "unicas-tenant";
const CONTENT_BUCKET = "unicas-content";
const OAUTH_BINDING = "OAUTH_KV";
const NO_BACKUP_CONFIRMATION = "DELETE-ALL-TEST-DATA-NO-BACKUP";
const BOOTSTRAP_EMAIL = "shazhou.ww@gmail.com";
const DIRECT_UPLOAD_SECRETS = new Set(["CAS_R2_ACCESS_KEY_ID", "CAS_R2_SECRET_ACCESS_KEY"]);
function maintenanceSource(nonce) {
  return `const nonce = ${JSON.stringify(nonce)};
const unavailable = () => new Response("UniCAS maintenance", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300", "X-UniCAS-Maintenance": "account-cutover" } });
async function inventory(env) {
  const r2Keys = [];
  let r2Cursor;
  do {
    const page = await env.CAS_R2.list({ cursor: r2Cursor, limit: 1000 });
    r2Keys.push(...page.objects.map((object) => object.key));
    r2Cursor = page.truncated ? page.cursor : undefined;
  } while (r2Cursor);
  const kvKeys = [];
  let kvCursor;
  do {
    const page = await env.OAUTH_KV.list({ cursor: kvCursor, limit: 1000 });
    kvKeys.push(...page.keys.map((key) => key.name));
    kvCursor = page.list_complete ? undefined : page.cursor;
  } while (kvCursor);
  return Response.json({ r2Keys: r2Keys.sort(), kvKeys: kvKeys.sort() });
}
export default { fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/_internal/cutover-inventory" && request.headers.get("X-UniCAS-Cutover") === nonce) return inventory(env);
  return unavailable();
} };
export class CasDurableObject { fetch() { return unavailable(); } }
export class RootRefDomainDurableObject { fetch() { return unavailable(); } }
`;
}

const CONTROL_TABLES = [
  "cas_oauth_issuer_inspection_keys",
  "cas_oauth_issuer_inspections",
  "cas_app_oauth_issuers",
  "cas_app_member_invitations",
  "cas_app_members",
  "cas_account_app_invitation_idempotency",
  "cas_account_app_idempotency",
  "cas_control_idempotency",
  "cas_platform_invitation_idempotency",
  "cas_platform_invitations",
  "cas_control_audit_events",
  "cas_platform_audit_events",
  "cas_admin_sessions",
  "cas_email_challenges",
  "cas_account_platform_authorities",
  "cas_platform_principals",
  "cas_external_identities",
  "cas_account_profiles",
  "cas_account_aliases",
  "cas_operator_identities",
  "cas_apps",
  "cas_accounts",
  "cas_control_meta",
];

const TENANT_TABLES = [
  "cas_usage_projection_migrations",
  "cas_space_usage",
  "cas_edges",
  "cas_root_ref_requests",
  "cas_root_domain_events",
  "cas_root_domain_refs",
  "cas_root_domain_revisions",
  "cas_upload_reservations",
  "cas_direct_upload_sessions",
  "cas_nodes",
];

function migrationTableNames(migrations) {
  return migrations.flatMap((statement) => {
    const match = /^CREATE TABLE IF NOT EXISTS ([A-Za-z0-9_]+)/.exec(statement);
    return match ? [match[1]] : [];
  }).sort();
}

const CURRENT_CONTROL_TABLES = migrationTableNames(CONTROL_SCHEMA_MIGRATIONS);
const CURRENT_TENANT_TABLES = migrationTableNames(APP_SPACE_SCHEMA_MIGRATIONS);

export const SCOPED_INVENTORY_QUERIES = {
  control: [
    `SELECT 'cas_apps' AS source, app_id AS stack_id FROM cas_apps GROUP BY app_id
     UNION ALL SELECT 'cas_app_members', app_id FROM cas_app_members GROUP BY app_id
      UNION ALL SELECT 'cas_app_member_invitations', app_id FROM cas_app_member_invitations GROUP BY app_id
      UNION ALL SELECT 'cas_account_app_invitation_idempotency', app_id FROM cas_account_app_invitation_idempotency GROUP BY app_id`,
    `SELECT 'cas_app_oauth_issuers' AS source, app_id AS stack_id FROM cas_app_oauth_issuers GROUP BY app_id
     UNION ALL SELECT 'cas_oauth_issuer_inspections', app_id FROM cas_oauth_issuer_inspections GROUP BY app_id
     UNION ALL SELECT 'cas_control_audit_events', app_id FROM cas_control_audit_events WHERE app_id IS NOT NULL GROUP BY app_id`,
  ],
  data: [
    `SELECT 'cas_nodes' AS source, app_id AS stack_id, space_id AS tenant_id FROM cas_nodes GROUP BY app_id, space_id
     UNION ALL SELECT 'cas_edges', app_id, space_id FROM cas_edges GROUP BY app_id, space_id
     UNION ALL SELECT 'cas_root_ref_requests', app_id, space_id FROM cas_root_ref_requests GROUP BY app_id, space_id
     UNION ALL SELECT 'cas_root_domain_events', app_id, space_id FROM cas_root_domain_events GROUP BY app_id, space_id`,
    `SELECT 'cas_root_domain_refs' AS source, app_id AS stack_id, space_id AS tenant_id FROM cas_root_domain_refs GROUP BY app_id, space_id
     UNION ALL SELECT 'cas_root_domain_revisions', app_id, NULL FROM cas_root_domain_revisions GROUP BY app_id
     UNION ALL SELECT 'cas_upload_reservations', app_id, space_id FROM cas_upload_reservations GROUP BY app_id, space_id
     UNION ALL SELECT 'cas_direct_upload_sessions', app_id, space_id FROM cas_direct_upload_sessions GROUP BY app_id, space_id`,
    "SELECT 'cas_space_usage' AS source, app_id AS stack_id, space_id AS tenant_id FROM cas_space_usage GROUP BY app_id, space_id",
  ],
};

export function parseResetArgs(argv) {
  const options = {
    execute: false,
    verifyCurrent: false,
    expectedStackId: undefined,
    backupDir: undefined,
    confirmation: undefined,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--execute") options.execute = true;
    else if (argument === "--verify-current") options.verifyCurrent = true;
    else if (argument === "--expected-stack-id") options.expectedStackId = argv[++index];
    else if (argument === "--backup-dir") options.backupDir = argv[++index];
    else if (argument === "--confirm") options.confirmation = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.execute && options.verifyCurrent) {
    throw new Error("--execute and --verify-current cannot be combined");
  }
  if ((options.execute || options.verifyCurrent) && !options.expectedStackId) {
    throw new Error("--execute and --verify-current require --expected-stack-id");
  }
  if (options.execute && !options.backupDir && options.confirmation !== NO_BACKUP_CONFIRMATION) {
    throw new Error(`backup-free execution requires --confirm ${NO_BACKUP_CONFIRMATION}`);
  }
  return options;
}

export function validateResetInventory(inventory, expectedStackId) {
  if (!/^cas_[A-Za-z0-9_-]+$/.test(expectedStackId)) {
    throw new Error("expected stack id is not a canonical UniCAS stack id");
  }
  if (inventory.stacks.length !== 1) {
    throw new Error(`expected exactly one smoke stack, found ${inventory.stacks.length}`);
  }
  const stack = inventory.stacks[0];
  if (stack.stack_id !== expectedStackId || stack.display_name !== EXPECTED_STACK_NAME) {
    throw new Error("remote stack does not match the explicit Production Smoke target");
  }
  if (inventory.tenants.length > 1 || inventory.tenants.some((tenant) => (
    tenant.stack_id !== expectedStackId || tenant.tenant_id !== EXPECTED_TENANT_ID
  ))) {
    throw new Error("remote tenant data is not limited to the deploy-smoke tenant");
  }
  if (!Array.isArray(inventory.controlScopes) || !Array.isArray(inventory.dataScopes)) {
    throw new Error("remote scoped-table inventory is incomplete");
  }
  if (!Array.isArray(inventory.controlTables) || !Array.isArray(inventory.tenantTables)) {
    throw new Error("remote schema inventory is incomplete");
  }
  const unknownTables = [
    ...inventory.controlTables.filter((table) => !CONTROL_TABLES.includes(table)),
    ...inventory.tenantTables.filter((table) => !TENANT_TABLES.includes(table)),
  ];
  if (unknownTables.length > 0) {
    throw new Error(`remote schema contains unknown tables: ${unknownTables.join(", ")}`);
  }
  if (inventory.controlScopes.some((row) => row.stack_id !== expectedStackId)) {
    throw new Error("remote control data contains a stack outside the smoke target");
  }
  if (inventory.dataScopes.some((row) => (
    row.stack_id !== expectedStackId
    || (row.tenant_id !== null && row.tenant_id !== EXPECTED_TENANT_ID)
  ))) {
    throw new Error("remote tenant data contains a partition outside the smoke target");
  }
  const objectPattern = new RegExp(
    `^apps/${expectedStackId}/spaces/${EXPECTED_TENANT_ID}/nodes-v2/[a-f0-9]{64}$`,
  );
  if (inventory.objectKeys.some((key) => !objectPattern.test(key))) {
    throw new Error("remote object inventory contains a key outside the smoke prefix");
  }
  if (inventory.oauthKeys.some((key) => !/^[A-Za-z0-9:_-]+$/.test(key))) {
    throw new Error("remote OAuth inventory contains an unsafe key name");
  }
  if (inventory.pendingUploads !== 0) {
    throw new Error("remote tenant database contains pending direct uploads");
  }
  if (inventory.workerSecrets.some((name) => DIRECT_UPLOAD_SECRETS.has(name))) {
    throw new Error("direct-upload signing credentials must be revoked before reset");
  }
  if (inventory.externalIssuers.length !== 1) {
    throw new Error("expected exactly one external smoke issuer");
  }
  if (inventory.bootstrapIdentities.length !== 1) {
    throw new Error("expected exactly one authorized Google bootstrap identity");
  }
  const identity = inventory.bootstrapIdentities[0];
  if (
    identity.identity_issuer !== "https://accounts.google.com"
    || identity.app_id !== expectedStackId
  ) {
    throw new Error("bootstrap identity does not match the expected Google App membership");
  }
  const issuer = inventory.externalIssuers[0];
  if (
    issuer.stack_id !== expectedStackId
    || issuer.issuer !== EXPECTED_SMOKE_ISSUER
    || issuer.audience !== `${EXPECTED_API_ORIGIN}/stacks/${expectedStackId}`
    || issuer.status !== "active"
  ) {
    throw new Error("external smoke issuer does not match the expected production binding");
  }
}

export function resetPlan(inventory) {
  const commands = [];
  for (const key of inventory.objectKeys) {
    commands.push(wrangler("r2", "object", "delete", `${CONTENT_BUCKET}/${key}`, "--remote", "--force"));
  }
  for (const key of inventory.oauthKeys) {
    commands.push(wrangler("kv", "key", "delete", key, "--binding", OAUTH_BINDING, "--remote"));
  }
  commands.push(wrangler(
    "d1", "execute", TENANT_DATABASE, "--remote", "--yes", "--command",
    TENANT_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`).join(";"),
  ));
  commands.push(wrangler(
    "d1", "execute", CONTROL_DATABASE, "--remote", "--yes", "--command",
    CONTROL_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`).join(";"),
  ));
  return commands;
}

function resourceDeletePlan({ r2Keys, kvKeys }) {
  return resetPlan({ objectKeys: r2Keys, oauthKeys: kvKeys }).slice(0, r2Keys.length + kvKeys.length);
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("bootstrap contains a non-finite number");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function randomId(prefix, byteLength, random) {
  return `${prefix}${random(byteLength).toString("base64url")}`;
}

export function bootstrapStatements(inventory, { now = Date.now(), random = randomBytes } = {}) {
  const app = inventory.stacks[0];
  const issuer = inventory.externalIssuers[0];
  if (!inventory.bootstrapIdentities[0] || !app || !issuer) throw new Error("bootstrap inventory is incomplete");

  const accountId = randomId("acct_", 16, random);
  const externalIdentityId = randomId("ext_", 16, random);
  const eventId = () => randomId("evt_", 9, random);
  const issuerColumns = [
    "app_id", "mode", "issuer", "audience", "metadata_url", "metadata_type",
    "authorization_endpoint", "token_endpoint", "jwks_uri", "registration_endpoint",
    "scopes_supported", "code_challenge_methods_supported", "status", "verified_at",
    "last_refresh_at", "last_refresh_error", "jwks_digest",
    "capability_max_lifetime_seconds", "revision",
  ];
  const issuerValues = { ...issuer, app_id: app.stack_id };
  const captureStatements = [
    "CREATE TABLE cas_cutover_identity (identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, display_name TEXT, joined_at INTEGER NOT NULL)",
    `INSERT INTO cas_cutover_identity (identity_issuer, subject, display_name, joined_at)
     SELECT i.identity_issuer, i.subject, NULLIF(trim(i.display_name), ''), m.joined_at
     FROM cas_operator_identities AS i
     JOIN cas_platform_principals AS p
       ON p.identity_issuer = i.identity_issuer AND p.subject = i.subject
     JOIN cas_app_members AS m
       ON m.identity_issuer = i.identity_issuer AND m.subject = i.subject
     WHERE i.identity_issuer = 'https://accounts.google.com'
       AND lower(trim(i.email_for_display)) = '${BOOTSTRAP_EMAIL}'
       AND p.status = 'active' AND p.platform_admin = 1 AND p.apps_create = 1
       AND m.app_id = ${sqlValue(app.stack_id)}`,
  ];
  const statements = [
    `INSERT INTO cas_accounts (account_id, blocked_at, credential_version, primary_verified_email, email_verification_source, email_verified_at, created_at, updated_at) VALUES (${sqlValue(accountId)}, NULL, 1, NULL, NULL, NULL, ${now}, ${now})`,
    `INSERT INTO cas_account_profiles (account_id, display_name, avatar_url, display_name_source, avatar_source, updated_at) SELECT ${sqlValue(accountId)}, display_name, NULL, CASE WHEN display_name IS NULL THEN NULL ELSE ${sqlValue(externalIdentityId)} END, NULL, ${now} FROM cas_cutover_identity`,
    `INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at, last_authenticated_at, unlinked_at, account_hint, display_name, avatar_url) SELECT ${sqlValue(externalIdentityId)}, ${sqlValue(accountId)}, 'google', identity_issuer, subject, ${now}, NULL, NULL, NULL, display_name, NULL FROM cas_cutover_identity`,
    `INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (${sqlValue(accountId)}, 'platform.admin', ${now})`,
    `INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (${sqlValue(accountId)}, 'apps.create', ${now})`,
    `INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES (${[
      app.stack_id,
      app.display_name,
      app.description,
      app.status,
      app.created_at,
      app.revision,
    ].map(sqlValue).join(", ")})`,
    `INSERT INTO cas_app_members (app_id, account_id, joined_at) SELECT ${sqlValue(app.stack_id)}, ${sqlValue(accountId)}, joined_at FROM cas_cutover_identity`,
    `INSERT INTO cas_app_oauth_issuers (${issuerColumns.join(", ")}) VALUES (${issuerColumns.map((column) => sqlValue(issuerValues[column])).join(", ")})`,
    `INSERT INTO cas_platform_audit_events (event_id, actor_account_id, actor_external_identity_id, target_account_id, target_invitation_id, action, result, request_id, created_at, details_json) VALUES (${sqlValue(eventId())}, ${sqlValue(accountId)}, ${sqlValue(externalIdentityId)}, ${sqlValue(accountId)}, NULL, 'platform_access.authority_changed', 'succeeded', NULL, ${now}, ${sqlValue(JSON.stringify({ source: "out-of-band-bootstrap", authority: "platform.admin", granted: true }))})`,
    `INSERT INTO cas_platform_audit_events (event_id, actor_account_id, actor_external_identity_id, target_account_id, target_invitation_id, action, result, request_id, created_at, details_json) VALUES (${sqlValue(eventId())}, ${sqlValue(accountId)}, ${sqlValue(externalIdentityId)}, ${sqlValue(accountId)}, NULL, 'platform_access.authority_changed', 'succeeded', NULL, ${now}, ${sqlValue(JSON.stringify({ source: "out-of-band-bootstrap", authority: "apps.create", granted: true }))})`,
    `INSERT INTO cas_control_audit_events (event_id, app_id, action, target, request_id, trace_id, caller_channel, oauth_client_handle, tool_name, created_at, original_account_id, external_identity_id, target_account_id) VALUES (${sqlValue(eventId())}, ${sqlValue(app.stack_id)}, 'app.created', ${sqlValue(app.stack_id)}, NULL, NULL, 'bootstrap', NULL, NULL, ${now}, ${sqlValue(accountId)}, ${sqlValue(externalIdentityId)}, NULL)`,
    "INSERT INTO cas_control_meta (key, value) VALUES ('snapshot', 1)",
    "DROP TABLE cas_cutover_identity",
  ];
  return { accountId, externalIdentityId, captureStatements, statements };
}

export function r2BackupPlan(inventory, backupDir) {
  return inventory.objectKeys.map((key) => wrangler(
    "r2", "object", "get", `${CONTENT_BUCKET}/${key}`,
    "--file", r2BackupFilePath(backupDir, key), "--remote",
  ));
}

export function validateR2BackupFiles(objectKeys, backupDir) {
  return objectKeys.map((objectKey) => {
    const expectedHash = canonicalHashFromKey(objectKey, false);
    const path = r2BackupFilePath(backupDir, objectKey);
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`required non-empty R2 backup is missing: ${path}`);
    }
    const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (expectedHash && actualHash !== expectedHash) {
      throw new Error(`R2 backup digest does not match its canonical key: ${objectKey}`);
    }
    return {
      objectKey,
      file: `r2/${r2BackupFileName(objectKey)}`,
      bytes: statSync(path).size,
      sha256: actualHash,
    };
  });
}

function validateD1Backups(backupDir) {
  const records = [];
  for (const name of ["unicas-control.sql", "unicas-tenant.sql"]) {
    const path = resolve(backupDir, name);
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`required non-empty backup is missing: ${path}`);
    }
    records.push({
      file: name,
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    });
  }
  return records;
}

function executeD1Backups(backupDir) {
  mkdirSync(backupDir, { recursive: true });
  for (const database of [CONTROL_DATABASE, TENANT_DATABASE]) {
    const path = resolve(backupDir, `${database}.sql`);
    if (existsSync(path)) throw new Error(`D1 backup already exists; use a fresh backup directory: ${path}`);
    run(wrangler(
      "d1", "export", database, "--remote", "--skip-confirmation", "--output", path,
    ));
  }
  return validateD1Backups(backupDir);
}

function canonicalHashFromKey(objectKey, required = true) {
  const match = /\/([a-f0-9]{64})$/.exec(objectKey);
  if (!match && required) throw new Error(`R2 object key is not canonical: ${objectKey}`);
  return match?.[1] ?? null;
}

function r2BackupFileName(objectKey) {
  const canonicalHash = canonicalHashFromKey(objectKey, false);
  const name = canonicalHash ?? createHash("sha256").update(objectKey).digest("hex");
  return `${name}.bin`;
}

function r2BackupFilePath(backupDir, objectKey) {
  return resolve(backupDir, "r2", r2BackupFileName(objectKey));
}

function executeR2Backups(inventory, backupDir) {
  const manifestPath = resolve(backupDir, "backup-manifest.json");
  if (existsSync(manifestPath)) {
    throw new Error(`backup manifest already exists; use a fresh backup directory: ${manifestPath}`);
  }
  const paths = inventory.objectKeys.map((key) => r2BackupFilePath(backupDir, key));
  const existing = paths.find((path) => existsSync(path));
  if (existing) throw new Error(`R2 backup file already exists; use a fresh backup directory: ${existing}`);
  mkdirSync(resolve(backupDir, "r2"), { recursive: true });
  for (const command of r2BackupPlan(inventory, backupDir)) run(command);
  return validateR2BackupFiles(inventory.objectKeys, backupDir);
}

function wrangler(...args) {
  return ["pnpm", "--filter", SERVICE_PACKAGE, "exec", "wrangler", ...args];
}

function commandText(command) {
  return command.map((argument) => (
    /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(argument)
      ? argument
      : `"${argument.replaceAll('"', '""')}"`
  )).join(" ");
}

function run(command, capture = false) {
  let executable = command[0];
  let args = command.slice(1);
  if (process.platform === "win32" && executable === "pnpm") {
    const pnpmCli = resolve(dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js");
    if (!existsSync(pnpmCli)) throw new Error(`Corepack pnpm entrypoint is unavailable: ${pnpmCli}`);
    executable = process.execPath;
    args = [pnpmCli, ...args];
  }
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`command failed: ${commandText(command)}`);
  }
  return result.stdout ?? "";
}

function runRedacted(command) {
  let executable = command[0];
  let args = command.slice(1);
  if (process.platform === "win32" && executable === "pnpm") {
    const pnpmCli = resolve(dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js");
    if (!existsSync(pnpmCli)) throw new Error("Corepack pnpm entrypoint is unavailable");
    executable = process.execPath;
    args = [pnpmCli, ...args];
  }
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("redacted production database operation failed");
}

function query(database, sql) {
  const output = run(wrangler("d1", "execute", database, "--remote", "--json", "--command", sql), true);
  const parsed = JSON.parse(output);
  return parsed[0]?.results ?? [];
}

function remoteInventory() {
  const stacks = query(
    CONTROL_DATABASE,
    "SELECT app_id AS stack_id, display_name, description, status, created_at, revision FROM cas_apps ORDER BY app_id",
  );
  const externalIssuers = query(
    CONTROL_DATABASE,
    "SELECT app_id AS stack_id, mode, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, registration_endpoint, scopes_supported, code_challenge_methods_supported, status, verified_at, last_refresh_at, last_refresh_error, jwks_digest, capability_max_lifetime_seconds, revision FROM cas_app_oauth_issuers ORDER BY app_id",
  );
  const bootstrapIdentities = query(
    CONTROL_DATABASE,
    `SELECT i.identity_issuer, i.display_name, m.app_id, m.joined_at FROM cas_operator_identities AS i JOIN cas_platform_principals AS p ON p.identity_issuer = i.identity_issuer AND p.subject = i.subject JOIN cas_app_members AS m ON m.identity_issuer = i.identity_issuer AND m.subject = i.subject WHERE i.identity_issuer = 'https://accounts.google.com' AND lower(trim(i.email_for_display)) = '${BOOTSTRAP_EMAIL}' AND p.status = 'active' AND p.platform_admin = 1 AND p.apps_create = 1 ORDER BY m.app_id`,
  );
  const tenants = query(
    TENANT_DATABASE,
    "SELECT DISTINCT app_id AS stack_id, space_id AS tenant_id FROM cas_nodes ORDER BY app_id, space_id",
  );
  const pendingUploads = query(
    TENANT_DATABASE,
    "SELECT COUNT(*) AS count FROM cas_direct_upload_sessions",
  )[0]?.count ?? 0;
  const controlScopes = SCOPED_INVENTORY_QUERIES.control.flatMap((sql) => query(CONTROL_DATABASE, sql));
  const dataScopes = SCOPED_INVENTORY_QUERIES.data.flatMap((sql) => query(TENANT_DATABASE, sql));
  const objectKeys = query(
    TENANT_DATABASE,
    "SELECT 'apps/' || app_id || '/spaces/' || space_id || '/nodes-v2/' || hash AS object_key FROM cas_nodes ORDER BY app_id, space_id, hash",
  ).map((row) => row.object_key);
  const oauthKeys = JSON.parse(run(
    wrangler("kv", "key", "list", "--binding", OAUTH_BINDING, "--remote"),
    true,
  )).map((entry) => entry.name);
  const workerSecrets = JSON.parse(run(
    wrangler("secret", "list", "--format", "json"),
    true,
  )).map((entry) => entry.name).sort();
  const tableNames = (database) => query(
    database,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).map((row) => row.name);
  return {
    stacks,
    externalIssuers,
    bootstrapIdentities,
    tenants,
    pendingUploads,
    controlScopes,
    dataScopes,
    objectKeys,
    oauthKeys,
    workerSecrets,
    controlTables: tableNames(CONTROL_DATABASE),
    tenantTables: tableNames(TENANT_DATABASE),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize).toSorted((left, right) => (
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    ));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function inventoryDigest(inventory) {
  return createHash("sha256").update(JSON.stringify(canonicalize(inventory))).digest("hex");
}

function publishMaintenance() {
  const directory = mkdtempSync(join(tmpdir(), "unicas-account-cutover-"));
  const nonce = randomBytes(32).toString("base64url");
  try {
    const source = join(directory, "maintenance.mjs");
    writeFileSync(source, maintenanceSource(nonce), { mode: 0o600 });
    run(wrangler(
      "deploy",
      source,
      "--config",
      resolve(ROOT, "packages/service-cloudflare/wrangler.toml"),
    ));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return nonce;
}

async function maintenanceInventory(nonce) {
  const response = await fetch("https://api.unicas.work/_internal/cutover-inventory", {
    headers: { "X-UniCAS-Cutover": nonce },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("maintenance inventory endpoint is unavailable");
  const inventory = await response.json();
  if (!Array.isArray(inventory.r2Keys) || !Array.isArray(inventory.kvKeys)) {
    throw new Error("maintenance inventory response is invalid");
  }
  return {
    r2Keys: inventory.r2Keys.toSorted(),
    kvKeys: inventory.kvKeys.toSorted(),
  };
}

function validatePhysicalInventory(inventory, expectedStackId, expectedKvKeys) {
  const nodePattern = new RegExp(
    `^apps/${expectedStackId}/spaces/${EXPECTED_TENANT_ID}/nodes-v2/[a-f0-9]{64}$`,
  );
  const uploadPattern = /^_uploads\/v1\/[A-Za-z0-9_-]+$/;
  if (inventory.r2Keys.some((key) => !nodePattern.test(key) && !uploadPattern.test(key))) {
    throw new Error("physical R2 inventory contains an object outside the smoke boundary");
  }
  if (JSON.stringify(inventory.kvKeys) !== JSON.stringify(expectedKvKeys.toSorted())) {
    throw new Error("physical OAuth KV inventory changed before reset");
  }
}

async function verifyMaintenanceOrigins() {
  for (const origin of ["https://api.unicas.work", "https://console.unicas.work"]) {
    const response = await fetch(`${origin}/health?cutover=${crypto.randomUUID()}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 503 || response.headers.get("X-UniCAS-Maintenance") !== "account-cutover") {
      throw new Error(`maintenance verification failed for ${origin}`);
    }
  }
}

async function verifyMaintenance(nonce) {
  await verifyMaintenanceOrigins();
  return maintenanceInventory(nonce);
}

function sqlFile(directory, name, statements) {
  const path = join(directory, name);
  writeFileSync(path, `${statements.map((statement) => statement.trim().replace(/;+$/, "")).join(";\n")};\n`, {
    mode: 0o600,
  });
  return path;
}

function rebuildCurrentSchemas(inventory) {
  const directory = mkdtempSync(join(tmpdir(), "unicas-current-schema-"));
  try {
    const bootstrap = bootstrapStatements(inventory);
    const tenantFile = sqlFile(directory, "tenant.sql", [
      ...TENANT_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`),
      ...APP_SPACE_SCHEMA_MIGRATIONS,
    ]);
    const controlFile = sqlFile(directory, "control.sql", [
      ...bootstrap.captureStatements,
      ...CONTROL_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`),
      ...CONTROL_SCHEMA_MIGRATIONS,
      ...bootstrap.statements,
    ]);
    runRedacted(wrangler("d1", "execute", TENANT_DATABASE, "--remote", "--yes", "--file", tenantFile));
    runRedacted(wrangler("d1", "execute", CONTROL_DATABASE, "--remote", "--yes", "--file", controlFile));
    return bootstrap;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function verifyBootstrap(bootstrap, expectedStackId) {
  const tableNames = (database) => query(
    database,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).map((row) => row.name);
  if (JSON.stringify(tableNames(CONTROL_DATABASE)) !== JSON.stringify(CURRENT_CONTROL_TABLES)) {
    throw new Error("control database does not contain exactly the current schema");
  }
  if (JSON.stringify(tableNames(TENANT_DATABASE)) !== JSON.stringify(CURRENT_TENANT_TABLES)) {
    throw new Error("tenant database does not contain exactly the current schema");
  }
  const control = query(
    CONTROL_DATABASE,
    `SELECT (SELECT COUNT(*) FROM cas_accounts) AS accounts, (SELECT COUNT(*) FROM cas_account_profiles) AS profiles, (SELECT COUNT(*) FROM cas_external_identities WHERE unlinked_at IS NULL) AS active_identities, (SELECT COUNT(*) FROM cas_account_platform_authorities) AS authorities, (SELECT COUNT(*) FROM cas_apps WHERE app_id = '${expectedStackId}' AND display_name = '${EXPECTED_STACK_NAME}') AS smoke_apps, (SELECT COUNT(*) FROM cas_app_members WHERE app_id = '${expectedStackId}' AND account_id = '${bootstrap.accountId}') AS memberships, (SELECT COUNT(*) FROM cas_app_oauth_issuers WHERE app_id = '${expectedStackId}' AND status = 'active') AS issuers, (SELECT COUNT(*) FROM cas_platform_audit_events) AS platform_audit, (SELECT COUNT(*) FROM cas_control_audit_events) AS control_audit, (SELECT COUNT(*) FROM cas_admin_sessions) AS sessions, (SELECT COUNT(*) FROM cas_control_meta WHERE key = 'snapshot' AND value = 1) AS snapshots`,
  )[0];
  const expected = {
    accounts: 1,
    profiles: 1,
    active_identities: 1,
    authorities: 2,
    smoke_apps: 1,
    memberships: 1,
    issuers: 1,
    platform_audit: 2,
    control_audit: 1,
    sessions: 0,
    snapshots: 1,
  };
  if (JSON.stringify(control) !== JSON.stringify(expected)) {
    throw new Error("current control-schema bootstrap verification failed");
  }
  const tenantCounts = [];
  for (let offset = 0; offset < TENANT_TABLES.length; offset += 4) {
    tenantCounts.push(...query(
      TENANT_DATABASE,
      TENANT_TABLES.slice(offset, offset + 4)
        .map((table) => `SELECT '${table}' AS table_name, COUNT(*) AS count FROM ${table}`)
        .join(" UNION ALL "),
    ));
  }
  if (tenantCounts.length !== TENANT_TABLES.length || tenantCounts.some((row) => row.count !== 0)) {
    throw new Error("current tenant schema is not empty after reset");
  }
}

async function verifyCurrentBootstrap(expectedStackId) {
  await verifyMaintenanceOrigins();
  const accounts = query(CONTROL_DATABASE, "SELECT account_id FROM cas_accounts ORDER BY account_id");
  if (accounts.length !== 1) throw new Error("current schema does not contain exactly one bootstrap Account");
  verifyBootstrap({ accountId: accounts[0].account_id }, expectedStackId);
  return accounts[0].account_id;
}

function printPlan(commands) {
  for (const command of commands) console.log(commandText(command));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const main = async () => {
    try {
      const options = parseResetArgs(process.argv.slice(2));
      if (!options.expectedStackId) {
        console.log("No-op. Pass --expected-stack-id to print a live reset plan; use --execute for cutover or --verify-current to resume verification.");
        process.exit(0);
      }
      if (options.verifyCurrent) {
        const accountId = await verifyCurrentBootstrap(options.expectedStackId);
        console.log(JSON.stringify({ resetVerified: true, bootstrapVerified: true, accountId, maintenanceActive: true }));
        return;
      }
      const inventory = remoteInventory();
      validateResetInventory(inventory, options.expectedStackId);
      const backupCommands = options.backupDir ? r2BackupPlan(inventory, options.backupDir) : [];
      const commands = resetPlan(inventory);
      printPlan([...backupCommands, ...commands]);
      if (options.execute) {
        const maintenanceNonce = publishMaintenance();
        const physicalInventory = await verifyMaintenance(maintenanceNonce);
        validatePhysicalInventory(physicalInventory, options.expectedStackId, inventory.oauthKeys);
        const maintainedInventory = remoteInventory();
        validateResetInventory(maintainedInventory, options.expectedStackId);
        if (inventoryDigest(maintainedInventory) !== inventoryDigest(inventory)) {
          throw new Error("production inventory changed after maintenance activation");
        }
        if (options.backupDir) {
          const d1 = executeD1Backups(options.backupDir);
          const r2 = executeR2Backups({ objectKeys: physicalInventory.r2Keys }, options.backupDir);
          writeFileSync(resolve(options.backupDir, "backup-manifest.json"), `${JSON.stringify({ d1, r2 }, null, 2)}\n`, { flag: "wx" });
        }
        for (const command of resourceDeletePlan(physicalInventory)) run(command);
        const emptyPhysicalInventory = await maintenanceInventory(maintenanceNonce);
        if (emptyPhysicalInventory.r2Keys.length > 0 || emptyPhysicalInventory.kvKeys.length > 0) {
          throw new Error("physical R2 or KV state remains after reset");
        }
        const bootstrap = rebuildCurrentSchemas(inventory);
        verifyBootstrap(bootstrap, options.expectedStackId);
        console.log(JSON.stringify({
          resetVerified: true,
          bootstrapVerified: true,
          accountId: bootstrap.accountId,
          maintenanceActive: true,
        }));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
  await main();
}
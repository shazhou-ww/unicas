import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

const CONTROL_TABLES = [
  "cas_oauth_issuer_inspection_keys",
  "cas_oauth_issuer_inspections",
  "cas_app_managed_issuers",
  "cas_app_oauth_issuers",
  "cas_playground_file_roots",
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
  "cas_edges",
  "cas_root_ref_requests",
  "cas_root_domain_events",
  "cas_root_domain_refs",
  "cas_root_domain_revisions",
  "cas_upload_reservations",
  "cas_direct_upload_sessions",
  "cas_nodes",
];

export const SCOPED_INVENTORY_QUERIES = {
  control: [
    `SELECT 'cas_apps' AS source, app_id AS stack_id FROM cas_apps GROUP BY app_id
     UNION ALL SELECT 'cas_app_members', app_id FROM cas_app_members GROUP BY app_id
      UNION ALL SELECT 'cas_app_member_invitations', app_id FROM cas_app_member_invitations GROUP BY app_id
      UNION ALL SELECT 'cas_account_app_invitation_idempotency', app_id FROM cas_account_app_invitation_idempotency GROUP BY app_id`,
    `SELECT 'cas_app_oauth_issuers' AS source, app_id AS stack_id FROM cas_app_oauth_issuers GROUP BY app_id
     UNION ALL SELECT 'cas_app_managed_issuers', app_id FROM cas_app_managed_issuers GROUP BY app_id
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
  ],
};

export function parseResetArgs(argv) {
  const options = { execute: false, expectedStackId: undefined, backupDir: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--execute") options.execute = true;
    else if (argument === "--expected-stack-id") options.expectedStackId = argv[++index];
    else if (argument === "--backup-dir") options.backupDir = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.execute && !options.expectedStackId) {
    throw new Error("--execute requires --expected-stack-id");
  }
  if (options.execute && !options.backupDir) {
    throw new Error("--execute requires --backup-dir");
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
  if (inventory.externalIssuers.length !== 1) {
    throw new Error("expected exactly one external smoke issuer");
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

export function r2BackupPlan(inventory, backupDir) {
  return inventory.objectKeys.map((key) => wrangler(
    "r2", "object", "get", `${CONTENT_BUCKET}/${key}`,
    "--file", r2BackupFilePath(backupDir, key), "--remote",
  ));
}

export function validateR2BackupFiles(objectKeys, backupDir) {
  return objectKeys.map((objectKey) => {
    const expectedHash = canonicalHashFromKey(objectKey);
    const path = r2BackupFilePath(backupDir, objectKey);
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`required non-empty R2 backup is missing: ${path}`);
    }
    const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(`R2 backup digest does not match its canonical key: ${objectKey}`);
    }
    return {
      objectKey,
      file: `r2/${expectedHash}.bin`,
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

function canonicalHashFromKey(objectKey) {
  const match = /\/([a-f0-9]{64})$/.exec(objectKey);
  if (!match) throw new Error(`R2 object key is not canonical: ${objectKey}`);
  return match[1];
}

function r2BackupFilePath(backupDir, objectKey) {
  return resolve(backupDir, "r2", `${canonicalHashFromKey(objectKey)}.bin`);
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

function query(database, sql) {
  const output = run(wrangler("d1", "execute", database, "--remote", "--json", "--command", sql), true);
  const parsed = JSON.parse(output);
  return parsed[0]?.results ?? [];
}

function remoteInventory() {
  const stacks = query(CONTROL_DATABASE, "SELECT app_id AS stack_id, display_name FROM cas_apps ORDER BY app_id");
  const externalIssuers = query(
    CONTROL_DATABASE,
    "SELECT app_id AS stack_id, issuer, audience, status FROM cas_app_oauth_issuers ORDER BY app_id",
  );
  const tenants = query(
    TENANT_DATABASE,
    "SELECT DISTINCT app_id AS stack_id, space_id AS tenant_id FROM cas_nodes ORDER BY app_id, space_id",
  );
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
  const tableNames = (database) => query(
    database,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).map((row) => row.name);
  return {
    stacks,
    externalIssuers,
    tenants,
    controlScopes,
    dataScopes,
    objectKeys,
    oauthKeys,
    controlTables: tableNames(CONTROL_DATABASE),
    tenantTables: tableNames(TENANT_DATABASE),
  };
}

function printPlan(commands) {
  for (const command of commands) console.log(commandText(command));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseResetArgs(process.argv.slice(2));
    if (!options.expectedStackId) {
      console.log("No-op. Pass --expected-stack-id to print a live reset plan; add --execute and --backup-dir only after review.");
      process.exit(0);
    }
    const inventory = remoteInventory();
    validateResetInventory(inventory, options.expectedStackId);
    const backupCommands = options.backupDir ? r2BackupPlan(inventory, options.backupDir) : [];
    const commands = resetPlan(inventory);
    printPlan([...backupCommands, ...commands]);
    if (options.execute) {
      const d1 = validateD1Backups(options.backupDir);
      const r2 = executeR2Backups(inventory, options.backupDir);
      writeFileSync(resolve(options.backupDir, "backup-manifest.json"), `${JSON.stringify({ d1, r2 }, null, 2)}\n`, { flag: "wx" });
      for (const command of commands) run(command);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
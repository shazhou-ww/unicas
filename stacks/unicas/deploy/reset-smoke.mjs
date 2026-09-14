import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVICE_PACKAGE = "@unicas/service-cloudflare";
const EXPECTED_STACK_NAME = "Production Smoke";
const EXPECTED_TENANT_ID = "deploy-smoke";
const EXPECTED_OLD_ORIGIN = "https://unicas.work";
const CONTROL_DATABASE = "unicas-control";
const TENANT_DATABASE = "unicas-tenant";
const CONTENT_BUCKET = "unicas-content";
const OAUTH_BINDING = "OAUTH_KV";

const CONTROL_TABLES = [
  "cas_oauth_issuer_inspection_keys",
  "cas_oauth_issuer_inspections",
  "cas_stack_managed_issuers",
  "cas_stack_oauth_issuers",
  "cas_playground_file_roots",
  "cas_stack_member_invitations",
  "cas_stack_members",
  "cas_control_audit_events",
  "cas_control_idempotency",
  "cas_admin_sessions",
  "cas_operator_identities",
  "cas_stacks",
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
  if (!/^cas_[A-Za-z0-9]+$/.test(expectedStackId)) {
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
  const objectPattern = new RegExp(
    `^stacks/${expectedStackId}/tenants/${EXPECTED_TENANT_ID}/nodes-v2/[a-f0-9]{64}$`,
  );
  if (inventory.objectKeys.some((key) => !objectPattern.test(key))) {
    throw new Error("remote object inventory contains a key outside the smoke prefix");
  }
  if (inventory.oauthKeys.some((key) => !/^[A-Za-z0-9:_-]+$/.test(key))) {
    throw new Error("remote OAuth inventory contains an unsafe key name");
  }
  if (inventory.managedIssuers.length !== 1) {
    throw new Error("expected exactly one managed smoke issuer");
  }
  const issuer = inventory.managedIssuers[0];
  if (
    issuer.stack_id !== expectedStackId
    || issuer.issuer !== `${EXPECTED_OLD_ORIGIN}/managed-issuers/${expectedStackId}`
    || issuer.audience !== `${EXPECTED_OLD_ORIGIN}/stacks/${expectedStackId}`
  ) {
    throw new Error("managed smoke issuer is not bound to the expected apex origin");
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
    TENANT_TABLES.map((table) => `DELETE FROM ${table}`).join(";"),
  ));
  commands.push(wrangler(
    "d1", "execute", CONTROL_DATABASE, "--remote", "--yes", "--command",
    CONTROL_TABLES.map((table) => `DELETE FROM ${table}`).join(";"),
  ));
  return commands;
}

function validateBackups(backupDir) {
  for (const name of ["unicas-control.sql", "unicas-tenant.sql"]) {
    const path = `${backupDir}/${name}`;
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`required non-empty backup is missing: ${path}`);
    }
  }
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
  const stacks = query(CONTROL_DATABASE, "SELECT stack_id, display_name FROM cas_stacks ORDER BY stack_id");
  const managedIssuers = query(
    CONTROL_DATABASE,
    "SELECT stack_id, issuer, audience FROM cas_stack_managed_issuers ORDER BY stack_id",
  );
  const tenants = query(
    TENANT_DATABASE,
    "SELECT DISTINCT stack_id, tenant_id FROM cas_nodes ORDER BY stack_id, tenant_id",
  );
  const objectKeys = query(
    TENANT_DATABASE,
    "SELECT 'stacks/' || stack_id || '/tenants/' || tenant_id || '/nodes-v2/' || hash AS object_key FROM cas_nodes ORDER BY stack_id, tenant_id, hash",
  ).map((row) => row.object_key);
  const oauthKeys = JSON.parse(run(
    wrangler("kv", "key", "list", "--binding", OAUTH_BINDING, "--remote"),
    true,
  )).map((entry) => entry.name);
  return { stacks, managedIssuers, tenants, objectKeys, oauthKeys };
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
    if (options.execute) validateBackups(options.backupDir);
    const inventory = remoteInventory();
    validateResetInventory(inventory, options.expectedStackId);
    const commands = resetPlan(inventory);
    printPlan(commands);
    if (options.execute) {
      for (const command of commands) run(command);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { CONTROL_SCHEMA_MIGRATIONS } from "../../../../packages/service-cloudflare/src/control-schema.ts";
import { APP_SPACE_SCHEMA_MIGRATIONS } from "../../../../packages/service-cloudflare/src/schema.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const account = "92c3c4fdcc84a1590555bccf4f111de2";
const control = "3a64d58d-692c-4340-af22-c4b4f3e923f1";
const tenant = "c3924c96-0a9c-479c-b82d-4eb840642bfd";
const bucket = "unicas-content";
const kv = "105946859be94ca8b0563dd7b45099d0";
const appId = "cas_OLSr27XcijVX";
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const namespaces = ["dae90bbff3ba436a909c7a9193318168", "9407f336c2b94c84be12319c557d2bc7"];
const require = createRequire(join(root, "packages/service-cloudflare/package.json"));
const wrangler = require.resolve("wrangler");
const maintenanceSource = `const unavailable = () => new Response("UniCAS maintenance", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300", "X-UniCAS-Maintenance": "production-reset" } });
export default { fetch: unavailable };
export class CasDurableObject { fetch() { return unavailable(); } }
export class RootRefDomainDurableObject { fetch() { return unavailable(); } }
`;

async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(`Cloudflare operation failed: HTTP ${response.status}; codes ${payload.errors?.map(error => error.code).join(",") ?? "unknown"}`);
  }
  return payload;
}

async function query(database, sql, params = []) {
  const payload = await api(`/d1/database/${database}/query`, { sql, params });
  assert(payload.result.every(result => result.success !== false), "D1 statement failed");
  return payload.result.flatMap(result => result.results ?? []);
}

async function objects() {
  const entries = [];
  let after = "";
  while (true) {
    const page = await api(`/r2/buckets/${bucket}/objects?per_page=1000${after ? `&start_after=${encodeURIComponent(after)}` : ""}`);
    if (!page.result.length) return entries;
    entries.push(...page.result);
    const next = page.result.at(-1).key;
    assert(next && next !== after, "R2 pagination did not advance");
    after = next;
  }
}

async function kvKeys() {
  const entries = [];
  let cursor = "";
  do {
    const page = await api(`/storage/kv/namespaces/${kv}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    entries.push(...page.result);
    const next = page.result_info?.cursor ?? "";
    assert(!next || next !== cursor, "KV pagination did not advance");
    cursor = next;
  } while (cursor);
  return entries;
}

async function assertEmptyDurableStorage() {
  let total = 0;
  for (const namespace of namespaces) {
    let cursor = "";
    while (true) {
      const page = await api(`/workers/durable_objects/namespaces/${namespace}/objects?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!page.result.length) break;
      assert(page.result.every(object => object.hasStoredData === false), "Durable Object persistent data requires a separate reset procedure");
      total += page.result.length;
      const next = page.result_info?.cursor;
      assert(next && next !== cursor, "DO pagination did not advance");
      cursor = next;
    }
  }
  return total;
}

function schemaTables(migrations) {
  const db = new DatabaseSync(":memory:");
  try {
    for (const sql of migrations) db.exec(sql);
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  } finally {
    db.close();
  }
}

async function inventoryTables(database, migrations) {
  const allowed = new Set(schemaTables(migrations));
  const tables = await query(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
  assert(tables.every(table => allowed.has(table.name)), "Unexpected production table; review inventory before proceeding");
  return tables.map(table => table.name);
}

function seedStatements(principal, issuer) {
  const now = Date.now();
  const issuerColumns = ["app_id", "mode", "issuer", "audience", "metadata_url", "metadata_type", "authorization_endpoint", "token_endpoint", "jwks_uri", "registration_endpoint", "scopes_supported", "code_challenge_methods_supported", "status", "verified_at", "last_refresh_at", "last_refresh_error", "jwks_digest", "capability_max_lifetime_seconds", "revision"];
  const cleanIssuer = { ...issuer, verified_at: now, last_refresh_at: now, last_refresh_error: null, revision: 1 };
  return [
    { sql: "INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, 1, 1, ?, ?)", params: [`prn_${randomUUID()}`, principal.identity_issuer, principal.subject, now, now] },
    { sql: "INSERT INTO cas_platform_audit_events (event_id, actor_issuer, actor_subject, target_issuer, target_subject, action, result, created_at, details_json) VALUES (?, ?, ?, ?, ?, 'platform_access.authority_changed', 'succeeded', ?, ?)", params: [`evt_${randomUUID()}`, principal.identity_issuer, principal.subject, principal.identity_issuer, principal.subject, now, JSON.stringify({ source: "out-of-band-bootstrap", reset: "authorized-test-data-reset" })] },
    { sql: "INSERT INTO cas_apps (app_id, display_name, created_at) VALUES (?, 'Production Smoke', ?)", params: [appId, now] },
    { sql: "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at) VALUES (?, ?, ?, ?)", params: [appId, principal.identity_issuer, principal.subject, now] },
    { sql: `INSERT INTO cas_app_oauth_issuers (${issuerColumns.join(",")}) VALUES (${issuerColumns.map(() => "?").join(",")})`, params: issuerColumns.map(column => cleanIssuer[column] ?? null) },
    { sql: "INSERT INTO cas_control_meta (key, value) VALUES ('snapshot', 1)", params: [] },
  ];
}

function localTest() {
  const db = new DatabaseSync(":memory:");
  try {
    for (const sql of CONTROL_SCHEMA_MIGRATIONS) db.exec(sql);
    const sampleIssuer = { app_id: appId, mode: "external", issuer: "https://example.com", audience: "sample", metadata_url: "https://example.com/metadata", metadata_type: "oauth", authorization_endpoint: "https://example.com/authorize", token_endpoint: "https://example.com/token", jwks_uri: "https://example.com/jwks", scopes_supported: "[]", code_challenge_methods_supported: "[]", status: "active", jwks_digest: "sample", capability_max_lifetime_seconds: 3600 };
    for (const statement of seedStatements({ identity_issuer: "https://example.com", subject: "synthetic" }, sampleIssuer)) db.prepare(statement.sql).run(...statement.params);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cas_platform_principals WHERE platform_admin=1 AND apps_create=1").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cas_platform_audit_events").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cas_admin_sessions").get().count, 0);
    assert.equal(db.prepare("SELECT value FROM cas_control_meta WHERE key='snapshot'").get().value, 1);
    for (const table of schemaTables(CONTROL_SCHEMA_MIGRATIONS)) db.exec(`DROP TABLE ${table}`);
    for (const sql of CONTROL_SCHEMA_MIGRATIONS) db.exec(sql);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cas_apps").get().count, 0);
    assert.equal(schemaTables(APP_SPACE_SCHEMA_MIGRATIONS).length, 8);
    console.log("PASS: current schemas, parameterized bootstrap, audit, smoke fixture, empty sessions, drop/recreate");
  } finally {
    db.close();
  }
}

function publishMaintenance(dryRun) {
  const directory = mkdtempSync(join(tmpdir(), "unicas-reset-maintenance-"));
  try {
    const source = join(directory, "maintenance.mjs");
    writeFileSync(source, maintenanceSource, { mode: 0o600 });
    const result = spawnSync(process.execPath, [wrangler, "deploy", source, "--config", join(root, "packages/service-cloudflare/wrangler.toml"), ...(dryRun ? ["--dry-run"] : [])], {
      cwd: root, env: process.env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error("Maintenance bundle/deployment failed; raw output withheld");
    console.log(dryRun ? "PASS: maintenance Worker dry-run" : "Maintenance Worker deployed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const mode = process.argv[2] ?? "--check";
  assert(["--test", "--check", "--execute"].includes(mode) && process.argv.length <= 3, "Use --test, --check, or --execute");
  localTest();
  if (mode === "--test") return;
  assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare token is required");
  assert(/^[a-f0-9]{64}$/.test(process.env.UNICAS_BOOTSTRAP_FINGERPRINT ?? ""), "Verified browser identity fingerprint is required");
  const identities = await query(control, "SELECT identity_issuer, subject FROM cas_operator_identities");
  const matches = identities.filter(identity => createHash("sha256").update(JSON.stringify([identity.identity_issuer, identity.subject])).digest("hex") === process.env.UNICAS_BOOTSTRAP_FINGERPRINT);
  assert.equal(matches.length, 1, "Exactly one stored identity must match the verified browser session");
  assert.equal(matches[0].identity_issuer, "https://accounts.google.com", "Expected verified Google issuer");
  const issuers = await query(control, "SELECT * FROM cas_app_oauth_issuers WHERE app_id=?", [appId]);
  assert.equal(issuers.length, 1, "Expected smoke issuer configuration");
  const issuer = issuers[0];
  assert.equal(issuer.mode, "external");
  assert.equal(issuer.status, "active");
  assert.equal(issuer.issuer, "https://unicas.work/deploy-smoke");
  assert.equal(issuer.audience, `https://api.unicas.work/stacks/${appId}`);
  assert.equal(new URL(issuer.jwks_uri).origin, "https://unicas.work");
  const jwksResponse = await fetch(issuer.jwks_uri, { signal: AbortSignal.timeout(30000) });
  assert(jwksResponse.ok, "Smoke public keys unavailable");
  const jwks = await jwksResponse.json();
  assert(jwks.keys.some(key => key.kid === "github-actions-2026-09" && !key.d), "Expected public smoke key");
  const controlTables = await inventoryTables(control, CONTROL_SCHEMA_MIGRATIONS);
  const tenantTables = await inventoryTables(tenant, APP_SPACE_SCHEMA_MIGRATIONS);
  const blobs = await objects();
  const keys = await kvKeys();
  const durableCount = await assertEmptyDurableStorage();
  console.log(JSON.stringify({ matchedVerifiedAccount: true, controlTables: controlTables.length, tenantTables: tenantTables.length, r2Objects: blobs.length, r2Bytes: blobs.reduce((sum, object) => sum + object.size, 0), oauthKeys: keys.length, durableObjectsWithoutStoredData: durableCount }));
  assert.equal(controlTables.length, 13, "Control inventory changed since review");
  assert.equal(tenantTables.length, 8, "Tenant inventory changed since review");
  assert.equal(blobs.length, 4, "R2 inventory changed since review");
  assert.equal(blobs.reduce((sum, object) => sum + object.size, 0), 413, "R2 size changed since review");
  assert.equal(keys.length, 0, "OAuth inventory changed since review");
  publishMaintenance(true);
  if (mode === "--check") return;
  assert.equal(process.env.UNICAS_RESET_CONFIRM, "DELETE-ALL-TEST-DATA-NO-BACKUP", "Explicit backup waiver and deletion confirmation required");
  publishMaintenance(false);
  for (const origin of ["https://api.unicas.work", "https://console.unicas.work"]) {
    const response = await fetch(`${origin}/health?reset=${randomUUID()}`, { signal: AbortSignal.timeout(30000) });
    assert(response.status === 503 && response.headers.get("X-UniCAS-Maintenance") === "production-reset", "Maintenance is not active; no deletion attempted");
  }
  const freshBlobs = await objects();
  assert.deepEqual(freshBlobs.map(object => [object.key, object.etag, object.size]), blobs.map(object => [object.key, object.etag, object.size]), "R2 changed before maintenance");
  assert.equal((await kvKeys()).length, 0, "KV changed before maintenance");
  await assertEmptyDurableStorage();
  for (const object of freshBlobs) await api(`/r2/buckets/${bucket}/objects/${encodeURIComponent(object.key)}`, undefined, "DELETE");
  assert.equal((await objects()).length, 0, "R2 is not empty");
  for (const [database, tables, migrations] of [[tenant, tenantTables, APP_SPACE_SCHEMA_MIGRATIONS], [control, controlTables, CONTROL_SCHEMA_MIGRATIONS]]) {
    await query(database, tables.map(table => `DROP TABLE ${table}`).join(";"));
    await query(database, migrations.join(";"));
    const counts = await query(database, schemaTables(migrations).map(table => `SELECT COUNT(*) AS count FROM ${table}`).join(";"));
    assert(counts.every(row => row.count === 0), "Rebuilt database is not empty");
  }
  console.log("Verified: all application tables recreated empty, R2 empty, KV empty, no DO persistent data");
  for (const statement of seedStatements(matches[0], issuer)) await query(control, statement.sql, statement.params);
  const verification = await query(control, "SELECT (SELECT COUNT(*) FROM cas_platform_principals WHERE status='active' AND platform_admin=1 AND apps_create=1) AS active_admins, (SELECT COUNT(*) FROM cas_platform_audit_events) AS bootstrap_events, (SELECT COUNT(*) FROM cas_apps) AS smoke_apps, (SELECT COUNT(*) FROM cas_app_members) AS smoke_members, (SELECT COUNT(*) FROM cas_admin_sessions) AS sessions");
  assert.deepEqual(verification[0], { active_admins: 1, bootstrap_events: 1, smoke_apps: 1, smoke_members: 1, sessions: 0 });
  console.log(JSON.stringify({ resetVerified: true, bootstrapVerified: true, ...verification[0], maintenanceActive: true }));
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message.split("\n")[0] : error.message);
  process.exitCode = 1;
});
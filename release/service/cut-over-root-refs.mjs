import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { applyRootRefCutover, planRootRefCutover } from "./migrate-root-refs.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVICE = join(ROOT, "packages", "service-cloudflare");
const CONFIG = join(SERVICE, "wrangler.toml");
const LEGACY = [
  "cas_root_domain_events", "cas_root_domain_refs",
  "cas_root_domain_revisions", "cas_root_ref_requests",
];
const NEW = [
  "cas_app_root_revisions", "cas_app_root_refs", "cas_app_root_events",
  "cas_app_root_requests", "cas_app_root_cutover",
];
const OPERATIONS = ["INSERT", "UPDATE", "DELETE"];
const FENCE = "cas_root_domain_events_archive_insert";
const APPEND_ONLY = ["cas_app_root_events_no_update", "cas_app_root_events_no_delete"];
const SCHEMA = await readFile(join(SERVICE, "migrations", "app-space", "0002_app_root_refs.sql"), "utf8");
const BASELINE = await readFile(join(SERVICE, "migrations", "app-space", "0001_baseline.sql"), "utf8");
const GUARDS = LEGACY.flatMap(table => OPERATIONS.map(operation => ({
  table, operation, name: `${table}_archive_${operation.toLowerCase()}`,
})));
const STAGES = [
  "inspect", "bookmark", "fence", "archive", "export", "validate",
  "schema", "populate", "verify-before-marker", "marker", "verify-after-marker",
];

export class RootRefCutoverError extends Error {
  constructor(stage, recovery) {
    super(`Root Ref cutover stopped: ${stage}; ${recovery}`);
    this.name = "RootRefCutoverError";
    this.stage = stage;
    this.recovery = recovery;
  }
}

function requireCondition(condition) {
  if (!condition) throw new Error("cutover invariant failed");
}

function guardSql(guard, owner = "") {
  return `CREATE TRIGGER ${guard.name} BEFORE ${guard.operation} ON ${guard.table}
    BEGIN ${owner ? `SELECT 'root-ref-cutover-owner:${owner}';` : ""}
    SELECT RAISE(ABORT, 'legacy Root Ref archive is read-only'); END;`;
}

function normalized(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\bSELECT\s+'root-ref-cutover-owner:[a-f0-9]{32}'\s*;/g, "")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
    .replace(/[\s;"`[\]]/g, "").toLowerCase();
}

function schemaObjects(db) {
  return db.prepare("SELECT name, type, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL").all()
    .filter(row => row.type === "table" ? ["cas_nodes", ...LEGACY, ...NEW].includes(row.name)
      : row.type === "trigger" && [...LEGACY, "cas_app_root_events"].includes(row.tbl_name));
}

const expected = new DatabaseSync(":memory:");
expected.exec(BASELINE);
expected.exec(SCHEMA);
const EXPECTED_TABLES = new Map(schemaObjects(expected).filter(row => row.type === "table")
  .map(row => [row.name, normalized(row.sql)]));
const EXPECTED_APPEND_ONLY = new Map(schemaObjects(expected).filter(row => APPEND_ONLY.includes(row.name))
  .map(row => [row.name, normalized(row.sql)]));
expected.close();

const INSPECT_SQL = `SELECT name, type, sql FROM sqlite_master
  WHERE (type = 'table' AND name IN ('cas_nodes',${[...LEGACY, ...NEW].map(name => `'${name}'`).join(",")}))
     OR (type = 'trigger' AND tbl_name IN (${[...LEGACY, "cas_app_root_events"].map(name => `'${name}'`).join(",")}))
  ORDER BY name`;

function validateSchema(rows) {
  const objects = new Map(rows.map(row => [row.name, row]));
  for (const table of LEGACY) {
    requireCondition(objects.get(table)?.type === "table"
      && normalized(objects.get(table).sql) === EXPECTED_TABLES.get(table));
  }
  const nodes = objects.get("cas_nodes");
  requireCondition(nodes?.type === "table" && /^\s*CREATE TABLE\b/i.test(nodes.sql)
    && normalized(nodes.sql).includes("check(root_ref_count>=0)"));
  const local = new DatabaseSync(":memory:");
  try {
    local.exec(nodes.sql);
    const columns = local.prepare("PRAGMA table_info(cas_nodes)").all();
    requireCondition(columns.filter(row => row.pk).sort((a, b) => a.pk - b.pk)
      .map(row => row.name).join(",") === "app_id,space_id,hash");
    requireCondition(columns.some(row => row.name === "root_ref_count"
      && row.type.toUpperCase() === "INTEGER" && row.notnull === 1));
  } finally { local.close(); }
  for (const table of NEW) {
    if (objects.has(table)) {
      requireCondition(objects.get(table).type === "table"
        && normalized(objects.get(table).sql) === EXPECTED_TABLES.get(table));
    }
  }
  for (const trigger of rows.filter(row => row.type === "trigger")) {
    const guard = GUARDS.find(candidate => candidate.name === trigger.name);
    if (guard) requireCondition(normalized(trigger.sql) === normalized(guardSql(guard)));
    else requireCondition(EXPECTED_APPEND_ONLY.get(trigger.name) === normalized(trigger.sql));
  }
  return objects;
}

function countersSql(objects) {
  return [...LEGACY, ...NEW].map(table => objects.has(table)
    ? `SELECT '${table}' AS name, COUNT(*) AS n FROM ${table}`
    : `SELECT '${table}' AS name, 0 AS n`).join(" UNION ALL ");
}

function countsOf(rows) {
  const counts = new Map();
  for (const row of rows) {
    requireCondition(typeof row.name === "string" && Number.isSafeInteger(row.n) && row.n >= 0);
    counts.set(row.name, row.n);
  }
  for (const name of [...LEGACY, ...NEW]) requireCondition(counts.has(name));
  return counts;
}

const OLD_REQUESTS = `SELECT app_id,space_id,request_id,payload_hash,revision,applied_at
  FROM cas_root_ref_requests`;
const APP_REQUESTS = `SELECT app_id,space_id,request_id,payload_hash,revision,applied_at
  FROM cas_app_root_requests`;
const ROOTS = "SELECT app_id,space_id,hash,root_ref_count AS ref_count FROM cas_nodes WHERE root_ref_count > 0";
const REFS = "SELECT app_id,space_id,hash,ref_count FROM cas_app_root_refs";
const LEGACY_ROOTS = `SELECT app_id,space_id,hash,SUM(ref_count) AS ref_count
  FROM cas_root_domain_refs GROUP BY app_id,space_id,hash HAVING SUM(ref_count) <> 0`;
const CHECKPOINTS = "SELECT app_id,MAX(revision) AS checkpoint FROM cas_root_domain_revisions GROUP BY app_id";

function difference(left, right) {
  return `SELECT COUNT(*) AS n FROM (SELECT * FROM (${left}) EXCEPT SELECT * FROM (${right}))`;
}

function verificationSql({ partial = false, live = false, objects } = {}) {
  const checks = [];
  if (!partial || objects.has("cas_app_root_refs")) {
    checks.push(difference(REFS, ROOTS));
    if (!partial) checks.push(difference(ROOTS, REFS));
  }
  if (!partial && !live) {
    checks.push(difference(ROOTS, LEGACY_ROOTS), difference(LEGACY_ROOTS, ROOTS));
  }
  if (!partial || objects.has("cas_app_root_requests")) {
    if (!partial) checks.push(difference(OLD_REQUESTS, APP_REQUESTS));
    checks.push(difference(APP_REQUESTS, live
      ? `${OLD_REQUESTS} UNION SELECT app_id,space_id,request_id,payload_hash,revision,applied_at FROM cas_app_root_events`
      : OLD_REQUESTS));
    if (live) checks.push(difference(
      "SELECT app_id,space_id,request_id,payload_hash,revision,applied_at FROM cas_app_root_events", APP_REQUESTS,
    ));
  }
  if (!partial || objects.has("cas_app_root_revisions")) {
    checks.push(`SELECT COUNT(*) AS n FROM cas_app_root_revisions AS r
      LEFT JOIN (${CHECKPOINTS}) AS c ON c.app_id=r.app_id
      WHERE ${live ? "" : "c.app_id IS NULL OR"} r.checkpoint <> COALESCE(c.checkpoint,0)
         OR r.revision ${live ? "<" : "<>"} r.checkpoint`);
    if (!partial) checks.push(`SELECT COUNT(*) AS n FROM (${CHECKPOINTS}) AS c
      LEFT JOIN cas_app_root_revisions AS r ON r.app_id=c.app_id WHERE r.app_id IS NULL`);
  }
  if (live) {
    checks.push(`SELECT COUNT(*) AS n FROM cas_app_root_events AS e
      LEFT JOIN cas_app_root_revisions AS r ON r.app_id=e.app_id
      WHERE r.app_id IS NULL OR e.revision <= r.checkpoint OR e.revision > r.revision`);
    checks.push(`SELECT COUNT(*) AS n FROM cas_app_root_revisions AS r
      WHERE r.revision <> COALESCE((SELECT MAX(e.revision) FROM cas_app_root_events AS e
        WHERE e.app_id=r.app_id),r.checkpoint)`);
    checks.push(`SELECT COUNT(*) AS n FROM cas_app_root_revisions AS r
      WHERE r.revision-r.checkpoint <> (SELECT COUNT(*) FROM cas_app_root_events AS e WHERE e.app_id=r.app_id)`);
  }
  return checks.length === 0 ? "SELECT 0 AS check_id,0 AS n"
    : checks.map((sql, index) => `SELECT ${index} AS check_id,n FROM (${sql})`).join(" UNION ALL ");
}

function assertVerified(rows) {
  requireCondition(rows.length > 0 && rows.every(row => row.n === 0));
}

/** Fixed binding/config only. Child output, URLs and provider errors never reach the terminal. */
async function executeWrangler({ args, directory }) {
  requireCondition(process.env.GITHUB_ACTIONS === "true"
    && /^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? "")
    && typeof process.env.CLOUDFLARE_API_TOKEN === "string" && process.env.CLOUDFLARE_API_TOKEN.length > 0);
  const require = createRequire(join(SERVICE, "package.json"));
  const manifestPath = require.resolve("wrangler/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const bin = resolve(dirname(manifestPath), manifest.bin.wrangler);
  const result = spawnSync(process.execPath, [bin, ...args, "--config", CONFIG], {
    cwd: SERVICE,
    shell: false,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
      WRANGLER_LOG: "error",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  requireCondition(result.status === 0 && !result.error);
  return result.stdout;
}

export function parseCutoverArgs(args) {
  requireCondition(args.length === 0 || (args.length === 1 && args[0] === "--production"));
  return { production: args.length === 1 };
}

export async function runRootRefProductionCutover({
  production = false,
  executor = executeWrangler,
  emit = value => console.log(JSON.stringify(value)),
} = {}) {
  if (!production) {
    emit({ mode: "plan-only", stages: STAGES });
    return { status: "plan-only" };
  }
  let directory;
  let stage = "inspect";
  let owner;
  let startedEmpty = false;
  let markerAttempted = false;
  let published = false;
  let source;
  let candidate;
  const previousUmask = process.umask(0o077);
  const send = async (args, label = stage) => executor({ args, stage: label, directory });
  const query = async (sql, label = stage) => {
    const text = await send(["d1", "execute", "CAS_DB", "--remote", "--json", "--command", sql], label);
    const batches = JSON.parse(text);
    requireCondition(Array.isArray(batches) && batches.length > 0
      && batches.every(batch => batch.success === true && Array.isArray(batch.results)));
    return batches.flatMap(batch => batch.results);
  };
  const execute = async (sql, label = stage) => {
    const file = join(directory, "operation.sql");
    await writeFile(file, sql, { mode: 0o600 });
    await chmod(file, 0o600);
    await send(["d1", "execute", "CAS_DB", "--remote", "--yes", "--file", file], label);
  };
  const inspect = async label => validateSchema(await query(INSPECT_SQL, label));
  const counters = async (objects, label) => countsOf(await query(countersSql(objects), label));
  const verifyGuards = objects => {
    requireCondition(GUARDS.every(guard => objects.has(guard.name))
      && APPEND_ONLY.every(name => objects.has(name)));
  };
  const ownGuard = object => object?.sql?.replace(/\/\*[\s\S]*?\*\//g, "")
    .match(/\bSELECT\s+'root-ref-cutover-owner:([a-f0-9]{32})'\s*;/)?.[1] === owner;
  const recover = async () => {
    let objects = await inspect("recovery-inspect");
    const counts = await counters(objects, "recovery-inspect");
    if ((counts.get("cas_app_root_cutover") ?? 0) > 0 || counts.get("cas_app_root_events") > 0) {
      return "forward-fix-required";
    }
    if (!objects.has(FENCE) && GUARDS.every(guard => !objects.has(guard.name))
      && NEW.every(table => counts.get(table) === 0)) return "no-remote-mutation";
    if (!startedEmpty || !ownGuard(objects.get(FENCE))) return "fence-preserved-manual-recovery";
    requireCondition(GUARDS.every(guard => !objects.has(guard.name) || ownGuard(objects.get(guard.name))));
    assertVerified(await query(verificationSql({ partial: true, objects }), "recovery-verify"));
    await execute(["cas_app_root_refs", "cas_app_root_requests", "cas_app_root_revisions"]
      .filter(table => objects.has(table)).map(table => `DELETE FROM ${table};`).join("\n") || "SELECT 1;", "recovery-clear");
    objects = await inspect("recovery-inspect");
    const cleared = await counters(objects, "recovery-inspect");
    requireCondition(NEW.every(table => cleared.get(table) === 0) && ownGuard(objects.get(FENCE)));
    const otherGuards = GUARDS.filter(guard => guard.name !== FENCE && ownGuard(objects.get(guard.name)));
    if (otherGuards.length) await execute(otherGuards.map(guard => `DROP TRIGGER ${guard.name};`).join("\n"), "recovery-unfreeze-archive");
    // The writer fence is always the last protection removed.
    await execute(`DROP TRIGGER ${FENCE};`, "recovery-unfence");
    objects = await inspect("recovery-inspect");
    requireCondition(GUARDS.every(guard => !objects.has(guard.name)));
    const restored = await counters(objects, "recovery-inspect");
    requireCondition(NEW.every(table => restored.get(table) === 0));
    return "old-writer-restored";
  };
  try {
    await mkdir(join(ROOT, ".wrangler"), { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(ROOT, ".wrangler", "root-ref-cutover-ci-"));
    await chmod(directory, 0o700);
    await writeFile(join(directory, "wrangler.log"), "", { mode: 0o600 });
    const objects = await inspect(stage);
    const initial = await counters(objects);
    if (initial.get("cas_app_root_cutover") > 0) {
      published = true;
      stage = "already-cutover";
      requireCondition(initial.get("cas_app_root_cutover") === 1 && NEW.every(table => objects.has(table)));
      verifyGuards(objects);
      const marker = await query("SELECT singleton,source_digest,applied_at FROM cas_app_root_cutover", "already-cutover");
      requireCondition(marker.length === 1 && marker[0].singleton === 1
        && /^[a-f0-9]{64}$/.test(marker[0].source_digest)
        && Number.isSafeInteger(marker[0].applied_at) && marker[0].applied_at >= 0);
      assertVerified(await query(verificationSql({ live: true }), "already-cutover"));
      emit({ status: "already-cutover" });
      return { status: "already-cutover" };
    }
    requireCondition(NEW.every(table => initial.get(table) === 0)
      && GUARDS.every(guard => !objects.has(guard.name)));
    startedEmpty = true;
    stage = "bookmark";
    const bookmark = JSON.parse(await send(["d1", "time-travel", "info", "CAS_DB", "--json"]));
    requireCondition(typeof bookmark.bookmark === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(bookmark.bookmark));
    emit({ stage, bookmark: bookmark.bookmark });
    stage = "fence";
    owner = randomUUID().replaceAll("-", "");
    await execute(guardSql(GUARDS.find(guard => guard.name === FENCE), owner));
    requireCondition(ownGuard((await inspect(stage)).get(FENCE)));
    stage = "archive";
    await execute(GUARDS.filter(guard => guard.name !== FENCE).map(guard => guardSql(guard, owner)).join("\n"));
    const frozen = await inspect(stage);
    requireCondition(GUARDS.every(guard => ownGuard(frozen.get(guard.name))));
    requireCondition(NEW.every(table => initial.get(table) === 0));
    stage = "export";
    const sqlPath = join(directory, "snapshot.sql");
    const sqlitePath = join(directory, "snapshot.sqlite");
    const candidatePath = join(directory, "candidate.sqlite");
    for (const file of [sqlPath, sqlitePath, candidatePath]) {
      await writeFile(file, "", { mode: 0o600 });
      await chmod(file, 0o600);
    }
    await send(["d1", "export", "CAS_DB", "--remote", "--skip-confirmation", "--output", sqlPath]);
    await chmod(sqlPath, 0o600);
    source = new DatabaseSync(sqlitePath);
    source.exec(await readFile(sqlPath, "utf8"));
    stage = "validate";
    const snapshotObjects = validateSchema(schemaObjects(source));
    const stillFrozen = await inspect(stage);
    requireCondition(GUARDS.every(guard => ownGuard(stillFrozen.get(guard.name))));
    for (const table of NEW) {
      if (snapshotObjects.has(table)) {
        requireCondition(source.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0);
      }
    }
    const plan = planRootRefCutover(source);
    requireCondition(/^[a-f0-9]{64}$/.test(plan.sourceDigest));
    await backup(source, candidatePath);
    candidate = new DatabaseSync(candidatePath);
    for (const guard of GUARDS) {
      if (snapshotObjects.has(guard.name)) candidate.exec(`DROP TRIGGER ${guard.name}`);
    }
    applyRootRefCutover(candidate, plan.sourceDigest);
    validateSchema(schemaObjects(candidate));
    const localChecks = candidate.prepare(verificationSql()).all();
    assertVerified(localChecks);
    requireCondition(candidate.prepare("SELECT COUNT(*) AS n FROM cas_app_root_events").get().n === 0);
    emit({ stage, ...plan.summary, sourceDigest: plan.sourceDigest });
    stage = "schema";
    await execute(SCHEMA);
    const ready = await inspect(stage);
    requireCondition(NEW.every(table => ready.has(table)));
    verifyGuards(ready);
    requireCondition(NEW.every(table => initial.get(table) === 0));
    const beforePopulate = await counters(ready);
    requireCondition(NEW.every(table => beforePopulate.get(table) === 0));
    stage = "populate";
    await execute(`INSERT INTO cas_app_root_revisions (app_id,revision,checkpoint)
      SELECT app_id,MAX(revision),MAX(revision) FROM cas_root_domain_revisions GROUP BY app_id;
      INSERT INTO cas_app_root_refs (app_id,space_id,hash,ref_count)
      SELECT app_id,space_id,hash,root_ref_count FROM cas_nodes WHERE root_ref_count > 0;
      INSERT INTO cas_app_root_requests (app_id,space_id,request_id,payload_hash,revision,applied_at)
      ${OLD_REQUESTS};`);
    stage = "verify-before-marker";
    verifyGuards(await inspect(stage));
    assertVerified(await query(verificationSql()));
    const populated = await counters(await inspect(stage));
    requireCondition(populated.get("cas_app_root_events") === 0 && populated.get("cas_app_root_cutover") === 0
      && populated.get("cas_app_root_requests") === plan.summary.replayRecords
      && populated.get("cas_root_domain_events") === plan.summary.legacyEvents);
    stage = "marker";
    markerAttempted = true;
    await execute(`INSERT INTO cas_app_root_cutover (singleton,source_digest,applied_at)
      VALUES (1,'${plan.sourceDigest}',CAST(strftime('%s','now') AS INTEGER)*1000);`);
    stage = "verify-after-marker";
    verifyGuards(await inspect(stage));
    assertVerified(await query(verificationSql()));
    const finalCounts = await counters(await inspect(stage));
    requireCondition(finalCounts.get("cas_app_root_events") === 0 && finalCounts.get("cas_app_root_cutover") === 1);
    const marker = await query("SELECT singleton,source_digest FROM cas_app_root_cutover");
    requireCondition(marker.length === 1 && marker[0].singleton === 1 && marker[0].source_digest === plan.sourceDigest);
    emit({ status: "cutover-complete", ...plan.summary, sourceDigest: plan.sourceDigest });
    return { status: "cutover-complete" };
  } catch {
    let recovery = published ? "forward-fix-required" : "no-remote-mutation";
    if (owner) {
      try { recovery = await recover(); } catch { recovery = markerAttempted ? "forward-fix-required" : "fence-preserved-manual-recovery"; }
    }
    emit({ status: "stopped", stage, recovery });
    throw new RootRefCutoverError(stage, recovery);
  } finally {
    let cleanupFailed = false;
    for (const db of [source, candidate]) {
      try { db?.close(); } catch { cleanupFailed = true; }
    }
    try { if (directory) await rm(directory, { recursive: true, force: true }); } catch { cleanupFailed = true; }
    process.umask(previousUmask);
    if (cleanupFailed) {
      emit({ status: "stopped", stage: "cleanup", recovery: "private-files-cleanup-required" });
      throw new RootRefCutoverError("cleanup", "private-files-cleanup-required");
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runRootRefProductionCutover(parseCutoverArgs(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof RootRefCutoverError)) {
      console.error(JSON.stringify({ status: "stopped", stage: "arguments", recovery: "no-remote-mutation" }));
    }
    process.exitCode = 1;
  }
}

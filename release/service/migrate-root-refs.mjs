import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const tables = [
  "cas_nodes", "cas_root_domain_refs", "cas_root_domain_events",
  "cas_root_domain_revisions", "cas_root_ref_requests",
];
const legacyTables = tables.slice(1);
const schema = readFileSync(new URL("../../packages/service-cloudflare/migrations/app-space/0002_app_root_refs.sql", import.meta.url), "utf8");

class MigrationValidationError extends Error {}
function invariant(condition, message) {
  if (!condition) throw new MigrationValidationError(message);
}
function key(...parts) { return JSON.stringify(parts); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }

/** Reads only. Never repairs aggregate state, folds request collisions, or orders old streams. */
export function planRootRefCutover(db) {
  const rows = Object.fromEntries(tables.map(table => [
    table, db.prepare(`SELECT * FROM ${table}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]));
  const aggregate = new Map();
  for (const n of rows.cas_nodes) {
    invariant(integer(n.root_ref_count), "invalid authoritative aggregate");
    aggregate.set(key(n.app_id, n.space_id, n.hash), n.root_ref_count);
  }
  const sums = new Map();
  for (const r of rows.cas_root_domain_refs) {
    const k = key(r.app_id, r.space_id, r.hash);
    invariant(aggregate.has(k), "orphan legacy projection");
    invariant(Number.isSafeInteger(r.ref_count), "invalid legacy projection");
    const total = (sums.get(k) ?? 0) + r.ref_count;
    invariant(Number.isSafeInteger(total), "legacy projection overflow");
    sums.set(k, total);
  }
  for (const [k, count] of aggregate) {
    invariant((sums.get(k) ?? 0) === count, "legacy projection drift; cutover refused");
  }
  const revisions = new Map();
  const checkpoints = new Map();
  for (const r of rows.cas_root_domain_revisions) {
    invariant(integer(r.revision), "invalid legacy revision");
    revisions.set(key(r.app_id, r.ref_domain), r.revision);
    checkpoints.set(r.app_id, Math.max(checkpoints.get(r.app_id) ?? 0, r.revision));
  }
  for (const r of rows.cas_root_domain_refs) {
    invariant(revisions.has(key(r.app_id, r.ref_domain)), "legacy projection without revision stream");
  }
  const events = new Map();
  for (const e of rows.cas_root_domain_events) {
    invariant(integer(e.revision) && e.revision > 0
      && e.revision <= (revisions.get(key(e.app_id, e.ref_domain)) ?? -1), "legacy event outside revision stream");
    const changes = JSON.parse(e.changes_json);
    invariant(typeof changes === "object" && changes !== null && !Array.isArray(changes), "invalid legacy changes");
    const entries = Object.entries(changes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    invariant(entries.length > 0 && entries.every(([h, d]) => /^[0-9a-f]{64}$/.test(h)
      && Number.isSafeInteger(d) && d !== 0), "invalid legacy delta");
    invariant(hash(JSON.stringify(Object.fromEntries(entries))) === e.payload_hash, "legacy payload hash mismatch");
    const k = key(e.app_id, e.space_id, e.request_id);
    invariant(!events.has(k), "legacy requestId collision; explicit disposition required");
    events.set(k, e);
  }
  const requests = new Map();
  for (const r of rows.cas_root_ref_requests) {
    const k = key(r.app_id, r.space_id, r.request_id);
    invariant(!requests.has(k), "legacy requestId collision; explicit disposition required");
    const e = events.get(k);
    invariant(e && e.ref_domain === r.ref_domain && e.payload_hash === r.payload_hash
      && e.revision === r.revision && e.applied_at === r.applied_at, "legacy request/event mismatch");
    requests.set(k, r);
  }
  invariant(requests.size === events.size, "legacy event missing replay record");
  // Every recorded revision must have an event; no inferred or fabricated history.
  for (const r of rows.cas_root_domain_revisions) {
    const stream = rows.cas_root_domain_events
      .filter(e => e.app_id === r.app_id && e.ref_domain === r.ref_domain)
      .sort((a, b) => a.revision - b.revision);
    invariant(stream.length === r.revision && stream.every((e, index) => e.revision === index + 1),
      "incomplete legacy stream; retain source and investigate");
  }
  return {
    sourceDigest: hash(JSON.stringify(rows)),
    aggregate, checkpoints, requests,
    summary: { apps: checkpoints.size, nodes: aggregate.size, legacyEvents: events.size, replayRecords: requests.size },
  };
}

/** Only for an isolated local copy. The input archive is never opened writable. */
export function applyRootRefCutover(db, expectedDigest, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const plan = planRootRefCutover(db);
    invariant(plan.sourceDigest === expectedDigest, "source changed since plan");
    db.exec(schema);
    invariant(!db.prepare("SELECT 1 FROM cas_app_root_cutover").get(), "cutover already applied");
    for (const table of ["cas_app_root_revisions", "cas_app_root_refs", "cas_app_root_events", "cas_app_root_requests"]) {
      invariant(!db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(), "new Root Ref state is not empty");
    }
    for (const [appId, checkpoint] of plan.checkpoints) {
      db.prepare("INSERT INTO cas_app_root_revisions (app_id, revision, checkpoint) VALUES (?, ?, ?)")
        .run(appId, checkpoint, checkpoint);
    }
    for (const [k, count] of plan.aggregate) {
      if (count === 0) continue;
      const [appId, spaceId, nodeHash] = JSON.parse(k);
      db.prepare("INSERT INTO cas_app_root_refs (app_id, space_id, hash, ref_count) VALUES (?, ?, ?, ?)")
        .run(appId, spaceId, nodeHash, count);
    }
    for (const r of plan.requests.values()) {
      db.prepare(`INSERT INTO cas_app_root_requests
        (app_id, space_id, request_id, payload_hash, revision, applied_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(r.app_id, r.space_id, r.request_id, r.payload_hash, r.revision, r.applied_at);
    }
    for (const table of legacyTables) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
        db.exec(`CREATE TRIGGER ${table}_archive_${operation.toLowerCase()} BEFORE ${operation}
          ON ${table} BEGIN SELECT RAISE(ABORT, 'legacy Root Ref archive is read-only'); END`);
      }
    }
    db.prepare("INSERT INTO cas_app_root_cutover VALUES (1, ?, ?)").run(plan.sourceDigest, now);
    invariant(planRootRefCutover(db).sourceDigest === plan.sourceDigest, "aggregate/archive changed during cutover");
    db.exec("COMMIT");
    return { ...plan.summary, sourceDigest: plan.sourceDigest };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function localPath(value) {
  const path = resolve(value);
  const rel = relative(process.cwd(), path);
  invariant(rel !== "" && !rel.startsWith("..") && !isAbsolute(rel), "paths must be inside the current project");
  return path;
}

function requireEmptyTarget(db) {
  for (const table of [
    "cas_app_root_revisions", "cas_app_root_refs", "cas_app_root_events",
    "cas_app_root_requests", "cas_app_root_cutover",
  ]) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
      invariant(!db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(), "new Root Ref state is not empty; cutover refused");
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, output: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  }, strict: true });
  invariant(values.input, "usage: node release\\service\\migrate-root-refs.mjs --input <offline.sqlite> [--dry-run | --output <new.sqlite>]");
  invariant(values["dry-run"] !== Boolean(values.output), "choose exactly one of --dry-run or --output");
  const input = localPath(values.input);
  const source = new DatabaseSync(input, { readOnly: true });
  try {
    requireEmptyTarget(source);
    const plan = planRootRefCutover(source);
    if (values["dry-run"]) {
      console.log(JSON.stringify({ mode: "dry-run", ...plan.summary, sourceDigest: plan.sourceDigest }));
      return;
    }
    const output = localPath(values.output);
    invariant(!existsSync(output), "output already exists; refusing overwrite");
    await backup(source, output);
    const target = new DatabaseSync(output);
    try {
      console.log(JSON.stringify({ mode: "local-copy", ...applyRootRefCutover(target, plan.sourceDigest) }));
    } finally { target.close(); }
  } finally { source.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Never print identifiers, SQL, payloads, or raw provider errors.
    console.error(error instanceof MigrationValidationError
      ? `Root Ref migration refused: ${error.message}`
      : "Root Ref migration refused: offline SQLite IO or schema failure.");
    process.exitCode = 1;
  });
}

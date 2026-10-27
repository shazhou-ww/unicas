import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import {
  parseCutoverArgs, RootRefCutoverError, runRootRefProductionCutover,
} from "../release/service/cut-over-root-refs.mjs";

const BASELINE = readFileSync(join("packages", "service-cloudflare", "migrations", "app-space", "0001_baseline.sql"), "utf8");
const SCHEMA = readFileSync(join("packages", "service-cloudflare", "migrations", "app-space", "0002_app_root_refs.sql"), "utf8");
const HASH = "a".repeat(64);
const CHANGES = JSON.stringify({ [HASH]: 2 });
const PAYLOAD = createHash("sha256").update(CHANGES).digest("hex");
const STORES = [];
afterEach(() => { for (const db of STORES.splice(0)) db.close(); });

function fixture() {
  const db = new DatabaseSync(":memory:");
  STORES.push(db);
  db.exec(BASELINE);
  db.prepare(`INSERT INTO cas_nodes
    (app_id,space_id,hash,content_size,content_type,root_ref_count)
    VALUES ('synthetic-app','/one',?,2,'text/plain',2)`).run(HASH);
  db.prepare("INSERT INTO cas_root_domain_refs VALUES ('synthetic-app','old','/one',?,2)").run(HASH);
  db.exec("INSERT INTO cas_root_domain_revisions VALUES ('synthetic-app','old',1)");
  db.prepare("INSERT INTO cas_root_domain_events VALUES ('synthetic-app','old',1,'/one','private-request',?,?,100)")
    .run(PAYLOAD, CHANGES);
  db.prepare("INSERT INTO cas_root_ref_requests VALUES ('synthetic-app','/one','old','private-request',?,1,100)").run(PAYLOAD);
  return db;
}

function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dump(db, { omitGuards = false } = {}) {
  const objects = db.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
  const tables = objects.filter(row => row.type === "table");
  return [
    ...tables.map(row => `${row.sql};`),
    ...tables.flatMap(table => db.prepare(`SELECT * FROM ${table.name}`).all().map(row => (
      `INSERT INTO ${table.name} VALUES (${Object.values(row).map(literal).join(",")});`
    ))),
    ...objects.filter(row => row.type === "trigger" && !(omitGuards && row.name.includes("_archive_")))
      .map(row => `${row.sql};`),
  ].join("\n");
}

function fake(db, { before, after, omitGuards } = {}) {
  const calls = [], output = [], paths = [], sqls = [];
  const executor = async request => {
    calls.push(request);
    if (request.directory) paths.push(request.directory);
    if (request.directory && process.platform !== "win32") {
      for (const name of readdirSync(request.directory)) {
        expect(statSync(join(request.directory, name)).mode & 0o777).toBe(0o600);
      }
    }
    await before?.(request, db);
    let response;
    if (request.args[1] === "time-travel") {
      response = JSON.stringify({ bookmark: "00000001-00000001-00000001" });
    } else if (request.args[1] === "export") {
      const path = request.args[request.args.indexOf("--output") + 1];
      if (process.platform !== "win32") {
        expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
      await writeFile(path, dump(db, { omitGuards }));
      response = "Private export at https://private.example/download?signature=do-not-log";
    } else if (request.args.includes("--command")) {
      const sql = request.args[request.args.indexOf("--command") + 1];
      const rows = db.prepare(sql).all();
      response = JSON.stringify([{ success: true, results: rows }]);
    } else {
      const path = request.args[request.args.indexOf("--file") + 1];
      const sql = await readFile(path, "utf8");
      sqls.push({ stage: request.stage, sql });
      expect(sql).not.toMatch(/^\s*(?:BEGIN(?:\s+(?:IMMEDIATE|TRANSACTION))?|COMMIT|ROLLBACK)\s*;/m);
      expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM)\s+cas_nodes/i);
      expect(sql).not.toMatch(/(?:DROP TABLE|time-travel restore)/i);
      db.exec(sql);
      response = "Result: private SQL or identifiers must never be logged";
    }
    await after?.(request, db);
    return response;
  };
  return {
    calls, output, paths, sqls, executor,
    run: () => runRootRefProductionCutover({ production: true, executor, emit: value => output.push(value) }),
  };
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
function guards(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_archive_%'").all();
}
function newRows(db) {
  return ["cas_app_root_revisions", "cas_app_root_refs", "cas_app_root_events", "cas_app_root_requests", "cas_app_root_cutover"]
    .filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))
    .map(table => count(db, table)).reduce((a, b) => a + b, 0);
}
function assertPrivateCleanupAndLogs(run) {
  for (const path of run.paths) expect(existsSync(path)).toBe(false);
  const text = JSON.stringify(run.output);
  for (const secret of [HASH, "private-request", "synthetic-app", "signature", "do-not-log", "Bearer", "SELECT", "INSERT", "https://"]) {
    expect(text).not.toContain(secret);
  }
}

describe("protected Root Ref cutover runner", () => {
  test("defaults to plan-only and accepts no database, account, URL or unapproved mode", async () => {
    const calls = [];
    expect(parseCutoverArgs([])).toEqual({ production: false });
    expect(parseCutoverArgs(["--production"])).toEqual({ production: true });
    for (const args of [["--database", "other"], ["--account", "other"], ["--url", "https://x"], ["--env", "dev"], ["--production", "--production"]]) {
      expect(() => parseCutoverArgs(args)).toThrow();
    }
    await expect(runRootRefProductionCutover({ executor: () => { throw new Error("must not execute"); }, emit: row => calls.push(row) }))
      .resolves.toEqual({ status: "plan-only" });
    expect(calls[0].mode).toBe("plan-only");
    const local = spawnSync(process.execPath, [join("release", "service", "cut-over-root-refs.mjs"), "--production"], {
      encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "false" },
    });
    expect(local.status).toBe(1);
    expect(local.stdout).toContain("no-remote-mutation");
    expect(local.stderr).not.toContain("CLOUDFLARE_API_TOKEN");
  });

  test.each([false, true])("orders backup/fence/export/validation/marker, preserving roots and archive (export omits guards=%s)", async omitGuards => {
    const db = fixture();
    const before = db.prepare("SELECT * FROM cas_nodes").all();
    const run = fake(db, { omitGuards });
    await expect(run.run()).resolves.toEqual({ status: "cutover-complete" });
    const phases = run.calls.map(call => call.stage);
    for (const [first, second] of [
      ["inspect", "bookmark"], ["bookmark", "fence"], ["fence", "archive"],
      ["archive", "export"], ["export", "validate"], ["validate", "schema"],
      ["schema", "populate"], ["populate", "verify-before-marker"],
      ["verify-before-marker", "marker"], ["marker", "verify-after-marker"],
    ]) expect(phases.indexOf(first)).toBeLessThan(phases.indexOf(second));
    expect(db.prepare("SELECT * FROM cas_nodes").all()).toEqual(before);
    expect(db.prepare("SELECT revision,checkpoint FROM cas_app_root_revisions").get()).toEqual({ revision: 1, checkpoint: 1 });
    expect(db.prepare("SELECT ref_count FROM cas_app_root_refs").get().ref_count).toBe(2);
    expect(db.prepare("SELECT revision,payload_hash FROM cas_app_root_requests").get()).toEqual({ revision: 1, payload_hash: PAYLOAD });
    expect(count(db, "cas_app_root_events")).toBe(0);
    expect(count(db, "cas_app_root_cutover")).toBe(1);
    expect(guards(db)).toHaveLength(12);
    expect(() => db.exec("DELETE FROM cas_root_ref_requests")).toThrow("read-only");
    db.exec("SAVEPOINT guard_test");
    db.prepare("INSERT INTO cas_app_root_events VALUES ('synthetic-app',2,'/one','guard-probe',?,?,200)").run(PAYLOAD, CHANGES);
    expect(() => db.exec("UPDATE cas_app_root_events SET revision=9")).toThrow("append-only");
    expect(() => db.exec("DELETE FROM cas_app_root_events")).toThrow("append-only");
    db.exec("ROLLBACK TO guard_test; RELEASE guard_test");
    expect(run.sqls.filter(row => row.stage === "populate")[0].sql).not.toContain(HASH);
    expect(run.sqls.at(-1).stage).toBe("marker");
    assertPrivateCleanupAndLogs(run);
  });

  test("fence aborts an old writer's aggregate/event transaction but replay reads remain available", async () => {
    const db = fixture();
    let tested = false;
    const run = fake(db, { after(request) {
      if (request.stage !== "fence" || request.args.includes("--command") || tested) return;
      tested = true;
      db.exec("BEGIN");
      try {
        db.exec("UPDATE cas_nodes SET root_ref_count=3");
        db.prepare("INSERT INTO cas_root_domain_events VALUES ('synthetic-app','old',2,'/one','next',?,?,101)").run(PAYLOAD, CHANGES);
        throw new Error("guard did not abort");
      } catch (error) {
        expect(error.message).toContain("read-only");
        db.exec("ROLLBACK");
      }
      expect(db.prepare("SELECT root_ref_count FROM cas_nodes").get().root_ref_count).toBe(2);
      expect(db.prepare("SELECT revision FROM cas_root_ref_requests WHERE request_id='private-request'").get().revision).toBe(1);
    } });
    await run.run();
    expect(tested).toBe(true);
  });

  test.each(["fence", "archive", "export", "schema", "populate", "verify-before-marker", "marker"])(
    "recovers before marker for a failed %s stage without changing old data",
    async failure => {
      const db = fixture();
      const original = dump(db);
      let failed = false;
      const run = fake(db, { before(request) {
        if (request.stage === failure && !failed) {
          failed = true;
          throw new Error(`Bearer do-not-log ${HASH} ${CHANGES}`);
        }
      } });
      await expect(run.run()).rejects.toBeInstanceOf(RootRefCutoverError);
      expect(count(db, "cas_root_domain_events")).toBe(1);
      expect(count(db, "cas_root_ref_requests")).toBe(1);
      expect(db.prepare("SELECT root_ref_count FROM cas_nodes").get().root_ref_count).toBe(2);
      expect(guards(db)).toHaveLength(0);
      expect(newRows(db)).toBe(0);
      expect(original).toContain(CHANGES.replaceAll("'", "''"));
      assertPrivateCleanupAndLogs(run);
    },
  );

  test("a partially populated batch recovers only new state and leaves concurrent zero-root GC/lease changes intact", async () => {
    const db = fixture();
    db.prepare(`INSERT INTO cas_nodes (app_id,space_id,hash,content_size,content_type)
      VALUES ('synthetic-app','/one',?,0,'text/plain')`).run("b".repeat(64));
    let failed = false;
    const run = fake(db, { before(request) {
      if (request.stage !== "populate" || failed) return;
      failed = true;
      db.exec("INSERT INTO cas_app_root_revisions SELECT app_id,MAX(revision),MAX(revision) FROM cas_root_domain_revisions GROUP BY app_id");
      db.exec("UPDATE cas_nodes SET lease_expires_at=900 WHERE root_ref_count>0");
      db.exec("DELETE FROM cas_nodes WHERE root_ref_count=0");
      throw new Error("partial D1 file failure");
    } });
    await expect(run.run()).rejects.toMatchObject({ recovery: "old-writer-restored" });
    expect(newRows(db)).toBe(0);
    expect(db.prepare("SELECT root_ref_count,lease_expires_at FROM cas_nodes").get()).toEqual({ root_ref_count: 2, lease_expires_at: 900 });
    expect(count(db, "cas_nodes")).toBe(1);
    expect(guards(db)).toHaveLength(0);
  });

  test.each(["drift", "collision", "history"])("shared offline rules reject %s and restore the old writer", async kind => {
    const db = fixture();
    if (kind === "drift") db.exec("UPDATE cas_nodes SET root_ref_count=3");
    if (kind === "history") db.exec("UPDATE cas_root_domain_revisions SET revision=2");
    if (kind === "collision") {
      db.exec("INSERT INTO cas_root_domain_revisions VALUES ('synthetic-app','other',1)");
      db.prepare("INSERT INTO cas_root_domain_events VALUES ('synthetic-app','other',1,'/one','private-request',?,?,100)").run(PAYLOAD, CHANGES);
      db.prepare("INSERT INTO cas_root_ref_requests VALUES ('synthetic-app','/one','other','private-request',?,1,100)").run(PAYLOAD);
    }
    const run = fake(db);
    await expect(run.run()).rejects.toMatchObject({ stage: "validate", recovery: "old-writer-restored" });
    expect(guards(db)).toHaveLength(0);
    expect(newRows(db)).toBe(0);
    assertPrivateCleanupAndLogs(run);
  });

  test("a lost fence response is recovered only with this operation's ownership proof", async () => {
    const db = fixture();
    let failed = false;
    const run = fake(db, { after(request) {
      if (request.stage === "fence" && !failed) { failed = true; throw new Error("lost response"); }
    } });
    await expect(run.run()).rejects.toMatchObject({ recovery: "old-writer-restored" });
    expect(guards(db)).toHaveLength(0);
  });

  test("a concurrent operation's fence is never claimed or removed", async () => {
    const db = fixture();
    let inserted = false;
    const run = fake(db, { before(request) {
      if (request.stage !== "fence" || inserted) return;
      inserted = true;
      db.exec(`CREATE TRIGGER cas_root_domain_events_archive_insert BEFORE INSERT ON cas_root_domain_events
        BEGIN SELECT RAISE(ABORT, 'legacy Root Ref archive is read-only');
        /* root-ref-cutover-owner:foreign */ END`);
    } });
    await expect(run.run()).rejects.toMatchObject({ recovery: "fence-preserved-manual-recovery" });
    expect(guards(db)).toHaveLength(1);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='cas_root_domain_events_archive_insert'").get().sql).toContain("owner:foreign");
    expect(newRows(db)).toBe(0);
    assertPrivateCleanupAndLogs(run);
  });

  test("an unverifiable recovery keeps the fence and requires manual recovery", async () => {
    const db = fixture();
    const run = fake(db, { before(request) {
      if (request.stage === "export" || request.stage === "recovery-inspect") throw new Error("unavailable");
    } });
    await expect(run.run()).rejects.toMatchObject({ recovery: "fence-preserved-manual-recovery" });
    expect(guards(db)).toHaveLength(12);
    expect(newRows(db)).toBe(0);
    assertPrivateCleanupAndLogs(run);
  });

  test("unexpected new events without a marker prohibit automatic cleanup", async () => {
    const db = fixture();
    const run = fake(db, { before(request) {
      if (request.stage !== "populate") return;
      db.prepare("INSERT INTO cas_app_root_events VALUES ('synthetic-app',2,'/one','unexpected',?,?,200)").run(PAYLOAD, CHANGES);
      throw new Error("new writer discovered");
    } });
    await expect(run.run()).rejects.toMatchObject({ recovery: "forward-fix-required" });
    expect(count(db, "cas_app_root_events")).toBe(1);
    expect(guards(db)).toHaveLength(12);
    expect(run.sqls.some(row => row.stage.startsWith("recovery-"))).toBe(false);
  });

  test.each(["lost-marker-response", "post-marker-verification"])("never rolls back after %s", async kind => {
    const db = fixture();
    const run = fake(db, { after(request) {
      if (kind === "lost-marker-response" && request.stage === "marker") throw new Error("uncertain response");
      if (kind === "post-marker-verification" && request.stage === "verify-after-marker") throw new Error("read unavailable");
    } });
    await expect(run.run()).rejects.toMatchObject({ recovery: "forward-fix-required" });
    expect(count(db, "cas_app_root_cutover")).toBe(1);
    expect(guards(db)).toHaveLength(12);
    expect(count(db, "cas_app_root_requests")).toBe(1);
    expect(run.sqls.some(row => row.stage.startsWith("recovery-"))).toBe(false);
    assertPrivateCleanupAndLogs(run);
  });

  test("already-cutover is read-only and retains subsequent App-global events", async () => {
    const db = fixture();
    await fake(db).run();
    db.exec("UPDATE cas_nodes SET root_ref_count=3");
    db.exec("UPDATE cas_app_root_refs SET ref_count=3");
    db.exec("UPDATE cas_app_root_revisions SET revision=2");
    const changes = JSON.stringify({ [HASH]: 1 });
    const payload = createHash("sha256").update(changes).digest("hex");
    db.prepare("INSERT INTO cas_app_root_events VALUES ('synthetic-app',2,'/one','new',?,?,200)").run(payload, changes);
    db.prepare("INSERT INTO cas_app_root_requests VALUES ('synthetic-app','/one','new',?,2,200)").run(payload);
    const run = fake(db);
    await expect(run.run()).resolves.toEqual({ status: "already-cutover" });
    expect(run.calls.every(call => call.args.includes("--command"))).toBe(true);
    expect(count(db, "cas_app_root_events")).toBe(1);
    assertPrivateCleanupAndLogs(run);
  });

  test("already-cutover drift fails closed without changing archive, events or projection", async () => {
    const db = fixture();
    await fake(db).run();
    db.exec("UPDATE cas_app_root_refs SET ref_count=9");
    const run = fake(db);
    await expect(run.run()).rejects.toMatchObject({ stage: "already-cutover", recovery: "forward-fix-required" });
    expect(run.sqls).toEqual([]);
    expect(db.prepare("SELECT ref_count FROM cas_app_root_refs").get().ref_count).toBe(9);
    expect(guards(db)).toHaveLength(12);
    assertPrivateCleanupAndLogs(run);
  });

  test("already-cutover refuses missing archive constraints instead of silently repairing them", async () => {
    const db = fixture();
    await fake(db).run();
    db.exec("DROP TRIGGER cas_root_domain_refs_archive_update");
    const run = fake(db);
    await expect(run.run()).rejects.toMatchObject({ recovery: "forward-fix-required" });
    expect(run.sqls).toEqual([]);
    expect(guards(db)).toHaveLength(11);
    expect(count(db, "cas_app_root_cutover")).toBe(1);
    assertPrivateCleanupAndLogs(run);
  });

  test("pre-existing guards, malformed schema and nonempty new state cannot be claimed or cleared", async () => {
    for (const kind of ["guard", "schema", "node-constraint", "new-state"]) {
      const db = fixture();
      if (kind === "guard") db.exec("CREATE TRIGGER foreign_guard BEFORE INSERT ON cas_root_domain_events BEGIN SELECT RAISE(ABORT,'foreign'); END");
      if (kind === "schema") db.exec("ALTER TABLE cas_root_ref_requests ADD COLUMN unexpected TEXT");
      if (kind === "node-constraint") db.exec(`DROP TABLE cas_nodes;
        CREATE TABLE cas_nodes (app_id TEXT NOT NULL,space_id TEXT NOT NULL,hash TEXT NOT NULL,
          root_ref_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(app_id,space_id,hash))`);
      if (kind === "new-state") {
        db.exec(SCHEMA);
        db.exec("INSERT INTO cas_app_root_revisions (app_id,revision) VALUES ('other',0)");
      }
      const run = fake(db);
      await expect(run.run()).rejects.toMatchObject({ recovery: "no-remote-mutation" });
      expect(run.sqls).toEqual([]);
      assertPrivateCleanupAndLogs(run);
    }
  });
});

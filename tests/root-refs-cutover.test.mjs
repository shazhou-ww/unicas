import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { applyRootRefCutover, planRootRefCutover } from "../release/service/migrate-root-refs.mjs";

const hash = "a".repeat(64);
const changes = JSON.stringify({ [hash]: 2 });
const payload = createHash("sha256").update(changes).digest("hex");
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cas_nodes (app_id TEXT, space_id TEXT, hash TEXT, root_ref_count INTEGER);
    CREATE TABLE cas_root_domain_refs (app_id TEXT, ref_domain TEXT, space_id TEXT, hash TEXT, ref_count INTEGER);
    CREATE TABLE cas_root_domain_revisions (app_id TEXT, ref_domain TEXT, revision INTEGER);
    CREATE TABLE cas_root_domain_events (app_id TEXT, ref_domain TEXT, revision INTEGER, space_id TEXT, request_id TEXT, payload_hash TEXT, changes_json TEXT, applied_at INTEGER);
    CREATE TABLE cas_root_ref_requests (app_id TEXT, space_id TEXT, ref_domain TEXT, request_id TEXT, payload_hash TEXT, revision INTEGER, applied_at INTEGER);
  `);
  db.prepare("INSERT INTO cas_nodes VALUES ('app', '/one', ?, 2)").run(hash);
  db.prepare("INSERT INTO cas_root_domain_refs VALUES ('app', 'old', '/one', ?, 2)").run(hash);
  db.exec("INSERT INTO cas_root_domain_revisions VALUES ('app', 'old', 1)");
  db.prepare("INSERT INTO cas_root_domain_events VALUES ('app','old',1,'/one','r',?,?,100)")
    .run(payload, changes);
  db.prepare("INSERT INTO cas_root_ref_requests VALUES ('app','/one','old','r',?,1,100)").run(payload);
  return db;
}

describe("offline Root Ref cutover", () => {
  test("Spaces migration removes the obsolete column while preserving ownership", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(join("packages", "spaces", "migrations", "0001_initial.sql"), "utf8"));
      db.exec("INSERT INTO spaces_principals VALUES ('principal','active','Synthetic',1,1)");
      db.exec("INSERT INTO spaces_principal_spaces VALUES ('principal','app','/one','old',1,1)");
      db.exec(readFileSync(join("packages", "spaces", "migrations", "0003_remove_ref_domain.sql"), "utf8"));
      expect(db.prepare("SELECT * FROM spaces_principal_spaces").get()).toEqual({
        principal_id: "principal", app_id: "app", space_id: "/one", created_at: 1, updated_at: 1,
      });
      expect(db.prepare("PRAGMA table_info(spaces_principal_spaces)").all().map(row => row.name)).not.toContain("ref_domain");
      expect(() => db.exec("INSERT INTO spaces_principal_spaces VALUES ('missing','app','/two',1,1)")).toThrow();
    } finally { db.close(); }
  });
  test("preserves every aggregate, starts after a checkpoint, bridges replay, freezes archive", () => {
    const db = fixture();
    try {
      const plan = planRootRefCutover(db);
      expect(applyRootRefCutover(db, plan.sourceDigest, 200)).toMatchObject({ apps: 1, nodes: 1, replayRecords: 1 });
      expect(db.prepare("SELECT root_ref_count FROM cas_nodes").get().root_ref_count).toBe(2);
      expect(db.prepare("SELECT ref_count FROM cas_app_root_refs").get().ref_count).toBe(2);
      expect(db.prepare("SELECT revision, checkpoint FROM cas_app_root_revisions").get()).toEqual({ revision: 1, checkpoint: 1 });
      expect(db.prepare("SELECT revision, payload_hash FROM cas_app_root_requests").get()).toEqual({ revision: 1, payload_hash: payload });
      expect(db.prepare("SELECT COUNT(*) AS n FROM cas_app_root_events").get().n).toBe(0);
      for (const sql of [
        "DELETE FROM cas_root_domain_events", "UPDATE cas_root_domain_refs SET ref_count = 0",
        "INSERT INTO cas_root_domain_revisions VALUES ('x','y',0)",
      ]) expect(() => db.exec(sql)).toThrow("read-only");
      expect(() => applyRootRefCutover(db, plan.sourceDigest)).toThrow("already applied");
    } finally { db.close(); }
  });

  test.each(["drift", "orphan", "request-conflict", "same-payload-collision", "hash-mismatch", "missing-request"])("fails closed for %s", kind => {
    const db = fixture();
    try {
      if (kind === "drift") db.exec("UPDATE cas_nodes SET root_ref_count = 3");
      if (kind === "orphan") db.exec("DELETE FROM cas_nodes");
      if (kind === "hash-mismatch") db.exec("UPDATE cas_root_domain_events SET payload_hash = 'invalid'");
      if (kind === "missing-request") db.exec("DELETE FROM cas_root_ref_requests");
      if (kind === "request-conflict" || kind === "same-payload-collision") {
        db.exec("INSERT INTO cas_root_domain_revisions VALUES ('app','other',1)");
        db.prepare("INSERT INTO cas_root_domain_events VALUES ('app','other',1,'/one','r',?,?,100)").run(payload, changes);
        db.prepare("INSERT INTO cas_root_ref_requests VALUES ('app','/one','other','r',?,1,100)")
          .run(kind === "request-conflict" ? "different" : payload);
      }
      expect(() => planRootRefCutover(db)).toThrow();
      expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='cas_app_root_refs'").get().n).toBe(0);
    } finally { db.close(); }
  });

  test("accepts cross-Space request ID reuse and independent domain histories without merging events", () => {
    const db = fixture();
    try {
      db.exec("INSERT INTO cas_root_domain_revisions VALUES ('app','other',1)");
      db.prepare("INSERT INTO cas_root_domain_events VALUES ('app','other',1,'/two','r',?,?,100)").run(payload, changes);
      db.prepare("INSERT INTO cas_root_ref_requests VALUES ('app','/two','other','r',?,1,100)").run(payload);
      const plan = planRootRefCutover(db);
      applyRootRefCutover(db, plan.sourceDigest);
      expect(db.prepare("SELECT COUNT(*) AS n FROM cas_app_root_requests").get().n).toBe(2);
      expect(db.prepare("SELECT checkpoint FROM cas_app_root_revisions").get().checkpoint).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM cas_app_root_events").get().n).toBe(0);
    } finally { db.close(); }
  });

  test("a stale source digest rolls back schema and all state", () => {
    const db = fixture();
    try {
      expect(() => applyRootRefCutover(db, "stale")).toThrow("source changed");
      expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='cas_app_root_refs'").get().n).toBe(0);
    } finally { db.close(); }
  });

  test("CLI dry-run and local-copy leave the persisted source archive unchanged", async () => {
    const { backup } = await import("node:sqlite");
    mkdirSync(".wrangler", { recursive: true });
    const prefix = join(".wrangler", `root-ref-fixture-${randomUUID()}`);
    const sourcePath = `${prefix}-source.sqlite`, targetPath = `${prefix}-target.sqlite`;
    const db = fixture();
    try {
      await backup(db, sourcePath);
      const before = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
      for (const args of [
        ["--input", sourcePath, "--dry-run"],
        ["--input", sourcePath, "--output", targetPath],
      ]) {
        const result = spawnSync(process.execPath, [join("release", "service", "migrate-root-refs.mjs"), ...args], { encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ apps: 1, nodes: 1, replayRecords: 1 });
      }
      expect(createHash("sha256").update(readFileSync(sourcePath)).digest("hex")).toBe(before);
      const candidate = new DatabaseSync(targetPath, { readOnly: true });
      try {
        expect(candidate.prepare("SELECT root_ref_count FROM cas_nodes").get().root_ref_count).toBe(2);
        expect(candidate.prepare("SELECT checkpoint FROM cas_app_root_revisions").get().checkpoint).toBe(1);
      } finally { candidate.close(); }
      const replay = spawnSync(process.execPath, [
        join("release", "service", "migrate-root-refs.mjs"), "--input", targetPath, "--dry-run",
      ], { encoding: "utf8" });
      expect(replay.status).toBe(1);
      expect(replay.stderr).toContain("new Root Ref state is not empty");
    } finally {
      db.close();
      for (const path of [sourcePath, targetPath]) {
        for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
      }
    }
  });
});

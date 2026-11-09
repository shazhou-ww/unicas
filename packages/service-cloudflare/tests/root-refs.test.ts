import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { migrateAppSpaceSchema } from "../src/schema.js";
import {
  CloudflareRootRefRepository, canonicalizeRootRefsUpdate, executeRootRefsUpdate,
  listRootRefs, parseRootRefsBody, withRootRefsRetry, RootRefsValidationError,
} from "../src/root-refs.js";
import { appCanonicalNodeKey } from "../src/do-names.js";

let mf: Miniflare | undefined;
let db: D1Database;
let bucket: R2Bucket;
const APP = "test-app", SPACE = "/one";
const H1 = "a".repeat(64), H2 = "b".repeat(64);
afterEach(async () => { await mf?.dispose(); mf = undefined; });
async function setup() {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "test", modules: true, script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2025-08-17", d1Databases: { DB: "root-test" }, r2Buckets: { BUCKET: "root-test" },
  }] }));
  await mf.ready;
  db = await mf.getD1Database("DB", "test");
  bucket = await mf.getR2Bucket("BUCKET", "test");
  await migrateAppSpaceSchema(db);
}
async function seed(hash: string, count = 0, space = SPACE, ready = true) {
  await db.prepare(`INSERT INTO cas_nodes
    (app_id,space_id,hash,content_size,content_type,root_ref_count)
    VALUES (?,?,?,1,'text/plain',?)`).bind(APP, space, hash, count).run();
  if (count) await db.prepare("INSERT INTO cas_app_root_refs VALUES (?,?,?,?)").bind(APP, space, hash, count).run();
  if (ready) await bucket.put(appCanonicalNodeKey(APP, space, hash), "content");
}
async function run(id: string, changes: Record<string, number>, space = SPACE) {
  const canonical = await canonicalizeRootRefsUpdate({ requestId: id, changes });
  return withRootRefsRetry(() => executeRootRefsUpdate({ db, bucket, appId: APP, spaceId: space, canonical }),
    { maxAttempts: 10, sleep: async () => undefined });
}
async function count(table: string) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}
async function aggregate(hash = H1, space = SPACE) {
  return (await db.prepare("SELECT root_ref_count AS n FROM cas_nodes WHERE app_id=? AND space_id=? AND hash=?")
    .bind(APP, space, hash).first<{ n: number }>())!.n;
}

describe("App Root Ref atomic storage", () => {
  test("deltas, projection, event and replay are atomic and payload-bound", async () => {
    await setup(); await seed(H1, 3); await seed(H2, 1);
    expect(await run("r", { [H1]: 1, [H2]: -1 })).toEqual({ idempotent: false, revision: 1 });
    expect(await aggregate()).toBe(4);
    expect(await aggregate(H2)).toBe(0);
    expect(await count("cas_app_root_refs")).toBe(1);
    expect(await run("r", { [H2]: -1, [H1]: 1 })).toEqual({ idempotent: true, revision: 1 });
    await expect(run("r", { [H1]: 2 })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(await count("cas_app_root_events")).toBe(1);
    expect(await count("cas_app_root_requests")).toBe(1);
  });
  test("cross-Space same IDs are safe and concurrent events have one App order", async () => {
    await setup(); await seed(H1); await seed(H1, 0, "/two");
    const results = await Promise.all([run("shared", { [H1]: 1 }), run("shared", { [H1]: 2 }, "/two")]);
    expect(results.map(r => r.revision).sort()).toEqual([1, 2]);
    expect(await aggregate()).toBe(1);
    expect(await aggregate(H1, "/two")).toBe(2);
    const replay = await run("shared", { [H1]: 2 }, "/two");
    expect(replay).toEqual({ idempotent: true, revision: results[1]!.revision });
  });
  test("real lost revision CAS rolls back every delta and insert", async () => {
    await setup(); await seed(H1);
    await run("first", { [H1]: 1 });
    const canonical = await canonicalizeRootRefsUpdate({ requestId: "stale", changes: { [H1]: 1 } });
    const repository = new CloudflareRootRefRepository(db, bucket);
    await expect(repository.commit({
      scope: { appId: APP, spaceId: SPACE }, ...canonical, expectedRevision: 0,
      revision: 1, projections: [{ hash: H1, refCount: 2 }], appliedAt: 123,
    })).rejects.toThrow();
    expect(await aggregate()).toBe(1);
    expect(await count("cas_app_root_events")).toBe(1);
    expect(await count("cas_app_root_requests")).toBe(1);
  });
  test("failure late in the batch rolls back revision, projection and aggregate", async () => {
    await setup(); await seed(H1);
    await db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON cas_app_root_events BEGIN SELECT RAISE(ABORT,'injected'); END");
    await expect(run("failed", { [H1]: 1 })).rejects.toThrow();
    expect(await aggregate()).toBe(0);
    expect(await count("cas_app_root_refs")).toBe(0);
    expect(await count("cas_app_root_revisions")).toBe(0);
    expect(await count("cas_app_root_requests")).toBe(0);
  });
  test("lost response replay does not apply the delta twice", async () => {
    await setup(); await seed(H1);
    const canonical = await canonicalizeRootRefsUpdate({ requestId: "lost", changes: { [H1]: 1 } });
    await executeRootRefsUpdate({ db, bucket, appId: APP, spaceId: SPACE, canonical });
    expect(await run("lost", { [H1]: 1 })).toEqual({ idempotent: true, revision: 1 });
    expect(await aggregate()).toBe(1);
  });
  test("cutover bridges an old request to its original revision without fabricating events", async () => {
    await setup(); await seed(H1, 2);
    const canonical = await canonicalizeRootRefsUpdate({ requestId: "old", changes: { [H1]: 2 } });
    await db.prepare("INSERT INTO cas_app_root_revisions (app_id,revision,checkpoint) VALUES (?,7,7)").bind(APP).run();
    await db.prepare("INSERT INTO cas_app_root_requests VALUES (?,?,?,?,?,?)")
      .bind(APP, SPACE, "old", canonical.payloadHash, 3, 100).run();
    await db.prepare("INSERT INTO cas_app_root_cutover VALUES (1,'synthetic',200)").run();
    expect(await run("old", { [H1]: 2 })).toEqual({ idempotent: true, revision: 3 });
    await expect(run("old", { [H1]: 1 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await count("cas_app_root_events")).toBe(0);
    expect(await run("new", { [H1]: 1 })).toEqual({ idempotent: false, revision: 8 });
    expect(await aggregate()).toBe(3);
    expect(await count("cas_app_root_events")).toBe(1);
  });
  test("missing/unready/negative nodes and projection drift fail closed", async () => {
    await setup(); await seed(H1, 0, SPACE, false);
    await expect(run("missing", { [H2]: 1 })).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
    await expect(run("unready", { [H1]: 1 })).rejects.toMatchObject({ code: "NODE_NOT_READY" });
    await expect(run("negative", { [H1]: -1 })).rejects.toMatchObject({ code: "NEGATIVE_AGGREGATE" });
    await bucket.put(appCanonicalNodeKey(APP, SPACE, H1), "ready");
    await db.prepare("UPDATE cas_nodes SET root_ref_count=1").run();
    await expect(run("drift", { [H1]: 1 })).rejects.toMatchObject({ code: "ROOT_REF_BUSY" });
    expect(await aggregate()).toBe(1);
    expect(await count("cas_app_root_events")).toBe(0);
  });
  test("unmigrated legacy state blocks new writes", async () => {
    await setup(); await seed(H1);
    await db.prepare("INSERT INTO cas_root_domain_revisions VALUES (?, 'old', 1)").bind(APP).run();
    await expect(run("blocked", { [H1]: 1 })).rejects.toThrow();
    expect(await aggregate()).toBe(0);
  });
  test("data pages bind revision and scope, and reject stale cursors", async () => {
    await setup(); await seed(H1); await seed(H2);
    await run("r", { [H1]: 1, [H2]: 2 });
    const first = await listRootRefs({ db, appId: APP, spaceId: SPACE, limit: 1, cursor: "" });
    expect(first).toMatchObject({ revision: 1, items: [{ hash: H1, refCount: 1 }] });
    expect(first.nextCursor).toBeTypeOf("string");
    expect(await listRootRefs({ db, appId: APP, spaceId: SPACE, limit: 1, cursor: first.nextCursor! }))
      .toMatchObject({ items: [{ hash: H2, refCount: 2 }], nextCursor: null });
    await run("change", { [H1]: 1 });
    await expect(listRootRefs({ db, appId: APP, spaceId: SPACE, limit: 1, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ code: "ROOT_REF_SNAPSHOT_CHANGED" });
  });
  test("duplicate keys and invalid deltas are rejected", async () => {
    expect(() => parseRootRefsBody(`{"requestId":"x","changes":{"${H1}":1,"${H1}":2}}`)).toThrow(RootRefsValidationError);
    for (const changes of [{}, { [H1]: 0 }, { [H1]: 2_000_000 }]) {
      await expect(canonicalizeRootRefsUpdate({ requestId: "x", changes })).rejects.toThrow(RootRefsValidationError);
    }
  });
});

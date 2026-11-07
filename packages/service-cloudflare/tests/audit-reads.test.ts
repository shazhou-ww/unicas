import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { migrateAppSpaceSchema } from "../src/schema.js";
import { listAppRootEvents, listAppRootRefs, decodeRefsCursor } from "../src/audit-reads.js";

let mf: Miniflare | undefined;
let db: D1Database;
const APP = "audit-app", H1 = "a".repeat(64), H2 = "b".repeat(64);
afterEach(async () => { await mf?.dispose(); mf = undefined; });
async function setup() {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "test", modules: true, script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2025-08-17", d1Databases: { DB: "audit-test" },
  }] }));
  await mf.ready; db = await mf.getD1Database("DB", "test");
  await migrateAppSpaceSchema(db);
}
async function revision(n: number) {
  await db.prepare(`INSERT INTO cas_app_root_revisions (app_id,revision) VALUES (?,?)
    ON CONFLICT(app_id) DO UPDATE SET revision=excluded.revision`).bind(APP, n).run();
}
async function ref(space: string, hash: string, n: number) {
  await db.prepare("INSERT INTO cas_app_root_refs VALUES (?,?,?,?)").bind(APP, space, hash, n).run();
}
async function event(n: number, space: string) {
  await db.prepare("INSERT INTO cas_app_root_events VALUES (?,?,?,?,?,?,?)")
    .bind(APP, n, space, `r${n}`, H2, JSON.stringify({ [H1]: 1 }), n * 1000).run();
}

describe("App-global Root Ref audit", () => {
  test("empty App has no events or balances", async () => {
    await setup();
    expect(await listAppRootRefs({ db, appId: APP })).toEqual({ revision: 0, refs: [], nextCursor: null });
    expect(await listAppRootEvents({ db, appId: APP })).toEqual({ events: [], latestRevision: 0, nextAfter: 0 });
  });
  test("balances order by Space/hash and cursor binds App, filter and revision", async () => {
    await setup(); await revision(7);
    await ref("/two", H1, 3); await ref("/one", H2, 2); await ref("/one", H1, 1);
    const first = await listAppRootRefs({ db, appId: APP, limit: 1 });
    expect(first.refs).toEqual([{ spaceId: "/one", hash: H1, count: 1 }]);
    expect(decodeRefsCursor(first.nextCursor!)).toMatchObject({ appId: APP, revision: 7 });
    const next = await listAppRootRefs({ db, appId: APP, limit: 2, cursor: first.nextCursor! });
    expect(next.refs).toEqual([{ spaceId: "/one", hash: H2, count: 2 }, { spaceId: "/two", hash: H1, count: 3 }]);
    expect(next.nextCursor).toBeNull();
    await expect(listAppRootRefs({ db, appId: "other", cursor: first.nextCursor! })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(listAppRootRefs({ db, appId: APP, spaceId: "/one", cursor: first.nextCursor! })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await revision(8);
    await expect(listAppRootRefs({ db, appId: APP, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "ROOT_REF_SNAPSHOT_CHANGED" });
  });
  test("exact Space filter and invalid cursors/limits", async () => {
    await setup(); await revision(1); await ref("/one", H1, 1); await ref("/two", H1, 2);
    expect((await listAppRootRefs({ db, appId: APP, spaceId: "/two" })).refs).toEqual([{ spaceId: "/two", hash: H1, count: 2 }]);
    await expect(listAppRootRefs({ db, appId: APP, cursor: "!!!" })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(listAppRootRefs({ db, appId: APP, limit: 1001 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  test("events are watermark-bounded and filtered empty pages advance", async () => {
    await setup(); await revision(3);
    await event(1, "/one"); await event(2, "/two"); await event(3, "/one");
    const first = await listAppRootEvents({ db, appId: APP, limit: 1 });
    expect(first).toMatchObject({ latestRevision: 3, nextAfter: 1, events: [{ revision: 1, spaceId: "/one", payloadHash: H2 }] });
    const filtered = await listAppRootEvents({ db, appId: APP, spaceId: "/two", after: 2 });
    expect(filtered).toEqual({ latestRevision: 3, nextAfter: 3, events: [] });
    const ahead = await listAppRootEvents({ db, appId: APP, after: 9 });
    expect(ahead.nextAfter).toBe(9);
    await expect(listAppRootEvents({ db, appId: APP, after: -1 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  test("event append after watermark is not leaked into the page", async () => {
    await setup(); await revision(1); await event(1, "/one");
    let injected = false;
    const racingDb = new Proxy(db, { get(target, prop, receiver) {
      if (prop === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes("FROM cas_app_root_events")) return statement;
        return new Proxy(statement, { get(stmt, key) {
          if (key === "bind") return (...args: unknown[]) => {
            const bound = stmt.bind(...args);
            return new Proxy(bound, { get(b, method) {
              if (method === "all") return async () => {
                if (!injected) { injected = true; await revision(2); await event(2, "/two"); }
                return b.all();
              };
              return Reflect.get(b, method, b);
            } });
          };
          return Reflect.get(stmt, key, stmt);
        } });
      };
      return Reflect.get(target, prop, receiver);
    } });
    const page = await listAppRootEvents({ db: racingDb, appId: APP });
    expect(page.latestRevision).toBe(1);
    expect(page.events.map(e => e.revision)).toEqual([1]);
  });
});

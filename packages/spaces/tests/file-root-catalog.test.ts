import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { D1FileRootCatalog, FileRootConflictError } from "../src/file-root-catalog.js";

let runtime: Miniflare | undefined;

afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

async function fixture() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "spaces-catalog-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { SPACES_DB: "spaces-catalog-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("SPACES_DB", "spaces-catalog-test");
  const migration = await readFile(new URL("../../../stacks/unicas/spaces/migrations/0001_initial.sql", import.meta.url), "utf8");
  await db.exec(migration.replace(/\r?\n/g, " "));
  for (const principalId of ["principal-a", "principal-b"]) {
    await db.prepare(`
      INSERT INTO spaces_principals (principal_id, status, display_name, created_at, updated_at)
      VALUES (?, 'active', ?, 1, 1)
    `).bind(principalId, principalId).run();
  }
  return db;
}

describe("D1FileRootCatalog", () => {
  test("isolates one root per Principal and advances revisions", async () => {
    const db = await fixture();
    const first = new D1FileRootCatalog(db, "principal-a", () => 100);
    const second = new D1FileRootCatalog(db, "principal-b", () => 200);

    await expect(first.create({ rootId: "root-a", name: "Files", manifestHash: "hash-a" }))
      .resolves.toEqual({
        rootId: "root-a",
        name: "Files",
        manifestHash: "hash-a",
        revision: 1,
        createdAt: 100,
        updatedAt: 100,
      });
    await second.create({ rootId: "root-b", name: "Other", manifestHash: "hash-b" });

    expect(await first.list()).toHaveLength(1);
    expect((await first.list())[0]?.rootId).toBe("root-a");
    await expect(first.create({ rootId: "root-a-2", name: "Again", manifestHash: "hash-c" }))
      .rejects.toBeInstanceOf(FileRootConflictError);

    await expect(first.update({ rootId: "root-a", revision: 1, name: "Renamed", manifestHash: "hash-next" }))
      .resolves.toMatchObject({ name: "Renamed", manifestHash: "hash-next", revision: 2, updatedAt: 100 });
    await expect(first.listPendingReleases()).resolves.toEqual([{
      requestId: "spaces-root:root-a:revision:1:release",
      rootId: "root-a",
      manifestHash: "hash-a",
    }]);
    await first.completePendingRelease("spaces-root:root-a:revision:1:release");
    await expect(first.listPendingReleases()).resolves.toEqual([]);
    await expect(first.update({ rootId: "root-a", revision: 1, name: "Stale", manifestHash: "hash-stale" }))
      .rejects.toMatchObject({ code: "root_revision_conflict" });

    await first.update({ rootId: "root-a", revision: 2, name: "Name only", manifestHash: "hash-next" });
    await expect(first.listPendingReleases()).resolves.toEqual([]);
  });

  test("requires matching Principal and revision when deleting", async () => {
    const db = await fixture();
    const first = new D1FileRootCatalog(db, "principal-a");
    const second = new D1FileRootCatalog(db, "principal-b");
    await first.create({ rootId: "root-a", name: "Files", manifestHash: "hash-a" });

    await expect(second.delete({ rootId: "root-a", revision: 1 }))
      .rejects.toMatchObject({ code: "root_revision_conflict" });
    await expect(first.delete({ rootId: "root-a", revision: 2 }))
      .rejects.toMatchObject({ code: "root_revision_conflict" });
    await expect(first.delete({ rootId: "root-a", revision: 1 })).resolves.toBeUndefined();
    expect(await first.list()).toEqual([]);
  });
});
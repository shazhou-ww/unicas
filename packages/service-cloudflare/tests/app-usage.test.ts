import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { AppUsageUnavailableError, readAppUsage } from "@unicas/service";
import { APP_USAGE_QUERY, CloudflareAppUsageRepository } from "../src/app-usage.js";
import { appCanonicalNodeKey } from "../src/do-names.js";
import { migrateAppSpaceSchema } from "../src/schema.js";
import {
  reconcileAppUsageObservations,
  repairOldestSpaceUsageProjection,
  repairSpaceUsageProjection,
} from "../src/usage-reconciliation.js";

let miniflare: Miniflare;
let db: D1Database;
let bucket: R2Bucket;

beforeEach(async () => {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "app-usage-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "app-usage-test-db" },
      r2Buckets: { BUCKET: "app-usage-test-bucket" },
    }],
  }));
  await miniflare.ready;
  db = await miniflare.getD1Database("DB", "app-usage-test");
  bucket = await miniflare.getR2Bucket("BUCKET", "app-usage-test") as unknown as R2Bucket;
  await migrateAppSpaceSchema(db);
});

afterEach(async () => miniflare.dispose());

async function insertNode(input: {
  appId: string;
  spaceId: string;
  hash: string;
  contentSize: number;
  storedBytes?: number | null;
  observedAt?: number | null;
  leaseExpiresAt?: number;
}) {
  await db.prepare(
    `INSERT INTO cas_nodes (
       app_id, space_id, hash, content_size, content_type, lease_expires_at,
       canonical_stored_bytes, canonical_observed_at
     ) VALUES (?, ?, ?, ?, 'application/octet-stream', ?, ?, ?)`,
  ).bind(
    input.appId,
    input.spaceId,
    input.hash,
    input.contentSize,
    input.leaseExpiresAt ?? 0,
    input.storedBytes ?? null,
    input.observedAt ?? null,
  ).run();
}

describe("Cloudflare App usage projection", () => {
  test("aggregates Space summaries while isolating Apps and counting duplicate hashes", async () => {
    const duplicateHash = "a".repeat(64);
    await insertNode({ appId: "app-a", spaceId: "space-1", hash: duplicateHash, contentSize: 10, storedBytes: 8, observedAt: 1, leaseExpiresAt: 20 });
    await insertNode({ appId: "app-a", spaceId: "space-2", hash: duplicateHash, contentSize: 7, storedBytes: 6, observedAt: 1 });
    await insertNode({ appId: "app-a", spaceId: "space-2", hash: "b".repeat(64), contentSize: 3, storedBytes: null, observedAt: 1, leaseExpiresAt: 1 });
    await insertNode({ appId: "app-b", spaceId: "space-1", hash: duplicateHash, contentSize: 100, storedBytes: 90, observedAt: 1 });
    await db.prepare(
      "INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at) VALUES ('app-a', 'space-2', ?, 5, 1, 2)",
    ).bind("c".repeat(64)).run();

    const repository = new CloudflareAppUsageRepository(db);
    await expect(readAppUsage({ repository, appId: "app-a" })).resolves.toEqual({
      nodeCount: 3,
      readyContentBytes: 20,
      readyStoredBytes: 14,
      reservedBytes: 5,
      notReadyNodeCount: 1,
      leasedNodeCount: 2,
    });
    await expect(readAppUsage({ repository, appId: "empty-app" })).resolves.toEqual({
      nodeCount: 0,
      readyContentBytes: 0,
      readyStoredBytes: 0,
      reservedBytes: 0,
      notReadyNodeCount: 0,
      leasedNodeCount: 0,
    });
  });

  test("updates projection deltas transactionally and removes an empty Space row", async () => {
    const hash = "a".repeat(64);
    const reservationHash = "b".repeat(64);
    await insertNode({ appId: "app-a", spaceId: "space-1", hash, contentSize: 10 });
    await db.prepare(
      "INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at) VALUES ('app-a', 'space-1', ?, 5, 1, 2)",
    ).bind(reservationHash).run();
    const repository = new CloudflareAppUsageRepository(db);
    await expect(readAppUsage({ repository, appId: "app-a" }))
      .rejects.toBeInstanceOf(AppUsageUnavailableError);

    await db.prepare(
      "UPDATE cas_nodes SET canonical_stored_bytes = 8, canonical_observed_at = 1, lease_expires_at = 2 WHERE app_id = 'app-a' AND space_id = 'space-1' AND hash = ?",
    ).bind(hash).run();
    await expect(readAppUsage({ repository, appId: "app-a" })).resolves.toMatchObject({
      nodeCount: 1,
      readyStoredBytes: 8,
      reservedBytes: 5,
      leasedNodeCount: 1,
    });

    await db.prepare(
      `INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at)
       VALUES ('app-a', 'space-1', ?, 7, 1, 2)
       ON CONFLICT(app_id, space_id, hash) DO UPDATE SET stored_bytes = excluded.stored_bytes`,
    ).bind(reservationHash).run();
    await db.prepare(
      "UPDATE cas_nodes SET lease_expires_at = 0 WHERE app_id = 'app-a' AND space_id = 'space-1' AND hash = ?",
    ).bind(hash).run();
    await expect(readAppUsage({ repository, appId: "app-a" })).resolves.toMatchObject({
      reservedBytes: 7,
      leasedNodeCount: 0,
    });

    await db.prepare(
      "DELETE FROM cas_nodes WHERE app_id = 'app-a' AND space_id = 'space-1' AND hash = ?",
    ).bind(hash).run();
    await db.prepare(
      "DELETE FROM cas_upload_reservations WHERE app_id = 'app-a' AND space_id = 'space-1' AND hash = ?",
    ).bind(reservationHash).run();
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_space_usage WHERE app_id = 'app-a'",
    ).first()).toEqual({ count: 0 });
  });

  test("aborts source mutations when a Space summary is unexpectedly missing", async () => {
    const nodeHash = "a".repeat(64);
    const reservationHash = "b".repeat(64);
    await insertNode({ appId: "app-a", spaceId: "space-1", hash: nodeHash, contentSize: 10, storedBytes: 8, observedAt: 1 });
    await db.prepare(
      "INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at) VALUES ('app-a', 'space-1', ?, 5, 1, 2)",
    ).bind(reservationHash).run();
    await db.prepare("DELETE FROM cas_space_usage WHERE app_id = 'app-a' AND space_id = 'space-1'").run();

    await expect(db.prepare(
      "UPDATE cas_nodes SET lease_expires_at = 2 WHERE app_id = 'app-a' AND space_id = 'space-1' AND hash = ?",
    ).bind(nodeHash).run()).rejects.toThrow(/missing Space usage projection/);
    await expect(db.prepare(
      "DELETE FROM cas_upload_reservations WHERE app_id = 'app-a' AND space_id = 'space-1' AND hash = ?",
    ).bind(reservationHash).run()).rejects.toThrow(/missing Space usage projection/);

    await expect(reconcileAppUsageObservations({ db, bucket, limit: 1, now: () => 10 }))
      .resolves.toMatchObject({ examined: 1, observed: 1, failed: 0 });
    await expect(readAppUsage({ repository: new CloudflareAppUsageRepository(db), appId: "app-a" }))
      .resolves.toMatchObject({ nodeCount: 1, reservedBytes: 5, notReadyNodeCount: 1 });
  });

  test("uses the App prefix of the Space summary primary key without node scans", async () => {
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${APP_USAGE_QUERY}`).bind("app-a").all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("cas_space_usage");
    expect(details).toMatch(/app_id=\?/);
    expect(details).not.toContain("cas_nodes");
    expect(details).not.toContain("cas_upload_reservations");
  });

  test("backfills missing observations and then rotates through old observations", async () => {
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    await insertNode({ appId: "app-a", spaceId: "space-1", hash: firstHash, contentSize: 10 });
    await insertNode({ appId: "app-a", spaceId: "space-1", hash: secondHash, contentSize: 7 });
    await bucket.put(appCanonicalNodeKey("app-a", "space-1", firstHash), new Uint8Array(8));

    await expect(reconcileAppUsageObservations({ db, bucket, limit: 1, now: () => 10 }))
      .resolves.toEqual({ examined: 1, observed: 1, missing: 0, failed: 0, backfill: true });
    await expect(readAppUsage({ repository: new CloudflareAppUsageRepository(db), appId: "app-a" }))
      .rejects.toBeInstanceOf(AppUsageUnavailableError);

    await expect(reconcileAppUsageObservations({ db, bucket, limit: 2, now: () => 20 }))
      .resolves.toEqual({ examined: 1, observed: 1, missing: 1, failed: 0, backfill: true });
    await expect(readAppUsage({ repository: new CloudflareAppUsageRepository(db), appId: "app-a" }))
      .resolves.toMatchObject({ readyStoredBytes: 8, notReadyNodeCount: 1 });

    await bucket.delete(appCanonicalNodeKey("app-a", "space-1", firstHash));
    await expect(reconcileAppUsageObservations({ db, bucket, limit: 1, now: () => 30 }))
      .resolves.toMatchObject({ examined: 1, missing: 1, backfill: false });
    await expect(readAppUsage({ repository: new CloudflareAppUsageRepository(db), appId: "app-a" }))
      .resolves.toMatchObject({ readyStoredBytes: 0, notReadyNodeCount: 2 });
  });

  test("rebuilds one Space summary without touching another Space", async () => {
    await insertNode({ appId: "app-a", spaceId: "space-1", hash: "a".repeat(64), contentSize: 10, storedBytes: 8, observedAt: 1 });
    await insertNode({ appId: "app-a", spaceId: "space-2", hash: "b".repeat(64), contentSize: 7, storedBytes: 6, observedAt: 1 });
    await db.prepare(
      "UPDATE cas_space_usage SET ready_stored_bytes = 99 WHERE app_id = 'app-a' AND space_id = 'space-1'",
    ).run();

    await repairSpaceUsageProjection(db, { appId: "app-a", spaceId: "space-1" });
    const rows = await db.prepare(
      "SELECT space_id, ready_stored_bytes FROM cas_space_usage WHERE app_id = 'app-a' ORDER BY space_id",
    ).all<{ space_id: string; ready_stored_bytes: number }>();
    expect(rows.results).toEqual([
      { space_id: "space-1", ready_stored_bytes: 8 },
      { space_id: "space-2", ready_stored_bytes: 6 },
    ]);

    await db.prepare(
      "UPDATE cas_space_usage SET repaired_at = 20 WHERE app_id = 'app-a' AND space_id = 'space-1'",
    ).run();
    await db.prepare(
      "UPDATE cas_space_usage SET ready_stored_bytes = 99, repaired_at = 0 WHERE app_id = 'app-a' AND space_id = 'space-2'",
    ).run();
    await expect(repairOldestSpaceUsageProjection({ db, now: () => 30 })).resolves.toBe(true);
    expect(await db.prepare(
      "SELECT ready_stored_bytes, repaired_at FROM cas_space_usage WHERE app_id = 'app-a' AND space_id = 'space-2'",
    ).first()).toEqual({ ready_stored_bytes: 6, repaired_at: 30 });
    expect(await db.prepare(
      "SELECT repaired_at FROM cas_space_usage WHERE app_id = 'app-a' AND space_id = 'space-1'",
    ).first()).toEqual({ repaired_at: 20 });
  });
});
import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { migrateControlSchema } from "../src/control-schema.js";
import { migrateAppSpaceSchema } from "../src/schema.js";

let miniflare: Miniflare | undefined;
let db: D1Database | undefined;

afterEach(async () => {
  await miniflare?.dispose();
  miniflare = undefined;
  db = undefined;
});

async function createRawDb(): Promise<D1Database> {
  miniflare = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "task5-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "task5-test-db" },
    }],
  }));
  await miniflare.ready;
  db = await miniflare.getD1Database("DB", "task5-test");
  return db;
}

async function createDb(): Promise<D1Database> {
  const db = await createRawDb();
  await migrateAppSpaceSchema(db);
  return db;
}

describe("App-scoped Space schema", () => {
  test("creates App-aware authoritative and audit tables, idempotently", async () => {
    const database = await createDb();
    await migrateAppSpaceSchema(database); // rerun must be a no-op

    const tables = await database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = new Set(tables.results!.map((row) => row.name));
    for (const expected of [
      "cas_nodes",
      "cas_edges",
      "cas_root_ref_requests",
      "cas_root_domain_events",
      "cas_root_domain_refs",
      "cas_root_domain_revisions",
      "cas_upload_reservations",
      "cas_node_uploads",
      "cas_node_upload_cleanup",
      "cas_space_usage",
      "cas_usage_projection_migrations",
    ]) {
      expect(names.has(expected), `missing table ${expected}`).toBe(true);
    }
    expect(names.has("cas_root_owners")).toBe(false);
    expect(names.has("cas_schema_meta")).toBe(false);
    expect(names.has("cas_r2_migration_manifest")).toBe(false);
  });

  test("nodes are keyed by (app_id, space_id, hash)", async () => {
    const database = await createDb();
    const columns = await database.prepare("PRAGMA table_info(cas_nodes)").all<{ name: string; pk: number; dflt_value: string | null }>();
    const pk = columns.results!.filter((column) => column.pk > 0).map((column) => column.name);
    expect(pk).toEqual(["app_id", "space_id", "hash"]);
    expect(columns.results!.some((column) => column.name === "object_format")).toBe(false);
    expect(columns.results!.find((column) => column.name === "ready")?.dflt_value).toBe("1");
    expect(columns.results!.map((column) => column.name)).toEqual(expect.arrayContaining([
      "canonical_stored_bytes",
      "canonical_observed_at",
    ]));
  });

  test("backfills legacy nodes and reservations exactly once", async () => {
    const database = await createRawDb();
    await database.exec(
      "CREATE TABLE cas_nodes (app_id TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, content_size INTEGER NOT NULL, content_type TEXT NOT NULL, lease_started_at INTEGER NOT NULL DEFAULT 0, lease_expires_at INTEGER NOT NULL DEFAULT 0, child_ref_count INTEGER NOT NULL DEFAULT 0, root_ref_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (app_id, space_id, hash))",
    );
    await database.exec(
      "CREATE TABLE cas_upload_reservations (app_id TEXT NOT NULL, space_id TEXT NOT NULL, hash TEXT NOT NULL, stored_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (app_id, space_id, hash))",
    );
    await database.prepare(
      "INSERT INTO cas_nodes (app_id, space_id, hash, content_size, content_type, lease_expires_at) VALUES ('app-a', 'space-1', ?, 10, 'text/plain', 20)",
    ).bind("a".repeat(64)).run();
    await database.prepare(
      "INSERT INTO cas_upload_reservations (app_id, space_id, hash, stored_bytes, created_at, expires_at) VALUES ('app-a', 'space-1', ?, 5, 1, 2)",
    ).bind("b".repeat(64)).run();

    await Promise.all([
      migrateAppSpaceSchema(database),
      migrateAppSpaceSchema(database),
    ]);
    await migrateAppSpaceSchema(database);

    expect(await database.prepare(
      `SELECT node_count, ready_content_bytes, ready_stored_bytes, reserved_bytes,
         not_ready_node_count, leased_node_count, unobserved_node_count
       FROM cas_space_usage WHERE app_id = 'app-a' AND space_id = 'space-1'`,
    ).first()).toEqual({
      node_count: 1,
      ready_content_bytes: 10,
      ready_stored_bytes: 0,
      reserved_bytes: 5,
      not_ready_node_count: 0,
      leased_node_count: 1,
      unobserved_node_count: 1,
    });
    expect(await database.prepare(
      "SELECT COUNT(*) AS count FROM cas_usage_projection_migrations WHERE version = 1",
    ).first()).toEqual({ count: 1 });
  });
});

describe("control schema", () => {
  test("creates fresh Account identity tables with constrained relationships", async () => {
    const database = await createDb();
    await migrateControlSchema(database);
    await migrateControlSchema(database);

    const tables = await database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = new Set(tables.results!.map(row => row.name));
    for (const expected of [
      "cas_accounts",
      "cas_account_profiles",
      "cas_external_identities",
      "cas_account_platform_authorities",
      "cas_account_aliases",
      "cas_account_app_idempotency",
      "cas_account_app_invitation_idempotency",
      "cas_email_challenges",
    ]) expect(names.has(expected), `missing table ${expected}`).toBe(true);
    for (const retired of [
      "cas_identity_migration_map",
      "cas_identity_migration_journal",
      "cas_platform_principals",
      "cas_operator_identities",
      "cas_control_idempotency",
    ]) expect(names.has(retired), `unexpected table ${retired}`).toBe(false);

    const authorityColumns = await database.prepare(
      "PRAGMA table_info(cas_account_platform_authorities)",
    ).all<{ name: string; pk: number }>();
    expect(authorityColumns.results!
      .filter(column => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(column => column.name)).toEqual(["account_id", "authority"]);
    const idempotencyColumns = await database.prepare(
      "PRAGMA table_info(cas_account_app_idempotency)",
    ).all<{ name: string; pk: number }>();
    expect(idempotencyColumns.results!
      .filter(column => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(column => column.name)).toEqual([
        "account_id", "method", "canonical_route", "idempotency_key",
      ]);
    const membershipColumns = await database.prepare(
      "PRAGMA table_info(cas_app_members)",
    ).all<{ name: string; pk: number }>();
    expect(membershipColumns.results!.map(column => column.name)).toEqual([
      "app_id", "account_id", "joined_at",
    ]);
    expect(membershipColumns.results!
      .filter(column => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(column => column.name)).toEqual(["app_id", "account_id"]);

    const firstAccountId = `acct_${"a".repeat(22)}`;
    const secondAccountId = `acct_${"b".repeat(22)}`;
    const insertAccount = database.prepare(
      "INSERT INTO cas_accounts (account_id, credential_version, created_at, updated_at) VALUES (?, 1, 1, 1)",
    );
    await insertAccount.bind(firstAccountId).run();
    await insertAccount.bind(secondAccountId).run();
    await database.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 1)",
    ).bind(firstAccountId).run();
    await expect(database.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 2)",
    ).bind(firstAccountId).run()).rejects.toThrow();
    await expect(database.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'owner', 2)",
    ).bind(firstAccountId).run()).rejects.toThrow();

    await database.prepare(
      "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at) VALUES ('ext-1', ?, 'google', 'https://accounts.google.com', 'subject-1', 1)",
    ).bind(firstAccountId).run();
    await expect(database.prepare(
      "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at) VALUES ('ext-2', ?, 'google', 'https://accounts.google.com', 'subject-1', 2)",
    ).bind(secondAccountId).run()).rejects.toThrow();
    await database.prepare(
      "UPDATE cas_external_identities SET unlinked_at = 3 WHERE external_identity_id = 'ext-1'",
    ).run();
    await database.prepare(
      "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at) VALUES ('ext-2', ?, 'google', 'https://accounts.google.com', 'subject-1', 4)",
    ).bind(secondAccountId).run();

    expect(await database.prepare(
      "SELECT COUNT(*) AS count FROM cas_external_identities WHERE issuer = 'https://accounts.google.com' AND subject = 'subject-1'",
    ).first()).toEqual({ count: 2 });
  });

  test("creates App-scoped control tables idempotently", async () => {
    const database = await createDb();
    await migrateControlSchema(database);
    await migrateControlSchema(database);

    const tables = await database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = new Set(tables.results!.map((row) => row.name));
    for (const expected of [
      "cas_apps",
      "cas_app_members",
      "cas_app_member_invitations",
      "cas_app_oauth_issuers",
    ]) expect(names.has(expected), `missing table ${expected}`).toBe(true);
    for (const legacy of [
      "cas_stacks",
      "cas_stack_members",
      "cas_stack_member_invitations",
      "cas_stack_oauth_issuers",
    ]) expect(names.has(legacy), `unexpected table ${legacy}`).toBe(false);

    for (const table of [
      "cas_apps",
      "cas_app_members",
      "cas_app_member_invitations",
      "cas_app_oauth_issuers",
      "cas_oauth_issuer_inspections",
      "cas_control_audit_events",
    ]) {
      const columns = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(columns.results!.map((column) => column.name), table).toContain("app_id");
      expect(columns.results!.map((column) => column.name), table).not.toContain("stack_id");
    }
  });

});

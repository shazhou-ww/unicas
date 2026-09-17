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

async function createDb(): Promise<D1Database> {
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
  });
});

describe("control schema", () => {
  test("creates additive Account identity tables with constrained relationships", async () => {
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
      "cas_email_challenges",
    ]) expect(names.has(expected), `missing table ${expected}`).toBe(true);
    for (const retired of [
      "cas_identity_migration_map",
      "cas_identity_migration_journal",
    ]) expect(names.has(retired), `unexpected table ${retired}`).toBe(false);

    const authorityColumns = await database.prepare(
      "PRAGMA table_info(cas_account_platform_authorities)",
    ).all<{ name: string; pk: number }>();
    expect(authorityColumns.results!
      .filter(column => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(column => column.name)).toEqual(["account_id", "authority"]);

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

  test("upgrades persisted stack-scoped tables before creating App indexes", async () => {
    const database = await createDb();
    await database.exec("CREATE TABLE cas_oauth_issuer_inspections (inspection_id TEXT PRIMARY KEY, stack_id TEXT NOT NULL, issuer TEXT NOT NULL, audience TEXT NOT NULL, metadata_url TEXT NOT NULL, metadata_type TEXT NOT NULL, authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL, jwks_uri TEXT NOT NULL, registration_endpoint TEXT, scopes_supported TEXT NOT NULL DEFAULT '[]', code_challenge_methods_supported TEXT NOT NULL DEFAULT '[]', metadata_digest TEXT NOT NULL, jwks_digest TEXT NOT NULL, challenge_hash TEXT NOT NULL, capability_max_lifetime_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revision INTEGER NOT NULL DEFAULT 1)");
    await database.exec("CREATE TABLE cas_control_audit_events (event_id TEXT PRIMARY KEY, stack_id TEXT, identity_issuer TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, request_id TEXT, trace_id TEXT, caller_channel TEXT, oauth_client_handle TEXT, tool_name TEXT, created_at INTEGER NOT NULL)");
    await database.prepare(
      "INSERT INTO cas_oauth_issuer_inspections (inspection_id, stack_id, issuer, audience, metadata_url, metadata_type, authorization_endpoint, token_endpoint, jwks_uri, metadata_digest, jwks_digest, challenge_hash, capability_max_lifetime_seconds, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'oidc', ?, ?, ?, ?, ?, ?, 3600, 1, 2)",
    ).bind("inspection-1", "cas_existing", "https://issuer.example", "audience", "https://issuer.example/metadata", "https://issuer.example/authorize", "https://issuer.example/token", "https://issuer.example/jwks", "metadata-digest", "jwks-digest", "challenge-hash").run();
    await database.prepare(
      "INSERT INTO cas_control_audit_events (event_id, stack_id, identity_issuer, subject, action, target, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("event-1", "cas_existing", "https://issuer.example", "operator", "stack.created", "cas_existing", 1).run();

    await migrateControlSchema(database);
    await migrateControlSchema(database);

    const columns = await database.prepare("PRAGMA table_info(cas_oauth_issuer_inspections)").all<{ name: string }>();
    expect(columns.results!.map(column => column.name)).toContain("app_id");
    expect(columns.results!.map(column => column.name)).not.toContain("stack_id");
    expect(await database.prepare(
      "SELECT inspection_id, app_id FROM cas_oauth_issuer_inspections",
    ).first()).toEqual({ inspection_id: "inspection-1", app_id: "cas_existing" });
    expect(await database.prepare(
      "SELECT event_id, app_id FROM cas_control_audit_events",
    ).first()).toEqual({ event_id: "event-1", app_id: "cas_existing" });
    expect(await database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'cas_oauth_inspections_by_app'",
    ).first()).toEqual({ name: "cas_oauth_inspections_by_app" });
    expect(await database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'cas_control_audit_by_app'",
    ).first()).toEqual({ name: "cas_control_audit_by_app" });
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
      "cas_app_managed_issuers",
      "cas_playground_file_roots",
    ]) expect(names.has(expected), `missing table ${expected}`).toBe(true);
    for (const legacy of [
      "cas_stacks",
      "cas_stack_members",
      "cas_stack_member_invitations",
      "cas_stack_oauth_issuers",
      "cas_stack_managed_issuers",
    ]) expect(names.has(legacy), `unexpected table ${legacy}`).toBe(false);

    for (const table of [
      "cas_apps",
      "cas_app_members",
      "cas_app_member_invitations",
      "cas_app_oauth_issuers",
      "cas_app_managed_issuers",
      "cas_playground_file_roots",
      "cas_oauth_issuer_inspections",
      "cas_control_audit_events",
    ]) {
      const columns = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(columns.results!.map((column) => column.name), table).toContain("app_id");
      expect(columns.results!.map((column) => column.name), table).not.toContain("stack_id");
    }
  });

  test("preserves configured managed capability lifetimes", async () => {
    const database = await createDb();
    await migrateControlSchema(database);
    const insert = `INSERT INTO cas_app_managed_issuers
      (app_id, issuer, audience, metadata_url, authorization_endpoint, token_endpoint, jwks_uri, status, verified_at, jwks_digest, capability_max_lifetime_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, 'digest', ?)`;
    await database.prepare(insert).bind("cas_custom", "https://issuer.example/custom", "https://cas.example/custom", "https://issuer.example/custom/metadata", "https://issuer.example/custom/authorize", "https://issuer.example/custom/token", "https://issuer.example/custom/jwks", 600).run();

    await migrateControlSchema(database);

    expect(await database.prepare(
      "SELECT app_id, capability_max_lifetime_seconds, revision FROM cas_app_managed_issuers",
    ).first()).toEqual({ app_id: "cas_custom", capability_max_lifetime_seconds: 600, revision: 1 });
  });
});

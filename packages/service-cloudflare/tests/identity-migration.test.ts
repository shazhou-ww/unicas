import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { managedPlaygroundOwnerKey } from "@unicas/service";
import { migrateControlSchema } from "../src/control-schema.js";
import {
  IdentityMigrationError,
  migrateLegacyAdminIdentities,
} from "../src/identity-migration.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

async function createDb() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "identity-migration-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "identity-migration-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "identity-migration-test");
  await migrateControlSchema(db);
  return db;
}

describe("legacy administrator identity migration", () => {
  test("maps identities one-to-one without merging duplicate display emails and is restartable", async () => {
    const db = await createDb();
    const issuer = "https://accounts.google.com";
    await db.prepare(
      "INSERT INTO cas_operator_identities (identity_issuer, subject, display_name, email_for_display, created_at) VALUES (?, 'alice', 'Alice', 'shared@example.com', 10), (?, 'bob', 'Bob', 'shared@example.com', 20)",
    ).bind(issuer, issuer).run();
    await db.prepare(
      "INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('alice-ref', ?, 'alice', 'active', 1, 0, 1, 10, 11), ('bob-ref', ?, 'bob', 'blocked', 0, 1, 1, 20, 21)",
    ).bind(issuer, issuer).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at) VALUES ('cas_app', ?, 'alice', 12), ('cas_app', ?, 'bob', 22)",
    ).bind(issuer, issuer).run();
    await db.prepare(
      "INSERT INTO cas_control_audit_events (event_id, app_id, identity_issuer, subject, action, target, created_at) VALUES ('control-event', 'cas_app', ?, 'alice', 'app.updated', 'cas_app', 30)",
    ).bind(issuer).run();
    await db.prepare(
      "INSERT INTO cas_platform_audit_events (event_id, actor_issuer, actor_subject, target_issuer, target_subject, action, result, created_at) VALUES ('platform-event', ?, 'alice', ?, 'bob', 'platform_access.authority_changed', 'succeeded', 31)",
    ).bind(issuer, issuer).run();
    const ownerKey = await managedPlaygroundOwnerKey("cas_app", { identityIssuer: issuer, subject: "alice" });
    await db.prepare(
      "INSERT INTO cas_playground_file_roots (app_id, owner_key, root_id, name, manifest_hash, revision, created_at, updated_at) VALUES ('cas_app', ?, 'root-1', 'file.txt', ?, 1, 40, 40)",
    ).bind(ownerKey, "a".repeat(64)).run();
    const controlAuditBefore = await db.prepare(
      "SELECT event_id, app_id, identity_issuer, subject, action, target, created_at FROM cas_control_audit_events",
    ).first();
    const platformAuditBefore = await db.prepare(
      "SELECT event_id, actor_issuer, actor_subject, target_issuer, target_subject, action, result, created_at FROM cas_platform_audit_events",
    ).first();

    const first = await migrateLegacyAdminIdentities(db, { now: () => 1000 });
    const second = await migrateLegacyAdminIdentities(db, { now: () => 2000 });
    expect(first.failures).toEqual([]);
    expect(second).toEqual(first);
    expect(first.counts).toMatchObject({
      sourceIdentities: 2,
      mappedIdentities: 2,
      distinctMappedAccounts: 2,
      expectedAuthorities: 2,
      mappedAuthorities: 2,
      appMemberships: 2,
      mappedAppMemberships: 2,
      playgroundRoots: 1,
      mappedPlaygroundRoots: 1,
    });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count, COUNT(DISTINCT account_id) AS distinct_accounts, COUNT(primary_verified_email) AS emails FROM cas_accounts",
    ).first()).toEqual({ count: 2, distinct_accounts: 2, emails: 0 });
    expect(await db.prepare(
      "SELECT blocked_at FROM cas_accounts JOIN cas_identity_migration_map USING(account_id) WHERE subject = 'bob'",
    ).first()).toEqual({ blocked_at: 21 });
    expect(await db.prepare(
      "SELECT COUNT(DISTINCT account_id) AS count FROM cas_operator_identities WHERE account_id IS NOT NULL",
    ).first()).toEqual({ count: 2 });
    expect(await db.prepare(
      "SELECT account_id FROM cas_playground_file_roots WHERE root_id = 'root-1'",
    ).first()).toEqual(await db.prepare(
      "SELECT account_id FROM cas_identity_migration_map WHERE subject = 'alice'",
    ).first());
    expect(await db.prepare(
      "SELECT event_id, app_id, identity_issuer, subject, action, target, created_at FROM cas_control_audit_events",
    ).first()).toEqual(controlAuditBefore);
    expect(await db.prepare(
      "SELECT event_id, actor_issuer, actor_subject, target_issuer, target_subject, action, result, created_at FROM cas_platform_audit_events",
    ).first()).toEqual(platformAuditBefore);
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_identity_migration_journal WHERE failure_count = 0",
    ).first()).toEqual({ count: 6 });
  });

  test("records and rejects an unmapped Playground owner", async () => {
    const db = await createDb();
    await db.prepare(
      "INSERT INTO cas_operator_identities (identity_issuer, subject, display_name, email_for_display, created_at) VALUES ('https://accounts.google.com', 'alice', 'Alice', NULL, 10)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_playground_file_roots (app_id, owner_key, root_id, name, manifest_hash, revision, created_at, updated_at) VALUES ('cas_app', 'not-a-derived-owner', 'root-1', 'file.txt', ?, 1, 40, 40)",
    ).bind("a".repeat(64)).run();

    await expect(migrateLegacyAdminIdentities(db, { now: () => 1000 }))
      .rejects.toBeInstanceOf(IdentityMigrationError);
    expect(await db.prepare(
      "SELECT source_count, mapped_count, failure_count FROM cas_identity_migration_journal WHERE stage = 'playground-ownership'",
    ).first()).toEqual({ source_count: 1, mapped_count: 0, failure_count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_identity_migration_map").first())
      .toEqual({ count: 1 });
  });
});
import type { D1Database } from "@cloudflare/workers-types";
import type { AccountId, ProviderKind } from "@unicas/admin-protocol";
import {
  generateAccountId,
  generateExternalIdentityId,
  managedPlaygroundOwnerKey,
} from "@unicas/service";

interface LegacyIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly firstSeenAt: number;
}

interface MigrationMapRow {
  identity_issuer: string;
  subject: string;
  account_id: AccountId;
  external_identity_id: string;
}

export interface IdentityMigrationCounts {
  readonly sourceIdentities: number;
  readonly mappedIdentities: number;
  readonly distinctMappedAccounts: number;
  readonly externalIdentities: number;
  readonly platformPrincipals: number;
  readonly mappedPlatformPrincipals: number;
  readonly expectedAuthorities: number;
  readonly mappedAuthorities: number;
  readonly appMemberships: number;
  readonly mappedAppMemberships: number;
  readonly playgroundRoots: number;
  readonly mappedPlaygroundRoots: number;
}

export interface IdentityMigrationReport {
  readonly counts: IdentityMigrationCounts;
  readonly failures: readonly string[];
}

export class IdentityMigrationError extends Error {
  constructor(readonly report: IdentityMigrationReport) {
    super("Legacy identity migration reconciliation failed");
    this.name = "IdentityMigrationError";
  }
}

export async function migrateLegacyAdminIdentities(
  db: D1Database,
  options: {
    readonly now?: () => number;
    readonly legacyProvider?: ProviderKind;
  } = {},
): Promise<IdentityMigrationReport> {
  const now = options.now ?? Date.now;
  const provider = options.legacyProvider ?? "google";
  const completedAt = now();
  const identities = await collectLegacyIdentities(db, completedAt);
  await recordStage(db, "account-schema", 0, 0, 0, completedAt);

  let identityFailures = 0;
  for (const identity of identities) {
    const existing = await readMigrationMap(db, identity.issuer, identity.subject);
    if (existing) continue;
    const accountId = generateAccountId();
    const externalIdentityId = generateExternalIdentityId();
    const profile = await db.prepare(
      "SELECT display_name FROM cas_operator_identities WHERE identity_issuer = ? AND subject = ?",
    ).bind(identity.issuer, identity.subject).first<{ display_name: string | null }>();
    const platform = await db.prepare(
      "SELECT status, updated_at FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ?",
    ).bind(identity.issuer, identity.subject).first<{ status: "active" | "blocked"; updated_at: number }>();
    try {
      await db.batch([
        db.prepare(
          "INSERT INTO cas_accounts (account_id, blocked_at, credential_version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
        ).bind(
          accountId,
          platform?.status === "blocked" ? platform.updated_at : null,
          identity.firstSeenAt,
          Math.max(identity.firstSeenAt, platform?.updated_at ?? identity.firstSeenAt),
        ),
        db.prepare(
          "INSERT INTO cas_account_profiles (account_id, display_name, avatar_url, display_name_source, avatar_source, updated_at) VALUES (?, ?, NULL, ?, NULL, ?)",
        ).bind(accountId, profile?.display_name ?? null, profile?.display_name ? externalIdentityId : null, completedAt),
        db.prepare(
          "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at, last_authenticated_at, unlinked_at, display_name) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
        ).bind(externalIdentityId, accountId, provider, identity.issuer, identity.subject, identity.firstSeenAt, profile?.display_name ?? null),
        db.prepare(
          "INSERT INTO cas_identity_migration_map (identity_issuer, subject, account_id, external_identity_id, created_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(identity.issuer, identity.subject, accountId, externalIdentityId, completedAt),
      ]);
    } catch (error) {
      if (await readMigrationMap(db, identity.issuer, identity.subject)) continue;
      identityFailures += 1;
    }
  }
  const mappedIdentities = await count(db, "SELECT COUNT(*) AS count FROM cas_identity_migration_map");
  await recordStage(db, "identity-map", identities.length, mappedIdentities, identityFailures, completedAt);
  if (identityFailures > 0) {
    const report = await reconcileLegacyAdminIdentities(db, identities);
    throw new IdentityMigrationError({ ...report, failures: [...report.failures, "identity-map-write-failed"] });
  }

  await backfillRelationships(db);
  const relationshipSource = await count(db, "SELECT (SELECT COUNT(*) FROM cas_platform_principals) + (SELECT COUNT(*) FROM cas_app_members) AS count");
  const relationshipMapped = await count(db, "SELECT (SELECT COUNT(*) FROM cas_platform_principals WHERE account_id IS NOT NULL) + (SELECT COUNT(*) FROM cas_app_members WHERE account_id IS NOT NULL) AS count");
  await recordStage(db, "account-relationships", relationshipSource, relationshipMapped, relationshipSource - relationshipMapped, completedAt);

  const playground = await backfillPlaygroundRoots(db);
  await recordStage(db, "playground-ownership", playground.source, playground.mapped, playground.failures, completedAt);

  const auditSource = await count(db, `SELECT
    (SELECT COUNT(*) FROM cas_control_audit_events)
    + (SELECT COUNT(*) FROM cas_platform_audit_events) AS count`);
  const auditMapped = await count(db, `SELECT
    (SELECT COUNT(*) FROM cas_control_audit_events AS event
      WHERE event.original_account_id IS NOT NULL AND event.external_identity_id IS NOT NULL)
    + (SELECT COUNT(*) FROM cas_platform_audit_events AS event
      WHERE event.actor_account_id IS NOT NULL AND event.actor_external_identity_id IS NOT NULL
      AND (event.target_issuer IS NULL OR (event.target_account_id IS NOT NULL
        AND event.target_external_identity_id IS NOT NULL))) AS count`);
  await recordStage(db, "audit-resolution", auditSource, auditMapped, auditSource - auditMapped, completedAt);

  const report = await reconcileLegacyAdminIdentities(db, identities);
  await recordStage(
    db,
    "account-reconciliation",
    report.counts.sourceIdentities,
    report.counts.mappedIdentities,
    report.failures.length,
    completedAt,
  );
  if (report.failures.length > 0) throw new IdentityMigrationError(report);
  return report;
}

export async function reconcileLegacyAdminIdentities(
  db: D1Database,
  knownIdentities?: readonly LegacyIdentity[],
): Promise<IdentityMigrationReport> {
  const identities = knownIdentities ?? await collectLegacyIdentities(db, Date.now());
  const counts: IdentityMigrationCounts = {
    sourceIdentities: identities.length,
    mappedIdentities: await count(db, "SELECT COUNT(*) AS count FROM cas_identity_migration_map"),
    distinctMappedAccounts: await count(db, "SELECT COUNT(DISTINCT account_id) AS count FROM cas_identity_migration_map"),
    externalIdentities: await count(db, "SELECT COUNT(*) AS count FROM cas_external_identities WHERE unlinked_at IS NULL"),
    platformPrincipals: await count(db, "SELECT COUNT(*) AS count FROM cas_platform_principals"),
    mappedPlatformPrincipals: await count(db, "SELECT COUNT(*) AS count FROM cas_platform_principals WHERE account_id IS NOT NULL"),
    expectedAuthorities: await count(db, "SELECT COALESCE(SUM(platform_admin + apps_create), 0) AS count FROM cas_platform_principals"),
    mappedAuthorities: await count(db, "SELECT COUNT(*) AS count FROM cas_account_platform_authorities"),
    appMemberships: await count(db, "SELECT COUNT(*) AS count FROM cas_app_members"),
    mappedAppMemberships: await count(db, "SELECT COUNT(*) AS count FROM cas_app_members WHERE account_id IS NOT NULL"),
    playgroundRoots: await count(db, "SELECT COUNT(*) AS count FROM cas_playground_file_roots"),
    mappedPlaygroundRoots: await count(db, "SELECT COUNT(*) AS count FROM cas_playground_file_roots WHERE account_id IS NOT NULL"),
  };
  const failures: string[] = [];
  if (counts.sourceIdentities !== counts.mappedIdentities) failures.push("identity-count-mismatch");
  if (counts.mappedIdentities !== counts.distinctMappedAccounts) failures.push("account-map-not-one-to-one");
  if (counts.mappedIdentities !== counts.externalIdentities) failures.push("external-identity-count-mismatch");
  if (counts.platformPrincipals !== counts.mappedPlatformPrincipals) failures.push("platform-principal-unmapped");
  if (counts.expectedAuthorities !== counts.mappedAuthorities) failures.push("platform-authority-count-mismatch");
  if (counts.appMemberships !== counts.mappedAppMemberships) failures.push("app-membership-unmapped");
  if (counts.playgroundRoots !== counts.mappedPlaygroundRoots) failures.push("playground-owner-unmapped");
  return { counts, failures };
}

async function collectLegacyIdentities(db: D1Database, fallbackTime: number): Promise<readonly LegacyIdentity[]> {
  const identities = new Map<string, LegacyIdentity>();
  const sources: readonly { readonly sql: string; readonly time: string | null }[] = [
    { sql: "SELECT identity_issuer AS issuer, subject, created_at AS source_time FROM cas_operator_identities", time: "source_time" },
    { sql: "SELECT identity_issuer AS issuer, subject, created_at AS source_time FROM cas_platform_principals", time: "source_time" },
    { sql: "SELECT identity_issuer AS issuer, subject, joined_at AS source_time FROM cas_app_members", time: "source_time" },
    { sql: "SELECT identity_issuer AS issuer, subject, created_at AS source_time FROM cas_control_audit_events", time: "source_time" },
    { sql: "SELECT actor_issuer AS issuer, actor_subject AS subject, created_at AS source_time FROM cas_platform_audit_events", time: "source_time" },
    { sql: "SELECT target_issuer AS issuer, target_subject AS subject, created_at AS source_time FROM cas_platform_audit_events WHERE target_issuer IS NOT NULL AND target_subject IS NOT NULL", time: "source_time" },
    { sql: "SELECT created_by_issuer AS issuer, created_by_subject AS subject, created_at AS source_time FROM cas_platform_invitations", time: "source_time" },
    { sql: "SELECT actor_issuer AS issuer, actor_subject AS subject, NULL AS source_time FROM cas_platform_invitation_idempotency", time: null },
    { sql: "SELECT identity_issuer AS issuer, subject, created_at AS source_time FROM cas_control_idempotency", time: "source_time" },
  ];
  for (const source of sources) {
    const rows = await db.prepare(source.sql).all<{ issuer: string; subject: string; source_time: number | null }>();
    for (const row of rows.results ?? []) {
      const key = `${row.issuer}\0${row.subject}`;
      const firstSeenAt = source.time === null || row.source_time === null ? fallbackTime : row.source_time;
      const current = identities.get(key);
      if (!current || firstSeenAt < current.firstSeenAt) {
        identities.set(key, { issuer: row.issuer, subject: row.subject, firstSeenAt });
      }
    }
  }
  return [...identities.values()].sort((left, right) =>
    left.issuer.localeCompare(right.issuer) || left.subject.localeCompare(right.subject));
}

async function backfillRelationships(db: D1Database): Promise<void> {
  await db.prepare(`UPDATE cas_operator_identities SET account_id = (
    SELECT account_id FROM cas_identity_migration_map AS map
    WHERE map.identity_issuer = cas_operator_identities.identity_issuer AND map.subject = cas_operator_identities.subject)
    WHERE account_id IS NULL`).run();
  await db.prepare(`UPDATE cas_platform_principals SET account_id = (
    SELECT account_id FROM cas_identity_migration_map AS map
    WHERE map.identity_issuer = cas_platform_principals.identity_issuer AND map.subject = cas_platform_principals.subject)
    WHERE account_id IS NULL`).run();
  await db.prepare(`UPDATE cas_app_members SET account_id = (
    SELECT account_id FROM cas_identity_migration_map AS map
    WHERE map.identity_issuer = cas_app_members.identity_issuer AND map.subject = cas_app_members.subject)
    WHERE account_id IS NULL`).run();
  await db.prepare(`UPDATE cas_platform_invitations SET created_by_account_id = (
    SELECT account_id FROM cas_identity_migration_map AS map
    WHERE map.identity_issuer = cas_platform_invitations.created_by_issuer AND map.subject = cas_platform_invitations.created_by_subject)
    WHERE created_by_account_id IS NULL`).run();
  await db.prepare(`UPDATE cas_platform_invitation_idempotency SET actor_account_id = (
    SELECT account_id FROM cas_identity_migration_map AS map
    WHERE map.identity_issuer = cas_platform_invitation_idempotency.actor_issuer AND map.subject = cas_platform_invitation_idempotency.actor_subject)
    WHERE actor_account_id IS NULL`).run();
  await db.prepare(`UPDATE cas_control_idempotency SET account_id = (
    SELECT account_id FROM cas_identity_migration_map AS map
    WHERE map.identity_issuer = cas_control_idempotency.identity_issuer AND map.subject = cas_control_idempotency.subject)
    WHERE account_id IS NULL`).run();
  await db.prepare(`UPDATE cas_control_audit_events SET
      original_account_id = COALESCE(original_account_id, (
        SELECT account_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer = cas_control_audit_events.identity_issuer
          AND map.subject = cas_control_audit_events.subject)),
      external_identity_id = COALESCE(external_identity_id, (
        SELECT external_identity_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer = cas_control_audit_events.identity_issuer
          AND map.subject = cas_control_audit_events.subject)),
      target_account_id = COALESCE(target_account_id, (
        SELECT account_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer || ':' || map.subject = cas_control_audit_events.target))`).run();
  await db.prepare(`UPDATE cas_platform_audit_events SET
      actor_account_id = COALESCE(actor_account_id, (
        SELECT account_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer = cas_platform_audit_events.actor_issuer
          AND map.subject = cas_platform_audit_events.actor_subject)),
      actor_external_identity_id = COALESCE(actor_external_identity_id, (
        SELECT external_identity_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer = cas_platform_audit_events.actor_issuer
          AND map.subject = cas_platform_audit_events.actor_subject)),
      target_account_id = COALESCE(target_account_id, (
        SELECT account_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer = cas_platform_audit_events.target_issuer
          AND map.subject = cas_platform_audit_events.target_subject)),
      target_external_identity_id = COALESCE(target_external_identity_id, (
        SELECT external_identity_id FROM cas_identity_migration_map AS map
        WHERE map.identity_issuer = cas_platform_audit_events.target_issuer
          AND map.subject = cas_platform_audit_events.target_subject))`).run();
  await db.prepare(`INSERT OR IGNORE INTO cas_account_platform_authorities (account_id, authority, granted_at)
    SELECT map.account_id, 'platform.admin', principal.created_at
    FROM cas_platform_principals AS principal JOIN cas_identity_migration_map AS map
      ON map.identity_issuer = principal.identity_issuer AND map.subject = principal.subject
    WHERE principal.platform_admin = 1`).run();
  await db.prepare(`INSERT OR IGNORE INTO cas_account_platform_authorities (account_id, authority, granted_at)
    SELECT map.account_id, 'apps.create', principal.created_at
    FROM cas_platform_principals AS principal JOIN cas_identity_migration_map AS map
      ON map.identity_issuer = principal.identity_issuer AND map.subject = principal.subject
    WHERE principal.apps_create = 1`).run();
}

async function backfillPlaygroundRoots(db: D1Database): Promise<{ source: number; mapped: number; failures: number }> {
  const roots = await db.prepare(
    "SELECT app_id, owner_key, root_id, account_id FROM cas_playground_file_roots",
  ).all<{ app_id: string; owner_key: string; root_id: string; account_id: AccountId | null }>();
  const maps = await db.prepare(
    "SELECT identity_issuer, subject, account_id, external_identity_id FROM cas_identity_migration_map",
  ).all<MigrationMapRow>();
  let failures = 0;
  for (const root of roots.results ?? []) {
    const candidates: AccountId[] = [];
    for (const map of maps.results ?? []) {
      const ownerKey = await managedPlaygroundOwnerKey(root.app_id, {
        identityIssuer: map.identity_issuer,
        subject: map.subject,
      });
      if (ownerKey === root.owner_key) candidates.push(map.account_id);
    }
    if (candidates.length !== 1 || (root.account_id !== null && root.account_id !== candidates[0])) {
      failures += 1;
      continue;
    }
    if (root.account_id === null) {
      await db.prepare(
        "UPDATE cas_playground_file_roots SET account_id = ? WHERE app_id = ? AND owner_key = ? AND root_id = ? AND account_id IS NULL",
      ).bind(candidates[0], root.app_id, root.owner_key, root.root_id).run();
    }
  }
  return {
    source: roots.results?.length ?? 0,
    mapped: await count(db, "SELECT COUNT(*) AS count FROM cas_playground_file_roots WHERE account_id IS NOT NULL"),
    failures,
  };
}

async function readMigrationMap(db: D1Database, issuer: string, subject: string): Promise<MigrationMapRow | null> {
  return db.prepare(
    "SELECT identity_issuer, subject, account_id, external_identity_id FROM cas_identity_migration_map WHERE identity_issuer = ? AND subject = ?",
  ).bind(issuer, subject).first<MigrationMapRow>();
}

async function count(db: D1Database, sql: string): Promise<number> {
  return (await db.prepare(sql).first<{ count: number }>())?.count ?? 0;
}

async function recordStage(
  db: D1Database,
  stage: string,
  sourceCount: number,
  mappedCount: number,
  failureCount: number,
  completedAt: number,
): Promise<void> {
  await db.prepare(`INSERT INTO cas_identity_migration_journal
    (stage, source_count, mapped_count, failure_count, completed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(stage) DO UPDATE SET source_count = excluded.source_count,
      mapped_count = excluded.mapped_count, failure_count = excluded.failure_count,
      completed_at = excluded.completed_at`)
    .bind(stage, sourceCount, mappedCount, failureCount, completedAt)
    .run();
}
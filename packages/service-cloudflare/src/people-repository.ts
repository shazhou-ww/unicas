import type { D1Database } from "@cloudflare/workers-types";
import { projectAccountSummary, type PeopleEntry, type PeopleRepository, type PeopleScope } from "@unicas/service";
import type { AccountId, AppPerson, PlatformPerson, PrimaryVerifiedEmail } from "@unicas/admin-protocol";

const authorities = "json(CASE WHEN platform_admin = 1 AND apps_create = 1 THEN '[\"platform.admin\",\"apps.create\"]' WHEN platform_admin = 1 THEN '[\"platform.admin\"]' WHEN apps_create = 1 THEN '[\"apps.create\"]' ELSE '[]' END)";
const appMembers = `SELECT 'member:' || hex(account_id) AS row_key, joined_at AS row_time,
  'member' AS kind, 'member' AS state, 0 AS platform_admin, 0 AS apps_create, NULL AS effective,
  COALESCE(display_name, '') || ' ' || COALESCE(primary_verified_email, '') || ' ' || account_id AS search,
  json_object('kind', 'member', 'joinedAt', joined_at, 'membership', json_object(
    'appId', app_id, 'account', json_object('accountId', account_id, 'displayName', display_name,
      'primaryVerifiedEmail', primary_verified_email, 'emailVerificationSource', email_verification_source,
      'emailVerifiedAt', email_verified_at, 'avatarUrl', avatar_url))) AS payload
  FROM (SELECT member.app_id, member.account_id, member.joined_at,
      account.primary_verified_email, account.email_verification_source, account.email_verified_at,
      profile.display_name, profile.avatar_url
    FROM cas_app_members member
    JOIN cas_accounts account ON account.account_id = member.account_id
    JOIN cas_account_profiles profile ON profile.account_id = member.account_id
    WHERE member.app_id = ?)`;
const appInvitations = `SELECT 'invitation:' || hex(invitation_id), created_at, 'invitation',
  CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END,
  0, 0, NULL, COALESCE(email_constraint, ''),
  json_object('kind', 'invitation', 'invitation', json_object('appId', app_id, 'invitationId', invitation_id,
    'status', CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END,
    'emailConstraint', email_constraint, 'expiresAt', expires_at, 'createdAt', created_at, 'revision', revision))
  FROM cas_app_member_invitations WHERE app_id = ?`;
const platformAccounts = `SELECT 'account:' || hex(account_id) AS row_key, created_at AS row_time,
  'account' AS kind, CASE WHEN blocked_at IS NULL THEN 'active' ELSE 'blocked' END AS state,
  platform_admin, apps_create,
  CASE WHEN blocked_at IS NOT NULL THEN 'blocked' WHEN platform_admin = 1 OR apps_create = 1 OR membership_count > 0 THEN 'active' ELSE 'no_access' END AS effective,
  COALESCE(display_name, '') || ' ' || COALESCE(primary_verified_email, '') || ' ' || account_id AS search,
  json_object('kind', 'account', 'account', json_object('accountId', account_id,
    'displayName', display_name, 'primaryVerifiedEmail', primary_verified_email,
    'emailVerificationSource', email_verification_source, 'emailVerifiedAt', email_verified_at,
    'avatarUrl', avatar_url, 'blockedAt', blocked_at, 'platformAuthorities', ${authorities},
    'createdAt', created_at, 'updatedAt', updated_at, 'appMembershipCount', membership_count,
    'lastActiveAt', last_active_at,
    'effectiveAccess', CASE WHEN blocked_at IS NOT NULL THEN 'blocked' WHEN platform_admin = 1 OR apps_create = 1 OR membership_count > 0 THEN 'active' ELSE 'no_access' END)) AS payload
  FROM (SELECT account.*, profile.display_name, profile.avatar_url,
    EXISTS (SELECT 1 FROM cas_account_platform_authorities authority WHERE authority.account_id = account.account_id AND authority.authority = 'platform.admin') AS platform_admin,
    EXISTS (SELECT 1 FROM cas_account_platform_authorities authority WHERE authority.account_id = account.account_id AND authority.authority = 'apps.create') AS apps_create,
    (SELECT COUNT(*) FROM cas_app_members member WHERE member.account_id = account.account_id) AS membership_count,
    NULLIF(MAX(
      COALESCE((SELECT MAX(event.created_at) FROM cas_control_audit_events event WHERE event.original_account_id = account.account_id), 0),
      COALESCE((SELECT MAX(event.created_at) FROM cas_platform_audit_events event WHERE event.actor_account_id = account.account_id), 0)
    ), 0) AS last_active_at
    FROM cas_accounts account JOIN cas_account_profiles profile ON profile.account_id = account.account_id)`;
const platformInvitations = `SELECT 'invitation:' || hex(invitation_id), created_at, 'invitation',
  CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END,
  platform_admin, apps_create, NULL, email_constraint,
  json_object('kind', 'invitation', 'invitation', json_object('invitationId', invitation_id,
    'status', CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END,
    'emailConstraint', email_constraint, 'authorities', ${authorities}, 'expiresAt', expires_at,
    'createdAt', created_at, 'revision', revision))
  FROM cas_platform_invitations`;

export class D1PeopleRepository implements PeopleRepository {
  constructor(readonly db: D1Database) { }

  async readSnapshot(): Promise<number> {
    const row = await this.db.prepare("SELECT value FROM cas_control_meta WHERE key = 'snapshot'").first<{ value: number }>();
    return row?.value ?? 0;
  }

  async nextExpiry(scope: PeopleScope, now: number): Promise<number | null> {
    const app = "appId" in scope;
    const row = await this.db.prepare(`SELECT MIN(expires_at) AS expiry FROM ${app ? "cas_app_member_invitations" : "cas_platform_invitations"} WHERE status = 'pending' AND expires_at > ?${app ? " AND app_id = ?" : ""}`)
      .bind(now, ...(app ? [scope.appId] : [])).first<{ expiry: number | null }>();
    return row?.expiry ?? null;
  }

  async list(input: Parameters<PeopleRepository["list"]>[0]): Promise<readonly PeopleEntry[]> {
    const { scope, query, now, after, limit } = input;
    const app = "appId" in scope;
    const bindings: (string | number)[] = app ? [scope.appId, now, now, scope.appId] : [now, now];
    const conditions: string[] = [];
    switch (query.filter ?? "current") {
      case "current": conditions.push("(kind != 'invitation' OR state = 'pending')"); break;
      case "members": conditions.push("kind = 'member'"); break;
      case "accounts": conditions.push("kind = 'account'"); break;
      case "pending": conditions.push("kind = 'invitation' AND state = 'pending'"); break;
      case "history": conditions.push("kind = 'invitation' AND state != 'pending'"); break;
    }
    if (query.query) { conditions.push("instr(lower(search), ?) > 0"); bindings.push(query.query); }
    if ("authority" in query && query.authority) {
      conditions.push(query.authority === "none" ? "platform_admin = 0 AND apps_create = 0" : query.authority === "platform.admin" ? "platform_admin = 1" : "apps_create = 1");
    }
    if ("effectiveAccess" in query && query.effectiveAccess) {
      conditions.push("kind = 'account' AND effective = ?"); bindings.push(query.effectiveAccess);
    }
    if (after) {
      conditions.push("(row_time < ? OR (row_time = ? AND row_key > ?))");
      bindings.push(after.time, after.time, after.key);
    }
    bindings.push(limit);
    const rows = await this.db.prepare(`WITH people AS (${app ? appMembers : platformAccounts} UNION ALL ${app ? appInvitations : platformInvitations})
      SELECT row_key, row_time, payload FROM people WHERE ${conditions.join(" AND ")} ORDER BY row_time DESC, row_key ASC LIMIT ?`)
      .bind(...bindings).all<{ row_key: string; row_time: number; payload: string }>();
    return (rows.results ?? []).map(row => ({ key: row.row_key, time: row.row_time, item: peopleItem(row.payload) }));
  }
}

interface RawAccountMembership {
  readonly appId: string;
  readonly account: {
    readonly accountId: AccountId;
    readonly displayName: string | null;
    readonly primaryVerifiedEmail: string | null;
    readonly emailVerificationSource: PrimaryVerifiedEmail["source"] | null;
    readonly emailVerifiedAt: number | null;
    readonly avatarUrl: string | null;
  };
}

type RawPlatformAccount = RawAccountMembership["account"] & {
  readonly blockedAt: number | null;
  readonly platformAuthorities: readonly ("platform.admin" | "apps.create")[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly effectiveAccess: "active" | "blocked" | "no_access";
  readonly appMembershipCount: number;
  readonly lastActiveAt: number | null;
}

function peopleItem(payload: string): AppPerson | PlatformPerson {
  const parsed = JSON.parse(payload) as (AppPerson | PlatformPerson) & {
    membership?: RawAccountMembership;
    account?: RawPlatformAccount;
  };
  if (parsed.kind === "account" && parsed.account) {
    const raw = parsed.account;
    return {
      kind: "account",
      account: {
        ...projectAccountSummary(
          { accountId: raw.accountId, primaryVerifiedEmail: verifiedEmail(raw) },
          { displayName: raw.displayName, avatarUrl: raw.avatarUrl },
        ),
        blockedAt: raw.blockedAt,
        platformAuthorities: raw.platformAuthorities,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        effectiveAccess: raw.effectiveAccess,
        appMembershipCount: raw.appMembershipCount,
        lastActiveAt: raw.lastActiveAt,
      },
    };
  }
  if (parsed.kind !== "member" || !parsed.membership) return parsed;
  const raw = parsed.membership.account;
  return {
    kind: "member",
    joinedAt: parsed.joinedAt,
    membership: {
      appId: parsed.membership.appId,
      account: projectAccountSummary(
        { accountId: raw.accountId, primaryVerifiedEmail: verifiedEmail(raw) },
        { displayName: raw.displayName, avatarUrl: raw.avatarUrl },
      ),
    },
  };
}

function verifiedEmail(raw: RawAccountMembership["account"]): PrimaryVerifiedEmail | null {
  return raw.primaryVerifiedEmail !== null
    && raw.emailVerificationSource !== null
    && raw.emailVerifiedAt !== null
    ? {
      normalizedEmail: raw.primaryVerifiedEmail,
      source: raw.emailVerificationSource,
      verifiedAt: raw.emailVerifiedAt,
    }
    : null;
};
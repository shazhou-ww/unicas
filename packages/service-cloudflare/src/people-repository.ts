import type { D1Database } from "@cloudflare/workers-types";
import { projectAccountSummary, type PeopleEntry, type PeopleRepository, type PeopleScope } from "@unicas/service";
import type { AccountId, AppPerson, PlatformPerson, PrimaryVerifiedEmail } from "@unicas/admin-protocol";

const identity = "json_object('issuer', identity_issuer, 'subject', subject)";
const profile = "json_object('displayName', display_name, 'emailForDisplay', email_for_display)";
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
const platformPrincipals = `SELECT 'principal:' || hex(principal_ref) AS row_key, created_at AS row_time,
  'principal' AS kind, status AS state, platform_admin, apps_create,
  CASE WHEN status = 'blocked' THEN 'blocked' WHEN platform_admin = 1 OR apps_create = 1 OR membership_count > 0 THEN 'active' ELSE 'no_access' END AS effective,
  COALESCE(display_name, '') || ' ' || COALESCE(email_for_display, '') || ' ' || identity_issuer || ' ' || subject AS search,
  json_object('kind', 'principal', 'principal', json_object('principalRef', principal_ref, 'principal', ${identity},
    'profile', ${profile}, 'status', status, 'authorities', ${authorities}, 'revision', revision,
    'createdAt', created_at, 'updatedAt', updated_at, 'appMembershipCount', membership_count, 'lastActiveAt', last_active_at,
    'effectiveAccess', CASE WHEN status = 'blocked' THEN 'blocked' WHEN platform_admin = 1 OR apps_create = 1 OR membership_count > 0 THEN 'active' ELSE 'no_access' END)) AS payload
  FROM (SELECT access.*, profile.display_name, profile.email_for_display,
    (SELECT COUNT(*) FROM cas_app_members member WHERE member.identity_issuer = access.identity_issuer AND member.subject = access.subject) AS membership_count,
    (SELECT MAX(created_at) FROM cas_control_audit_events event WHERE event.identity_issuer = access.identity_issuer AND event.subject = access.subject) AS last_active_at
    FROM cas_platform_principals access LEFT JOIN cas_operator_identities profile USING(identity_issuer, subject))`;
const platformInvitations = `SELECT 'invitation:' || hex(invitation_id), created_at, 'invitation',
  CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END,
  platform_admin, apps_create, NULL, email_constraint,
  json_object('kind', 'invitation', 'invitation', json_object('invitationId', invitation_id,
    'status', CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END,
    'emailConstraint', email_constraint, 'authorities', ${authorities}, 'expiresAt', expires_at,
    'createdAt', created_at, 'createdBy', json_object('issuer', created_by_issuer, 'subject', created_by_subject), 'revision', revision))
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
      case "principals": conditions.push("kind = 'principal'"); break;
      case "pending": conditions.push("kind = 'invitation' AND state = 'pending'"); break;
      case "history": conditions.push("kind = 'invitation' AND state != 'pending'"); break;
    }
    if (query.query) { conditions.push("instr(lower(search), ?) > 0"); bindings.push(query.query); }
    if ("authority" in query && query.authority) {
      conditions.push(query.authority === "none" ? "platform_admin = 0 AND apps_create = 0" : query.authority === "platform.admin" ? "platform_admin = 1" : "apps_create = 1");
    }
    if ("effectiveAccess" in query && query.effectiveAccess) {
      conditions.push("kind = 'principal' AND effective = ?"); bindings.push(query.effectiveAccess);
    }
    if (after) {
      conditions.push("(row_time < ? OR (row_time = ? AND row_key > ?))");
      bindings.push(after.time, after.time, after.key);
    }
    bindings.push(limit);
    const rows = await this.db.prepare(`WITH people AS (${app ? appMembers : platformPrincipals} UNION ALL ${app ? appInvitations : platformInvitations})
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

function peopleItem(payload: string): AppPerson | PlatformPerson {
  const parsed = JSON.parse(payload) as (AppPerson | PlatformPerson) & {
    membership?: RawAccountMembership;
  };
  if (parsed.kind !== "member" || !parsed.membership) return parsed;
  const raw = parsed.membership.account;
  const primaryVerifiedEmail = raw.primaryVerifiedEmail !== null
    && raw.emailVerificationSource !== null
    && raw.emailVerifiedAt !== null
    ? {
      normalizedEmail: raw.primaryVerifiedEmail,
      source: raw.emailVerificationSource,
      verifiedAt: raw.emailVerifiedAt,
    }
    : null;
  return {
    kind: "member",
    joinedAt: parsed.joinedAt,
    membership: {
      appId: parsed.membership.appId,
      account: projectAccountSummary(
        { accountId: raw.accountId, primaryVerifiedEmail },
        { displayName: raw.displayName, avatarUrl: raw.avatarUrl },
      ),
    },
  };
}
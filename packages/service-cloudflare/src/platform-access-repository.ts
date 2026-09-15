import type { D1Database } from "@cloudflare/workers-types";
import { effectivePlatformAccess, type PlatformAccessState, type PlatformAuthority, type PlatformPrincipal, type Principal } from "@unicas/admin-protocol";
import type { PlatformAccessRepository, PlatformAuditRecord } from "@unicas/service";

interface PrincipalRow {
  principal_ref: string;
  identity_issuer: string;
  subject: string;
  status: "active" | "blocked";
  platform_admin: number;
  apps_create: number;
  revision: number;
  created_at: number;
  updated_at: number;
  display_name?: string | null;
  email_for_display?: string | null;
  membership_count?: number;
}

function accessState(row: PrincipalRow): PlatformAccessState {
  const authorities: PlatformAuthority[] = [];
  if (row.platform_admin === 1) authorities.push("platform.admin");
  if (row.apps_create === 1) authorities.push("apps.create");
  return { principalRef: row.principal_ref, principal: { issuer: row.identity_issuer, subject: row.subject }, status: row.status, authorities, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

const principalProjection = `SELECT access.*, profile.display_name, profile.email_for_display,
  (SELECT COUNT(*) FROM cas_app_members AS member WHERE member.identity_issuer = access.identity_issuer AND member.subject = access.subject) AS membership_count
  FROM cas_platform_principals AS access LEFT JOIN cas_operator_identities AS profile ON profile.identity_issuer = access.identity_issuer AND profile.subject = access.subject`;

function principalView(row: PrincipalRow): PlatformPrincipal {
  const state = accessState(row);
  const appMembershipCount = row.membership_count ?? 0;
  return { ...state, profile: { displayName: row.display_name ?? null, emailForDisplay: row.email_for_display ?? null }, appMembershipCount, effectiveAccess: effectivePlatformAccess(state, appMembershipCount > 0) };
}

export class D1PlatformAccessRepository implements PlatformAccessRepository {
  constructor(readonly db: D1Database) {}

  async getAccess(principal: Principal): Promise<PlatformAccessState | null> {
    const row = await this.db.prepare("SELECT * FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ?").bind(principal.issuer, principal.subject).first<PrincipalRow>();
    return row ? accessState(row) : null;
  }

  async hasMembership(principal: Principal): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS member FROM cas_app_members WHERE identity_issuer = ? AND subject = ? LIMIT 1").bind(principal.issuer, principal.subject).first()) !== null;
  }

  async getPrincipal(principalRef: string): Promise<PlatformPrincipal | null> {
    const row = await this.db.prepare(`${principalProjection} WHERE access.principal_ref = ?`).bind(principalRef).first<PrincipalRow>();
    return row ? principalView(row) : null;
  }

  async listPrincipals(input: { readonly after: string; readonly limit: number }): Promise<readonly PlatformPrincipal[]> {
    const rows = await this.db.prepare(`${principalProjection} WHERE access.principal_ref > ? ORDER BY access.principal_ref LIMIT ?`).bind(input.after, input.limit).all<PrincipalRow>();
    return (rows.results ?? []).map(principalView);
  }

  async appendAudit(event: PlatformAuditRecord): Promise<void> {
    await this.#audit(event).run();
  }

  async patchAccess(input: Parameters<PlatformAccessRepository["patchAccess"]>[0]): Promise<"updated" | "revision-mismatch" | "last-admin" | "forbidden"> {
    const platformAdmin = Number(input.authorities.includes("platform.admin"));
    const appCreator = Number(input.authorities.includes("apps.create"));
    const requireActor = this.db.prepare("SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ? AND status = 'active' AND platform_admin = 1) THEN 1 ELSE json_extract('invalid', '$') END AS authorized").bind(input.actor.issuer, input.actor.subject);
    const requireAdmin = this.db.prepare("SELECT CASE WHEN ? = 'active' AND ? = 1 OR NOT EXISTS (SELECT 1 FROM cas_platform_principals WHERE principal_ref = ? AND status = 'active' AND platform_admin = 1) OR (SELECT COUNT(*) FROM cas_platform_principals WHERE status = 'active' AND platform_admin = 1) > 1 THEN 1 ELSE json_extract('invalid', '$') END AS retained").bind(input.status, platformAdmin, input.current.principalRef);
    const update = this.db.prepare("UPDATE cas_platform_principals SET status = ?, platform_admin = ?, apps_create = ?, revision = revision + 1, updated_at = ? WHERE principal_ref = ? AND revision = ?").bind(input.status, platformAdmin, appCreator, input.audit.createdAt, input.current.principalRef, input.current.revision);
    const requireUpdated = this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS updated");
    try {
      await this.db.batch([requireActor, requireAdmin, update, requireUpdated, this.#audit(input.audit)]);
      return "updated";
    } catch (error) {
      if (!(error instanceof Error) || !/malformed JSON/i.test(error.message)) throw error;
      const actor = await this.getAccess(input.actor);
      if (actor?.status !== "active" || !actor.authorities.includes("platform.admin")) return "forbidden";
      const current = await this.getPrincipal(input.current.principalRef);
      if (!current || current.revision !== input.current.revision) return "revision-mismatch";
      return "last-admin";
    }
  }

  #audit(event: PlatformAuditRecord) {
    return this.db.prepare("INSERT INTO cas_platform_audit_events (event_id, actor_issuer, actor_subject, target_issuer, target_subject, action, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(event.eventId, event.actorPrincipal.issuer, event.actorPrincipal.subject, event.targetPrincipal?.issuer ?? null, event.targetPrincipal?.subject ?? null, event.action, event.result, event.createdAt);
  }
}
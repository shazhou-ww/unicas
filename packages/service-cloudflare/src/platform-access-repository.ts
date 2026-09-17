import type { D1Database } from "@cloudflare/workers-types";
import { effectivePlatformAccess, type AccountId, type PlatformAccessState, type PlatformAccessSummary, type PlatformAuditAction, type PlatformAuditEvent, type PlatformAuthority, type PlatformPrincipalDetail, type PlatformPrincipalListItem, type PrimaryVerifiedEmail, type Principal } from "@unicas/admin-protocol";
import type {
  PlatformAccessRepository,
  PlatformAuditRepository,
  PlatformAuditRecord,
  PlatformInvitationIdempotencyRecord,
  PlatformInvitationRepository,
  StoredPlatformInvitation,
} from "@unicas/service";
import { projectAccountSummary } from "@unicas/service";

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
  last_active_at?: number | null;
}

interface MembershipAccountRow {
  app_id: string;
  account_id: AccountId;
  primary_verified_email: string | null;
  email_verification_source: PrimaryVerifiedEmail["source"] | null;
  email_verified_at: number | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface AppInvitationAdmissionRow {
  invitation_id: string;
  app_id: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  email_constraint: string | null;
  expires_at: number;
}

interface PlatformInvitationRow {
  invitation_id: string;
  email_constraint: string;
  platform_admin: number;
  apps_create: number;
  status: "pending" | "accepted" | "expired" | "revoked";
  projected_status?: "pending" | "accepted" | "expired" | "revoked";
  token_hash: string;
  expires_at: number;
  created_at: number;
  created_by_issuer: string;
  created_by_subject: string;
  revision: number;
}

interface PlatformInvitationIdempotencyRow {
  actor_issuer: string;
  actor_subject: string;
  idempotency_key: string;
  payload_hash: string;
  invitation_id: string;
  sealed_token: string;
  expires_at: number;
}

interface PlatformAuditRow {
  event_id: string;
  actor_issuer: string;
  actor_subject: string;
  actor_principal_ref: string | null;
  target_issuer: string | null;
  target_subject: string | null;
  target_principal_ref: string | null;
  target_invitation_id: string | null;
  action: PlatformAuditAction;
  result: "succeeded" | "denied";
  request_id: string | null;
  created_at: number;
  details_json: string;
}

function accessState(row: PrincipalRow): PlatformAccessState {
  const authorities: PlatformAuthority[] = [];
  if (row.platform_admin === 1) authorities.push("platform.admin");
  if (row.apps_create === 1) authorities.push("apps.create");
  return { principalRef: row.principal_ref, principal: { issuer: row.identity_issuer, subject: row.subject }, status: row.status, authorities, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

const principalProjection = `SELECT access.*, profile.display_name, profile.email_for_display,
  (SELECT COUNT(*) FROM cas_app_members AS member WHERE member.identity_issuer = access.identity_issuer AND member.subject = access.subject) AS membership_count,
  (SELECT MAX(event.created_at) FROM cas_control_audit_events AS event WHERE event.identity_issuer = access.identity_issuer AND event.subject = access.subject) AS last_active_at
  FROM cas_platform_principals AS access LEFT JOIN cas_operator_identities AS profile ON profile.identity_issuer = access.identity_issuer AND profile.subject = access.subject`;

function principalView(row: PrincipalRow): PlatformPrincipalListItem {
  const state = accessState(row);
  const appMembershipCount = row.membership_count ?? 0;
  return { ...state, profile: { displayName: row.display_name ?? null, emailForDisplay: row.email_for_display ?? null }, appMembershipCount, effectiveAccess: effectivePlatformAccess(state, appMembershipCount > 0), lastActiveAt: row.last_active_at ?? null };
}

function platformInvitation(row: PlatformInvitationRow): StoredPlatformInvitation {
  const authorities: PlatformAuthority[] = [];
  if (row.platform_admin === 1) authorities.push("platform.admin");
  if (row.apps_create === 1) authorities.push("apps.create");
  return {
    invitationId: row.invitation_id,
    emailConstraint: row.email_constraint,
    authorities,
    status: row.projected_status ?? row.status,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdBy: { issuer: row.created_by_issuer, subject: row.created_by_subject },
    revision: row.revision,
  };
}

export class D1PlatformAccessRepository implements PlatformAccessRepository, PlatformInvitationRepository, PlatformAuditRepository {
  constructor(readonly db: D1Database) { }

  async readSnapshot(): Promise<number> {
    const row = await this.db.prepare("SELECT value FROM cas_control_meta WHERE key = 'snapshot'").first<{ value: number }>();
    return row?.value ?? 0;
  }

  async getAccess(principal: Principal): Promise<PlatformAccessState | null> {
    const row = await this.db.prepare("SELECT * FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ?").bind(principal.issuer, principal.subject).first<PrincipalRow>();
    return row ? accessState(row) : null;
  }

  async hasMembership(principal: Principal): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS member FROM cas_app_members WHERE identity_issuer = ? AND subject = ? LIMIT 1").bind(principal.issuer, principal.subject).first()) !== null;
  }

  async getAppInvitationByTokenHash(tokenHash: string) {
    const row = await this.db.prepare(
      "SELECT invitation_id, app_id, status, email_constraint, expires_at FROM cas_app_member_invitations WHERE token_hash = ?",
    ).bind(tokenHash).first<AppInvitationAdmissionRow>();
    return row ? {
      invitationId: row.invitation_id,
      appId: row.app_id,
      status: row.status,
      emailConstraint: row.email_constraint,
      expiresAt: row.expires_at,
    } : null;
  }

  async getInvitation(invitationId: string, now: number): Promise<StoredPlatformInvitation | null> {
    const row = await this.db.prepare(
      "SELECT *, CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS projected_status FROM cas_platform_invitations WHERE invitation_id = ?",
    ).bind(now, invitationId).first<PlatformInvitationRow>();
    return row ? platformInvitation(row) : null;
  }

  async getInvitationByTokenHash(tokenHash: string, now: number): Promise<StoredPlatformInvitation | null> {
    const row = await this.db.prepare(
      "SELECT *, CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS projected_status FROM cas_platform_invitations WHERE token_hash = ?",
    ).bind(now, tokenHash).first<PlatformInvitationRow>();
    return row ? platformInvitation(row) : null;
  }

  async listInvitations(input: Parameters<PlatformInvitationRepository["listInvitations"]>[0]): Promise<readonly StoredPlatformInvitation[]> {
    const rows = await this.db.prepare(
      `SELECT *, CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS projected_status
       FROM cas_platform_invitations
       WHERE invitation_id > ?
         AND (? IS NULL OR instr(email_constraint, ?) > 0)
         AND (? IS NULL OR (CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END) = ?)
       ORDER BY invitation_id LIMIT ?`,
    ).bind(
      input.now,
      input.afterInvitationId,
      input.query ?? null,
      input.query ?? null,
      input.status ?? null,
      input.now,
      input.status ?? null,
      input.limit,
    ).all<PlatformInvitationRow>();
    return (rows.results ?? []).map(platformInvitation);
  }

  async getInvitationIdempotency(
    input: Parameters<PlatformInvitationRepository["getInvitationIdempotency"]>[0],
  ): Promise<PlatformInvitationIdempotencyRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM cas_platform_invitation_idempotency WHERE actor_issuer = ? AND actor_subject = ? AND idempotency_key = ? AND expires_at > ?",
    ).bind(input.actor.issuer, input.actor.subject, input.key, input.now).first<PlatformInvitationIdempotencyRow>();
    return row ? {
      actor: { issuer: row.actor_issuer, subject: row.actor_subject },
      key: row.idempotency_key,
      payloadHash: row.payload_hash,
      invitationId: row.invitation_id,
      sealedToken: row.sealed_token,
      expiresAt: row.expires_at,
    } : null;
  }

  async commitCreateInvitation(
    input: Parameters<PlatformInvitationRepository["commitCreateInvitation"]>[0],
  ): Promise<"created" | "idempotency-conflict" | "forbidden"> {
    const invitation = input.invitation;
    const requireActor = this.#requirePlatformAdmin(input.actor);
    const insertInvitation = this.db.prepare(
      "INSERT INTO cas_platform_invitations (invitation_id, email_constraint, platform_admin, apps_create, status, token_hash, expires_at, created_at, created_by_issuer, created_by_subject, revision) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1)",
    ).bind(
      invitation.invitationId,
      invitation.emailConstraint,
      Number(invitation.authorities.includes("platform.admin")),
      Number(invitation.authorities.includes("apps.create")),
      invitation.tokenHash,
      invitation.expiresAt,
      invitation.createdAt,
      invitation.createdBy.issuer,
      invitation.createdBy.subject,
    );
    const insertIdempotency = this.db.prepare(
      "INSERT INTO cas_platform_invitation_idempotency (actor_issuer, actor_subject, idempotency_key, payload_hash, invitation_id, sealed_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      input.idempotency.actor.issuer,
      input.idempotency.actor.subject,
      input.idempotency.key,
      input.idempotency.payloadHash,
      input.idempotency.invitationId,
      input.idempotency.sealedToken,
      input.idempotency.expiresAt,
    );
    try {
      await this.db.batch([requireActor, insertInvitation, insertIdempotency, ...this.#snapshotStatements(), this.#audit(input.audit)]);
      return "created";
    } catch (error) {
      const actor = await this.getAccess(input.actor);
      if (actor?.status !== "active" || !actor.authorities.includes("platform.admin")) return "forbidden";
      const existing = await this.getInvitationIdempotency({
        actor: input.actor,
        key: input.idempotency.key,
        now: input.invitation.createdAt,
      });
      if (existing) return "idempotency-conflict";
      throw error;
    }
  }

  async commitRevokeInvitation(
    input: Parameters<PlatformInvitationRepository["commitRevokeInvitation"]>[0],
  ): Promise<"updated" | "revision-mismatch" | "not-found" | "not-pending" | "forbidden"> {
    const update = this.db.prepare(
      "UPDATE cas_platform_invitations SET status = 'revoked', revision = revision + 1 WHERE invitation_id = ? AND revision = ? AND status = 'pending' AND expires_at > ?",
    ).bind(input.invitationId, input.expectedRevision, input.now);
    const requireUpdated = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS updated",
    );
    try {
      await this.db.batch([this.#requirePlatformAdmin(input.actor), update, requireUpdated, ...this.#snapshotStatements(), this.#audit(input.audit)]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const actor = await this.getAccess(input.actor);
      if (actor?.status !== "active" || !actor.authorities.includes("platform.admin")) return "forbidden";
      const current = await this.getInvitation(input.invitationId, input.now);
      if (!current) return "not-found";
      if (current.revision !== input.expectedRevision) return "revision-mismatch";
      return "not-pending";
    }
  }

  async commitAcceptInvitation(
    input: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0],
  ): Promise<"accepted" | "not-pending" | "blocked"> {
    const requireNotBlocked = this.db.prepare(
      "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ? AND status = 'blocked') THEN 1 ELSE json_extract('invalid', '$') END AS allowed",
    ).bind(input.principal.issuer, input.principal.subject);
    const claim = this.db.prepare(
      "UPDATE cas_platform_invitations SET status = 'accepted', revision = revision + 1 WHERE invitation_id = ? AND token_hash = ? AND status = 'pending' AND expires_at > ?",
    ).bind(input.invitation.invitationId, input.tokenHash, input.now);
    const requireClaimed = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS claimed",
    );
    const synchronizeIdentity = this.db.prepare(
      `INSERT INTO cas_operator_identities
        (identity_issuer, subject, display_name, email_for_display, created_at, account_id)
       VALUES (?, ?, ?, ?, ?, (SELECT account_id FROM cas_external_identities
         WHERE issuer = ? AND subject = ? AND unlinked_at IS NULL))
       ON CONFLICT(identity_issuer, subject) DO UPDATE SET
         display_name = excluded.display_name,
         email_for_display = excluded.email_for_display,
         account_id = COALESCE(cas_operator_identities.account_id, excluded.account_id)`,
    ).bind(
      input.principal.issuer,
      input.principal.subject,
      input.profile.displayName,
      input.profile.emailForDisplay,
      input.now,
      input.principal.issuer,
      input.principal.subject,
    );
    const platformAdmin = Number(input.invitation.authorities.includes("platform.admin"));
    const appsCreate = Number(input.invitation.authorities.includes("apps.create"));
    const upsertAccess = this.db.prepare(
      `INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at, account_id)
       VALUES (?, ?, ?, 'active', ?, ?, 1, ?, ?, (SELECT account_id FROM cas_external_identities
         WHERE issuer = ? AND subject = ? AND unlinked_at IS NULL))
       ON CONFLICT(identity_issuer, subject) DO UPDATE SET
         platform_admin = MAX(cas_platform_principals.platform_admin, excluded.platform_admin),
         apps_create = MAX(cas_platform_principals.apps_create, excluded.apps_create),
         revision = cas_platform_principals.revision + CASE WHEN cas_platform_principals.platform_admin < excluded.platform_admin OR cas_platform_principals.apps_create < excluded.apps_create THEN 1 ELSE 0 END,
         updated_at = CASE WHEN cas_platform_principals.platform_admin < excluded.platform_admin OR cas_platform_principals.apps_create < excluded.apps_create THEN excluded.updated_at ELSE cas_platform_principals.updated_at END,
         account_id = COALESCE(cas_platform_principals.account_id, excluded.account_id)
       WHERE cas_platform_principals.status = 'active'`,
    ).bind(
      input.principalRef,
      input.principal.issuer,
      input.principal.subject,
      platformAdmin,
      appsCreate,
      input.now,
      input.now,
      input.principal.issuer,
      input.principal.subject,
    );
    const grantPlatformAdmin = this.db.prepare(
      `INSERT OR IGNORE INTO cas_account_platform_authorities (account_id, authority, granted_at)
       SELECT account_id, 'platform.admin', ? FROM cas_external_identities
       WHERE issuer = ? AND subject = ? AND unlinked_at IS NULL AND ? = 1`,
    ).bind(input.now, input.principal.issuer, input.principal.subject, platformAdmin);
    const grantAppsCreate = this.db.prepare(
      `INSERT OR IGNORE INTO cas_account_platform_authorities (account_id, authority, granted_at)
       SELECT account_id, 'apps.create', ? FROM cas_external_identities
       WHERE issuer = ? AND subject = ? AND unlinked_at IS NULL AND ? = 1`,
    ).bind(input.now, input.principal.issuer, input.principal.subject, appsCreate);
    const initializePrimaryContact = this.db.prepare(
      `UPDATE cas_accounts SET primary_verified_email = ?, email_verification_source = ?,
         email_verified_at = ?, updated_at = MAX(updated_at, ?)
       WHERE account_id = (SELECT account_id FROM cas_external_identities
         WHERE issuer = ? AND subject = ? AND unlinked_at IS NULL)
         AND primary_verified_email IS NULL`,
    ).bind(
      input.primaryVerifiedEmail.normalizedEmail,
      input.primaryVerifiedEmail.source,
      input.primaryVerifiedEmail.verifiedAt,
      input.now,
      input.principal.issuer,
      input.principal.subject,
    );
    try {
      await this.db.batch([
        requireNotBlocked,
        claim,
        requireClaimed,
        synchronizeIdentity,
        upsertAccess,
        grantPlatformAdmin,
        grantAppsCreate,
        initializePrimaryContact,
        ...this.#snapshotStatements(),
        this.#audit(input.audit),
      ]);
      return "accepted";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      const current = await this.getAccess(input.principal);
      if (current?.status === "blocked") return "blocked";
      return "not-pending";
    }
  }

  async getPrincipal(principalRef: string): Promise<PlatformPrincipalDetail | null> {
    const row = await this.db.prepare(`${principalProjection} WHERE access.principal_ref = ?`).bind(principalRef).first<PrincipalRow>();
    if (!row) return null;
    const view = principalView(row);
    const memberships = await this.db.prepare(
      `SELECT member.app_id, member.account_id, account.primary_verified_email,
         account.email_verification_source, account.email_verified_at,
         profile.display_name, profile.avatar_url
       FROM cas_app_members AS member
       JOIN cas_accounts AS account ON account.account_id = member.account_id
       JOIN cas_account_profiles AS profile ON profile.account_id = member.account_id
       WHERE member.identity_issuer = ? AND member.subject = ? ORDER BY member.app_id`,
    ).bind(row.identity_issuer, row.subject).all<MembershipAccountRow>();
    return {
      ...view,
      memberships: (memberships.results ?? []).map(member => ({
        appId: member.app_id,
        account: projectAccountSummary({
          accountId: member.account_id,
          primaryVerifiedEmail: membershipVerifiedEmail(member),
        }, { displayName: member.display_name, avatarUrl: member.avatar_url }),
      })),
    };
  }

  async listPrincipals(input: Parameters<PlatformAccessRepository["listPrincipals"]>[0]): Promise<readonly PlatformPrincipalListItem[]> {
    const conditions = ["access.principal_ref > ?"];
    const bindings: unknown[] = [input.after];
    if (input.query !== undefined) {
      conditions.push("(instr(lower(COALESCE(profile.display_name, '')), ?) > 0 OR instr(lower(COALESCE(profile.email_for_display, '')), ?) > 0 OR instr(lower(access.subject), ?) > 0)");
      bindings.push(input.query, input.query, input.query);
    }
    if (input.effectiveAccess === "blocked") conditions.push("access.status = 'blocked'");
    if (input.effectiveAccess === "active") {
      conditions.push("access.status = 'active' AND (access.platform_admin = 1 OR access.apps_create = 1 OR EXISTS (SELECT 1 FROM cas_app_members AS effective_member WHERE effective_member.identity_issuer = access.identity_issuer AND effective_member.subject = access.subject))");
    }
    if (input.effectiveAccess === "no_access") {
      conditions.push("access.status = 'active' AND access.platform_admin = 0 AND access.apps_create = 0 AND NOT EXISTS (SELECT 1 FROM cas_app_members AS effective_member WHERE effective_member.identity_issuer = access.identity_issuer AND effective_member.subject = access.subject)");
    }
    if (input.authority === "platform.admin") conditions.push("access.platform_admin = 1");
    if (input.authority === "apps.create") conditions.push("access.apps_create = 1");
    if (input.authority === "none") conditions.push("access.platform_admin = 0 AND access.apps_create = 0");
    bindings.push(input.limit);
    const rows = await this.db.prepare(
      `${principalProjection} WHERE ${conditions.join(" AND ")} ORDER BY access.principal_ref LIMIT ?`,
    ).bind(...bindings).all<PrincipalRow>();
    return (rows.results ?? []).map(principalView);
  }

  async getAccessSummary(): Promise<Omit<PlatformAccessSummary, "generatedAt">> {
    const row = await this.db.prepare(
      `SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'active' AND platform_admin = 1 THEN 1 ELSE 0 END) AS admin_count,
        SUM(CASE WHEN status = 'active' AND apps_create = 1 THEN 1 ELSE 0 END) AS creator_count,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count
      FROM cas_platform_principals`,
    ).first<{ active_count: number; admin_count: number; creator_count: number; blocked_count: number }>();
    return {
      activePrincipalCount: row?.active_count ?? 0,
      platformAdminCount: row?.admin_count ?? 0,
      appCreatorCount: row?.creator_count ?? 0,
      blockedPrincipalCount: row?.blocked_count ?? 0,
    };
  }

  async listAuditEvents(
    input: Parameters<PlatformAuditRepository["listAuditEvents"]>[0],
  ): Promise<readonly PlatformAuditEvent[]> {
    const rows = await this.db.prepare(
      `SELECT event.*,
        actor.principal_ref AS actor_principal_ref,
        target.principal_ref AS target_principal_ref
       FROM cas_platform_audit_events AS event
       LEFT JOIN cas_platform_principals AS actor
         ON actor.identity_issuer = event.actor_issuer AND actor.subject = event.actor_subject
       LEFT JOIN cas_platform_principals AS target
         ON target.identity_issuer = event.target_issuer AND target.subject = event.target_subject
       WHERE (? IS NULL OR event.action = ?)
         AND (? IS NULL OR actor.principal_ref = ?)
         AND (? IS NULL OR target.principal_ref = ?)
         AND (? IS NULL OR event.created_at > ?)
         AND (? IS NULL OR event.created_at < ? OR (event.created_at = ? AND event.event_id < ?))
       ORDER BY event.created_at DESC, event.event_id DESC
       LIMIT ?`,
    ).bind(
      input.action ?? null,
      input.action ?? null,
      input.actorPrincipalRef ?? null,
      input.actorPrincipalRef ?? null,
      input.targetPrincipalRef ?? null,
      input.targetPrincipalRef ?? null,
      input.createdAfter ?? null,
      input.createdAfter ?? null,
      input.beforeCreatedAt ?? null,
      input.beforeCreatedAt ?? null,
      input.beforeCreatedAt ?? null,
      input.beforeEventId ?? null,
      input.limit,
    ).all<PlatformAuditRow>();
    return (rows.results ?? []).map(row => ({
      eventId: row.event_id,
      action: row.action,
      actorPrincipalRef: row.actor_principal_ref,
      actorPrincipal: { issuer: row.actor_issuer, subject: row.actor_subject },
      targetPrincipalRef: row.target_principal_ref,
      targetPrincipal: row.target_issuer !== null && row.target_subject !== null
        ? { issuer: row.target_issuer, subject: row.target_subject }
        : null,
      targetInvitationId: row.target_invitation_id,
      result: row.result,
      requestId: row.request_id,
      createdAt: row.created_at,
      details: parseAuditDetails(row.details_json),
    }));
  }

  async appendAudit(event: PlatformAuditRecord): Promise<void> {
    await this.db.batch([...this.#snapshotStatements(), this.#audit(event)]);
  }

  async patchAccess(input: Parameters<PlatformAccessRepository["patchAccess"]>[0]): Promise<"updated" | "revision-mismatch" | "last-admin" | "forbidden"> {
    const platformAdmin = Number(input.authorities.includes("platform.admin"));
    const appCreator = Number(input.authorities.includes("apps.create"));
    const requireActor = this.db.prepare("SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ? AND status = 'active' AND platform_admin = 1) THEN 1 ELSE json_extract('invalid', '$') END AS authorized").bind(input.actor.issuer, input.actor.subject);
    const requireAdmin = this.db.prepare("SELECT CASE WHEN ? = 'active' AND ? = 1 OR NOT EXISTS (SELECT 1 FROM cas_platform_principals WHERE principal_ref = ? AND status = 'active' AND platform_admin = 1) OR (SELECT COUNT(*) FROM cas_platform_principals WHERE status = 'active' AND platform_admin = 1) > 1 THEN 1 ELSE json_extract('invalid', '$') END AS retained").bind(input.status, platformAdmin, input.current.principalRef);
    const update = this.db.prepare("UPDATE cas_platform_principals SET status = ?, platform_admin = ?, apps_create = ?, revision = revision + 1, updated_at = ? WHERE principal_ref = ? AND revision = ?").bind(input.status, platformAdmin, appCreator, input.audit.createdAt, input.current.principalRef, input.current.revision);
    const requireUpdated = this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS updated");
    try {
      await this.db.batch([requireActor, requireAdmin, update, requireUpdated, ...this.#snapshotStatements(), this.#audit(input.audit)]);
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
    return this.db.prepare("INSERT INTO cas_platform_audit_events (event_id, actor_issuer, actor_subject, target_issuer, target_subject, target_invitation_id, action, result, request_id, created_at, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(event.eventId, event.actorPrincipal.issuer, event.actorPrincipal.subject, event.targetPrincipal?.issuer ?? null, event.targetPrincipal?.subject ?? null, event.targetInvitationId ?? null, event.action, event.result, event.requestId ?? null, event.createdAt, JSON.stringify(event.details ?? {}));
  }

  #requirePlatformAdmin(actor: Principal) {
    return this.db.prepare(
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ? AND status = 'active' AND platform_admin = 1) THEN 1 ELSE json_extract('invalid', '$') END AS authorized",
    ).bind(actor.issuer, actor.subject);
  }

  #snapshotStatements() {
    return [
      this.db.prepare("INSERT OR IGNORE INTO cas_control_meta (key, value) VALUES ('snapshot', 0)"),
      this.db.prepare("UPDATE cas_control_meta SET value = value + 1 WHERE key = 'snapshot'"),
    ];
  }
}

function isJsonFailure(error: unknown): boolean {
  return error instanceof Error && /malformed JSON/i.test(error.message);
}

function parseAuditDetails(value: string): Readonly<Record<string, string | number | boolean | null>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed);
    if (entries.some(([, detail]) => detail !== null && !["string", "number", "boolean"].includes(typeof detail))) return {};
    return Object.fromEntries(entries) as Readonly<Record<string, string | number | boolean | null>>;
  } catch {
    return {};
  }
}

function membershipVerifiedEmail(row: MembershipAccountRow): PrimaryVerifiedEmail | null {
  return row.primary_verified_email !== null
    && row.email_verification_source !== null
    && row.email_verified_at !== null
    ? {
      normalizedEmail: row.primary_verified_email,
      source: row.email_verification_source,
      verifiedAt: row.email_verified_at,
    }
    : null;
}

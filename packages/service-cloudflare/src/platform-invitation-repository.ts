import type { D1Database } from "@cloudflare/workers-types";
import type { PlatformAuthority } from "@unicas/admin-protocol";
import type {
  PlatformInvitationRepository,
  PlatformInvitationIdempotencyRecord,
  StoredPlatformInvitation,
} from "@unicas/service";

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
  created_by_account_id: string;
  revision: number;
}

interface IdempotencyRow {
  actor_account_id: string;
  idempotency_key: string;
  payload_hash: string;
  invitation_id: string;
  sealed_token: string;
  expires_at: number;
}

function invitationFromRow(row: PlatformInvitationRow): StoredPlatformInvitation {
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
    createdByAccountId: row.created_by_account_id,
    revision: row.revision,
  };
}

export class D1PlatformInvitationRepository implements PlatformInvitationRepository {
  constructor(readonly db: D1Database) { }

  async readSnapshot(): Promise<number> {
    const row = await this.db.prepare("SELECT value FROM cas_control_meta WHERE key = 'snapshot'").first<{ value: number }>();
    return row?.value ?? 0;
  }

  async getInvitation(invitationId: string, now: number): Promise<StoredPlatformInvitation | null> {
    const row = await this.db.prepare(
      `SELECT *, CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS projected_status
       FROM cas_platform_invitations WHERE invitation_id = ?`,
    ).bind(now, invitationId).first<PlatformInvitationRow>();
    return row ? invitationFromRow(row) : null;
  }

  async getInvitationByTokenHash(tokenHash: string, now: number): Promise<StoredPlatformInvitation | null> {
    const row = await this.db.prepare(
      `SELECT *, CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS projected_status
       FROM cas_platform_invitations WHERE token_hash = ?`,
    ).bind(now, tokenHash).first<PlatformInvitationRow>();
    return row ? invitationFromRow(row) : null;
  }

  async listInvitations(
    input: Parameters<PlatformInvitationRepository["listInvitations"]>[0],
  ): Promise<readonly StoredPlatformInvitation[]> {
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
    return (rows.results ?? []).map(invitationFromRow);
  }

  async getInvitationIdempotency(
    input: Parameters<PlatformInvitationRepository["getInvitationIdempotency"]>[0],
  ): Promise<PlatformInvitationIdempotencyRecord | null> {
    const row = await this.db.prepare(
      `SELECT * FROM cas_platform_invitation_idempotency
       WHERE actor_account_id = ? AND idempotency_key = ? AND expires_at > ?`,
    ).bind(input.actorAccountId, input.key, input.now).first<IdempotencyRow>();
    return row ? {
      actorAccountId: row.actor_account_id,
      key: row.idempotency_key,
      payloadHash: row.payload_hash,
      invitationId: row.invitation_id,
      sealedToken: row.sealed_token,
      expiresAt: row.expires_at,
    } : null;
  }

  async commitCreateInvitation(
    input: Parameters<PlatformInvitationRepository["commitCreateInvitation"]>[0],
  ): Promise<"created" | "idempotency-conflict" | "actor-forbidden"> {
    const invitation = input.invitation;
    const insertInvitation = this.db.prepare(
      `INSERT INTO cas_platform_invitations
        (invitation_id, email_constraint, platform_admin, apps_create, status,
         token_hash, expires_at, created_at, created_by_account_id,
         created_by_external_identity_id, revision)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1)`,
    ).bind(
      invitation.invitationId,
      invitation.emailConstraint,
      Number(invitation.authorities.includes("platform.admin")),
      Number(invitation.authorities.includes("apps.create")),
      invitation.tokenHash,
      invitation.expiresAt,
      invitation.createdAt,
      input.actor.accountId,
      input.actor.externalIdentityId,
    );
    const insertIdempotency = this.db.prepare(
      `INSERT INTO cas_platform_invitation_idempotency
        (actor_account_id, idempotency_key, payload_hash, invitation_id, sealed_token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.idempotency.actorAccountId,
      input.idempotency.key,
      input.idempotency.payloadHash,
      input.idempotency.invitationId,
      input.idempotency.sealedToken,
      input.idempotency.expiresAt,
    );
    try {
      await this.db.batch([
        this.#requirePlatformAdmin(input.actor.accountId, input.actor.externalIdentityId),
        insertInvitation,
        insertIdempotency,
        this.#audit(input.eventId, input.actor.accountId, input.actor.externalIdentityId,
          null, invitation.invitationId, "platform_invitation.created", input.requestId, invitation.createdAt),
        ...this.#snapshotStatements(),
      ]);
      return "created";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      if (!await this.#isPlatformAdmin(input.actor.accountId, input.actor.externalIdentityId)) return "actor-forbidden";
      const existing = await this.getInvitationIdempotency({
        actorAccountId: input.actor.accountId,
        key: input.idempotency.key,
        now: invitation.createdAt,
      });
      if (existing) return "idempotency-conflict";
      throw error;
    }
  }

  async commitRevokeInvitation(
    input: Parameters<PlatformInvitationRepository["commitRevokeInvitation"]>[0],
  ): Promise<"updated" | "revision-mismatch" | "not-found" | "not-pending" | "actor-forbidden"> {
    const update = this.db.prepare(
      `UPDATE cas_platform_invitations SET status = 'revoked', revision = revision + 1
       WHERE invitation_id = ? AND revision = ? AND status = 'pending' AND expires_at > ?`,
    ).bind(input.invitationId, input.expectedRevision, input.now);
    const requireUpdated = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS updated",
    );
    try {
      await this.db.batch([
        this.#requirePlatformAdmin(input.actor.accountId, input.actor.externalIdentityId),
        update,
        requireUpdated,
        this.#audit(input.eventId, input.actor.accountId, input.actor.externalIdentityId,
          null, input.invitationId, "platform_invitation.revoked", input.requestId, input.now),
        ...this.#snapshotStatements(),
      ]);
      return "updated";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      if (!await this.#isPlatformAdmin(input.actor.accountId, input.actor.externalIdentityId)) return "actor-forbidden";
      const current = await this.getInvitation(input.invitationId, input.now);
      if (!current) return "not-found";
      if (current.revision !== input.expectedRevision) return "revision-mismatch";
      return "not-pending";
    }
  }

  async commitAcceptInvitation(
    input: Parameters<PlatformInvitationRepository["commitAcceptInvitation"]>[0],
  ): Promise<"accepted" | "not-pending" | "account-unavailable"> {
    const consumeChallenge = input.emailChallenge
      ? [
        this.db.prepare(
          `UPDATE cas_email_challenges SET consumed_at = ?
           WHERE challenge_id = ? AND invitation_kind = 'platform' AND invitation_id = ?
             AND invitation_token_hash = ?
             AND identity_issuer = (SELECT issuer FROM cas_external_identities
               WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
             AND subject = (SELECT subject FROM cas_external_identities
               WHERE external_identity_id = ? AND account_id = ? AND unlinked_at IS NULL)
             AND authentication_event_id = ? AND normalized_email = ?
             AND verified_at IS NOT NULL AND consumed_at IS NULL
             AND invalidated_at IS NULL AND expires_at > ?`,
        ).bind(
          input.now,
          input.emailChallenge.challengeId,
          input.invitation.invitationId,
          input.tokenHash,
          input.actor.externalIdentityId,
          input.actor.accountId,
          input.actor.externalIdentityId,
          input.actor.accountId,
          input.emailChallenge.authenticationEventId,
          input.primaryVerifiedEmail.normalizedEmail,
          input.now,
        ),
        this.db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS consumed"),
      ]
      : [];
    const claim = this.db.prepare(
      `UPDATE cas_platform_invitations SET status = 'accepted', revision = revision + 1
       WHERE invitation_id = ? AND token_hash = ? AND status = 'pending' AND expires_at > ?`,
    ).bind(input.invitation.invitationId, input.tokenHash, input.now);
    const requireClaimed = this.db.prepare(
      "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invalid', '$') END AS claimed",
    );
    const grant = (authority: PlatformAuthority) => this.db.prepare(
      `INSERT OR IGNORE INTO cas_account_platform_authorities (account_id, authority, granted_at)
       SELECT ?, ?, ? WHERE ? = 1`,
    ).bind(
      input.actor.accountId,
      authority,
      input.now,
      Number(input.invitation.authorities.includes(authority)),
    );
    const initializePrimaryContact = this.db.prepare(
      `UPDATE cas_accounts SET primary_verified_email = ?, email_verification_source = ?,
         email_verified_at = ?, updated_at = MAX(updated_at, ?)
       WHERE account_id = ? AND primary_verified_email IS NULL`,
    ).bind(
      input.primaryVerifiedEmail.normalizedEmail,
      input.primaryVerifiedEmail.source,
      input.primaryVerifiedEmail.verifiedAt,
      input.now,
      input.actor.accountId,
    );
    try {
      await this.db.batch([
        this.#requireActiveIdentity(input.actor.accountId, input.actor.externalIdentityId),
        ...consumeChallenge,
        claim,
        requireClaimed,
        grant("platform.admin"),
        grant("apps.create"),
        initializePrimaryContact,
        this.#audit(input.eventId, input.actor.accountId, input.actor.externalIdentityId,
          input.actor.accountId, input.invitation.invitationId,
          "platform_invitation.accepted", input.requestId, input.now),
        ...this.#snapshotStatements(),
      ]);
      return "accepted";
    } catch (error) {
      if (!isJsonFailure(error)) throw error;
      if (!await this.#isActiveIdentity(input.actor.accountId, input.actor.externalIdentityId)) {
        return "account-unavailable";
      }
      return "not-pending";
    }
  }

  #requirePlatformAdmin(accountId: string, externalIdentityId: string) {
    return this.db.prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM cas_external_identities identity
         JOIN cas_accounts account ON account.account_id = identity.account_id
         JOIN cas_account_platform_authorities authority ON authority.account_id = account.account_id
         WHERE identity.external_identity_id = ? AND identity.account_id = ?
           AND identity.unlinked_at IS NULL AND account.blocked_at IS NULL
           AND authority.authority = 'platform.admin'
       ) THEN 1 ELSE json_extract('invalid', '$') END AS authorized`,
    ).bind(externalIdentityId, accountId);
  }

  #requireActiveIdentity(accountId: string, externalIdentityId: string) {
    return this.db.prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM cas_external_identities identity
         JOIN cas_accounts account ON account.account_id = identity.account_id
         WHERE identity.external_identity_id = ? AND identity.account_id = ?
           AND identity.unlinked_at IS NULL AND account.blocked_at IS NULL
       ) THEN 1 ELSE json_extract('invalid', '$') END AS authorized`,
    ).bind(externalIdentityId, accountId);
  }

  async #isPlatformAdmin(accountId: string, externalIdentityId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS allowed FROM cas_external_identities identity
       JOIN cas_accounts account ON account.account_id = identity.account_id
       JOIN cas_account_platform_authorities authority ON authority.account_id = account.account_id
       WHERE identity.external_identity_id = ? AND identity.account_id = ?
         AND identity.unlinked_at IS NULL AND account.blocked_at IS NULL
         AND authority.authority = 'platform.admin'`,
    ).bind(externalIdentityId, accountId).first();
    return row !== null;
  }

  async #isActiveIdentity(accountId: string, externalIdentityId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS allowed FROM cas_external_identities identity
       JOIN cas_accounts account ON account.account_id = identity.account_id
       WHERE identity.external_identity_id = ? AND identity.account_id = ?
         AND identity.unlinked_at IS NULL AND account.blocked_at IS NULL`,
    ).bind(externalIdentityId, accountId).first();
    return row !== null;
  }

  #audit(
    eventId: string,
    actorAccountId: string,
    actorExternalIdentityId: string,
    targetAccountId: string | null,
    targetInvitationId: string,
    action: string,
    requestId: string | null,
    createdAt: number,
  ) {
    return this.db.prepare(
      `INSERT INTO cas_platform_audit_events
        (event_id, actor_account_id, actor_external_identity_id, target_account_id,
         target_invitation_id, action, result, request_id, created_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, '{}')`,
    ).bind(
      eventId,
      actorAccountId,
      actorExternalIdentityId,
      targetAccountId,
      targetInvitationId,
      action,
      requestId,
      createdAt,
    );
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
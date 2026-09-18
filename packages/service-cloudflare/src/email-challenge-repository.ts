import type { D1Database } from "@cloudflare/workers-types";
import type {
  EmailChallengeBinding,
  EmailChallengeRecord,
  EmailChallengeRepository,
} from "@unicas/service";

interface EmailChallengeRow {
  readonly challenge_id: string;
  readonly invitation_kind: "app" | "platform";
  readonly invitation_id: string;
  readonly invitation_token_hash: string;
  readonly identity_issuer: string;
  readonly subject: string;
  readonly authentication_event_id: string;
  readonly normalized_email: string;
  readonly code_hash: string;
  readonly expires_at: number;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly send_count: number;
  readonly last_sent_at: number;
  readonly verified_at: number | null;
  readonly consumed_at: number | null;
  readonly invalidated_at: number | null;
  readonly created_at: number;
}

export class D1EmailChallengeRepository implements EmailChallengeRepository {
  constructor(readonly db: D1Database) { }

  async pruneExpired(now: number): Promise<number> {
    const result = await this.db.prepare(
      "DELETE FROM cas_email_challenges WHERE expires_at <= ?",
    ).bind(now).run();
    return result.meta.changes ?? 0;
  }

  async create(
    record: EmailChallengeRecord,
    limits: Parameters<EmailChallengeRepository["create"]>[1],
  ): Promise<"created" | "conflict" | "rate-limited"> {
    try {
      const results = await this.db.batch([
        this.db.prepare("DELETE FROM cas_email_challenges WHERE expires_at <= ?")
          .bind(record.createdAt - 24 * 60 * 60 * 1000),
        this.db.prepare(
          `INSERT INTO cas_email_challenges
            (challenge_id, invitation_kind, invitation_id, invitation_token_hash,
             identity_issuer, subject, authentication_event_id, normalized_email,
             code_hash, expires_at, attempt_count, max_attempts, send_count,
             last_sent_at, verified_at, consumed_at, invalidated_at, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM cas_email_challenges
             WHERE invitation_kind = ? AND invitation_id = ? AND invitation_token_hash = ?
               AND identity_issuer = ? AND subject = ? AND normalized_email = ?
               AND last_sent_at > ?
           ) AND COALESCE((
             SELECT SUM(send_count) FROM cas_email_challenges
             WHERE invitation_kind = ? AND invitation_id = ? AND invitation_token_hash = ?
               AND identity_issuer = ? AND subject = ? AND normalized_email = ?
               AND last_sent_at > ?
           ), 0) < ?`,
        ).bind(
          record.challengeId,
          record.invitationKind,
          record.invitationId,
          record.invitationTokenHash,
          record.issuer,
          record.subject,
          record.authenticationEventId,
          record.normalizedEmail,
          record.codeHash,
          record.expiresAt,
          record.attemptCount,
          record.maxAttempts,
          record.sendCount,
          record.lastSentAt,
          record.createdAt,
          record.invitationKind,
          record.invitationId,
          record.invitationTokenHash,
          record.issuer,
          record.subject,
          record.normalizedEmail,
          record.createdAt - limits.minimumIntervalMs,
          record.invitationKind,
          record.invitationId,
          record.invitationTokenHash,
          record.issuer,
          record.subject,
          record.normalizedEmail,
          record.createdAt - limits.windowMs,
          limits.maxSends,
        ),
      ]);
      return results[1]!.meta.changes === 1 ? "created" : "rate-limited";
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return "conflict";
      throw error;
    }
  }

  async get(challengeId: string): Promise<EmailChallengeRecord | null> {
    const row = await this.db.prepare(
      `SELECT challenge_id, invitation_kind, invitation_id, invitation_token_hash,
        identity_issuer, subject, authentication_event_id, normalized_email,
        code_hash, expires_at, attempt_count, max_attempts, send_count,
        last_sent_at, verified_at, consumed_at, invalidated_at, created_at
       FROM cas_email_challenges WHERE challenge_id = ?`,
    ).bind(challengeId).first<EmailChallengeRow>();
    return row ? toRecord(row) : null;
  }

  async invalidate(input: Parameters<EmailChallengeRepository["invalidate"]>[0]): Promise<void> {
    await this.db.prepare(
      `UPDATE cas_email_challenges SET invalidated_at = ?
       WHERE challenge_id = ? AND invitation_kind = ? AND invitation_id = ?
         AND invitation_token_hash = ? AND identity_issuer = ? AND subject = ?
         AND authentication_event_id = ? AND normalized_email = ?
         AND consumed_at IS NULL AND invalidated_at IS NULL`,
    ).bind(
      input.now,
      input.challengeId,
      input.binding.invitationKind,
      input.binding.invitationId,
      input.binding.invitationTokenHash,
      input.binding.issuer,
      input.binding.subject,
      input.binding.authenticationEventId,
      input.binding.normalizedEmail,
    ).run();
  }

  async verify(input: Parameters<EmailChallengeRepository["verify"]>[0]): ReturnType<EmailChallengeRepository["verify"]> {
    const record = await this.get(input.challengeId);
    if (!record || !sameBinding(record, input.binding) || record.verifiedAt !== null
      || record.invalidatedAt !== null
      || record.consumedAt !== null || record.expiresAt <= input.now
      || record.attemptCount >= record.maxAttempts) {
      return { kind: "failed" };
    }
    const matches = fixedHashEqual(record.codeHash, input.codeHash);
    const result = await this.db.prepare(
      `UPDATE cas_email_challenges
       SET attempt_count = attempt_count + 1, verified_at = ?
       WHERE challenge_id = ? AND attempt_count = ? AND verified_at IS NULL
          AND code_hash = ? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
    ).bind(matches ? input.now : null, input.challengeId, record.attemptCount, record.codeHash, input.now).run();
    if (result.meta.changes !== 1 || !matches) return { kind: "failed" };
    return { kind: "verified", verifiedAt: input.now, expiresAt: record.expiresAt };
  }

  async resend(input: Parameters<EmailChallengeRepository["resend"]>[0]): ReturnType<EmailChallengeRepository["resend"]> {
    const record = await this.get(input.challengeId);
    if (!record || !sameBinding(record, input.binding) || record.verifiedAt !== null
      || record.invalidatedAt !== null
      || record.consumedAt !== null || record.expiresAt <= input.now
      || record.attemptCount >= record.maxAttempts || record.sendCount >= input.maxSends
      || record.lastSentAt + input.minimumIntervalMs > input.now) {
      return { kind: "failed" };
    }
    const result = await this.db.prepare(
      `UPDATE cas_email_challenges SET code_hash = ?, send_count = send_count + 1,
         last_sent_at = ?
       WHERE challenge_id = ? AND send_count = ? AND last_sent_at = ?
         AND verified_at IS NULL AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ?
         AND attempt_count < max_attempts
         AND NOT EXISTS (
           SELECT 1 FROM cas_email_challenges history
           WHERE history.invitation_kind = ? AND history.invitation_id = ?
             AND history.invitation_token_hash = ? AND history.identity_issuer = ?
             AND history.subject = ? AND history.normalized_email = ? AND history.last_sent_at > ?
         ) AND COALESCE((
           SELECT SUM(history.send_count) FROM cas_email_challenges history
           WHERE history.invitation_kind = ? AND history.invitation_id = ?
             AND history.invitation_token_hash = ? AND history.identity_issuer = ?
             AND history.subject = ? AND history.normalized_email = ? AND history.last_sent_at > ?
         ), 0) < ?`,
    ).bind(
      input.codeHash,
      input.now,
      input.challengeId,
      record.sendCount,
      record.lastSentAt,
      input.now,
      record.invitationKind,
      record.invitationId,
      record.invitationTokenHash,
      record.issuer,
      record.subject,
      record.normalizedEmail,
      input.now - input.minimumIntervalMs,
      record.invitationKind,
      record.invitationId,
      record.invitationTokenHash,
      record.issuer,
      record.subject,
      record.normalizedEmail,
      input.now - input.windowMs,
      input.maxSends,
    ).run();
    return result.meta.changes === 1
      ? { kind: "resent", expiresAt: record.expiresAt }
      : { kind: "failed" };
  }
}

function toRecord(row: EmailChallengeRow): EmailChallengeRecord {
  return {
    challengeId: row.challenge_id,
    invitationKind: row.invitation_kind,
    invitationId: row.invitation_id,
    invitationTokenHash: row.invitation_token_hash,
    issuer: row.identity_issuer,
    subject: row.subject,
    authenticationEventId: row.authentication_event_id,
    normalizedEmail: row.normalized_email,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    sendCount: row.send_count,
    lastSentAt: row.last_sent_at,
    verifiedAt: row.verified_at,
    consumedAt: row.consumed_at,
    invalidatedAt: row.invalidated_at,
    createdAt: row.created_at,
  };
}

function sameBinding(left: EmailChallengeBinding, right: EmailChallengeBinding): boolean {
  return left.invitationKind === right.invitationKind
    && left.invitationId === right.invitationId
    && left.invitationTokenHash === right.invitationTokenHash
    && left.issuer === right.issuer
    && left.subject === right.subject
    && left.authenticationEventId === right.authenticationEventId
    && left.normalizedEmail === right.normalizedEmail;
}

function fixedHashEqual(left: string, right: string): boolean {
  if (left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
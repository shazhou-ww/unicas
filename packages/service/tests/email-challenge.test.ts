import { describe, expect, test } from "vitest";
import {
  EmailChallengeError,
  EmailChallengeService,
  type EmailChallengeBinding,
  type EmailChallengeRecord,
  type EmailChallengeRepository,
} from "../src/index.js";

class MemoryEmailChallenges implements EmailChallengeRepository {
  readonly records = new Map<string, EmailChallengeRecord>();

  async create(record: EmailChallengeRecord): Promise<"created" | "conflict" | "rate-limited"> {
    if (this.records.has(record.challengeId)) return "conflict";
    this.records.set(record.challengeId, record);
    return "created";
  }

  async get(challengeId: string): Promise<EmailChallengeRecord | null> {
    return this.records.get(challengeId) ?? null;
  }

  async invalidate(input: Parameters<EmailChallengeRepository["invalidate"]>[0]): Promise<void> {
    const record = this.records.get(input.challengeId);
    if (record && matches(record, input.binding) && record.consumedAt === null) {
      this.records.set(record.challengeId, { ...record, invalidatedAt: input.now });
    }
  }

  async verify(input: Parameters<EmailChallengeRepository["verify"]>[0]): ReturnType<EmailChallengeRepository["verify"]> {
    const record = this.records.get(input.challengeId);
    if (!record || !matches(record, input.binding) || record.consumedAt !== null
      || record.invalidatedAt !== null
      || record.expiresAt <= input.now || record.attemptCount >= record.maxAttempts) {
      return { kind: "failed" };
    }
    if (record.verifiedAt !== null) {
      return { kind: "verified", verifiedAt: record.verifiedAt, expiresAt: record.expiresAt };
    }
    const verifiedAt = record.codeHash === input.codeHash ? input.now : null;
    this.records.set(record.challengeId, {
      ...record,
      attemptCount: record.attemptCount + 1,
      verifiedAt,
    });
    return verifiedAt === null
      ? { kind: "failed" }
      : { kind: "verified", verifiedAt, expiresAt: record.expiresAt };
  }

  async resend(input: Parameters<EmailChallengeRepository["resend"]>[0]): ReturnType<EmailChallengeRepository["resend"]> {
    const record = this.records.get(input.challengeId);
    if (!record || !matches(record, input.binding) || record.verifiedAt !== null
      || record.invalidatedAt !== null
      || record.consumedAt !== null || record.expiresAt <= input.now
      || record.attemptCount >= record.maxAttempts || record.sendCount >= input.maxSends
      || record.lastSentAt + input.minimumIntervalMs > input.now) {
      return { kind: "failed" };
    }
    this.records.set(record.challengeId, {
      ...record,
      codeHash: input.codeHash,
      sendCount: record.sendCount + 1,
      lastSentAt: input.now,
    });
    return { kind: "resent", expiresAt: record.expiresAt };
  }
}

const base = {
  invitationKind: "app" as const,
  invitationId: "invitation-1",
  invitationTokenHash: "token-hash",
  issuer: "https://login.microsoftonline.com/consumers/v2.0",
  subject: "microsoft-subject",
  authenticationEventId: "authentication-event-1",
  email: " Alice@Example.com ",
};

function matches(record: EmailChallengeBinding, binding: EmailChallengeBinding): boolean {
  return record.invitationKind === binding.invitationKind
    && record.invitationId === binding.invitationId
    && record.invitationTokenHash === binding.invitationTokenHash
    && record.issuer === binding.issuer
    && record.subject === binding.subject
    && record.authenticationEventId === binding.authenticationEventId
    && record.normalizedEmail === binding.normalizedEmail;
}

describe("email challenge", () => {
  test("persists only a hash and produces invitation-bound evidence", async () => {
    const repository = new MemoryEmailChallenges();
    const service = new EmailChallengeService(repository, {
      now: () => 1_000,
      generateChallengeId: () => "challenge-1",
      generateCode: () => "123456",
      generateSecret: () => "secret-1",
    });

    const challenge = await service.create(base);
    const stored = repository.records.get(challenge.challengeId)!;
    expect(challenge).toMatchObject({ maskedEmail: "al***@example.com", expiresAt: 601_000 });
    expect(stored.normalizedEmail).toBe("alice@example.com");
    expect(stored.codeHash).not.toContain("123456");
    expect(JSON.stringify(stored)).not.toContain("secret-1");

    const evidence = await service.verify({
      challengeId: challenge.challengeId,
      binding: challenge.binding,
      secret: challenge.secret,
      code: challenge.code,
    });
    expect(evidence).toEqual({
      normalizedEmail: "alice@example.com",
      source: "unicas-email-challenge",
      verifiedAt: 1_000,
      expiresAt: 601_000,
      authenticationEventId: "authentication-event-1",
      challengeId: "challenge-1",
    });
  });

  test("fails closed for a mismatched binding, expiry, and exhausted attempt budget", async () => {
    let now = 1_000;
    const repository = new MemoryEmailChallenges();
    const service = new EmailChallengeService(repository, {
      now: () => now,
      maxAttempts: 2,
      generateChallengeId: () => "challenge-1",
      generateCode: () => "123456",
      generateSecret: () => "secret-1",
    });
    const challenge = await service.create(base);
    await expect(service.verify({
      ...challenge,
      binding: { ...challenge.binding, subject: "other-subject" },
      code: challenge.code,
    })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...challenge, code: "000000" })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...challenge, code: "000001" })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...challenge, code: challenge.code })).rejects.toBeInstanceOf(EmailChallengeError);

    const expiring = new EmailChallengeService(new MemoryEmailChallenges(), {
      now: () => now,
      ttlMs: 10,
      generateChallengeId: () => "challenge-2",
      generateCode: () => "654321",
      generateSecret: () => "secret-2",
    });
    const expired = await expiring.create({ ...base, invitationId: "invitation-2" });
    now = 1_010;
    await expect(expiring.verify({ ...expired, code: expired.code })).rejects.toBeInstanceOf(EmailChallengeError);
  });

  test("rate-limits resend and rotates the code without changing the destination or deadline", async () => {
    let now = 1_000;
    let generated = 0;
    const repository = new MemoryEmailChallenges();
    const service = new EmailChallengeService(repository, {
      now: () => now,
      resendIntervalMs: 100,
      maxSends: 2,
      generateChallengeId: () => "challenge-1",
      generateCode: () => generated++ === 0 ? "123456" : "654321",
      generateSecret: () => `secret-${generated}`,
    });
    const challenge = await service.create(base);
    await expect(service.resend(challenge)).rejects.toBeInstanceOf(EmailChallengeError);
    now = 1_100;
    const resent = await service.resend(challenge);
    expect(resent).toMatchObject({
      challengeId: challenge.challengeId,
      code: "654321",
      maskedEmail: challenge.maskedEmail,
      expiresAt: challenge.expiresAt,
    });
    await expect(service.verify({ ...resent, code: challenge.code })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...resent, code: resent.code })).resolves.toMatchObject({
      source: "unicas-email-challenge",
      challengeId: challenge.challengeId,
    });
    await expect(service.resend(resent)).rejects.toBeInstanceOf(EmailChallengeError);
  });

  test("invalidates a challenge without exposing or consuming its evidence", async () => {
    const repository = new MemoryEmailChallenges();
    const service = new EmailChallengeService(repository, {
      now: () => 1_000,
      generateChallengeId: () => "challenge-1",
      generateCode: () => "123456",
      generateSecret: () => "secret-1",
    });
    const challenge = await service.create(base);
    await service.invalidate(challenge);
    await expect(service.verify({ ...challenge, code: challenge.code })).rejects.toBeInstanceOf(EmailChallengeError);
    expect(await repository.get(challenge.challengeId)).toMatchObject({ consumedAt: null, invalidatedAt: 1_000 });
  });
});
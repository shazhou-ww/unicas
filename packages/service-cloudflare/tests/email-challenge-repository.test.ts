import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { EmailChallengeError, EmailChallengeService } from "@unicas/service";
import { migrateControlSchema } from "../src/control-schema.js";
import { D1EmailChallengeRepository } from "../src/email-challenge-repository.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

async function fixture() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "email-challenge-repository-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "email-challenge-repository-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "email-challenge-repository-test");
  await migrateControlSchema(db);
  const repository = new D1EmailChallengeRepository(db);
  return { db, repository };
}

const input = {
  invitationKind: "platform" as const,
  invitationId: "invitation-1",
  invitationTokenHash: "token-hash",
  issuer: "https://login.microsoftonline.com/consumers/v2.0",
  subject: "microsoft-subject",
  authenticationEventId: "authentication-event-1",
  email: "invitee@example.com",
};

describe("D1 email challenge repository", () => {
  test("stores no raw code or secret and permits only one verification transition", async () => {
    const { db, repository } = await fixture();
    const service = new EmailChallengeService(repository, {
      now: () => 1_000,
      generateChallengeId: () => "challenge-1",
      generateCode: () => "123456",
      generateSecret: () => "secret-1",
    });
    const challenge = await service.create(input);
    const persisted = await db.prepare("SELECT * FROM cas_email_challenges").first<Record<string, unknown>>();
    expect(JSON.stringify(persisted)).not.toContain("123456");
    expect(JSON.stringify(persisted)).not.toContain("secret-1");

    const attempts = await Promise.allSettled([
      service.verify({ ...challenge, code: challenge.code }),
      service.verify({ ...challenge, code: challenge.code }),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await repository.get(challenge.challengeId)).toMatchObject({ attemptCount: 1, verifiedAt: 1_000 });
  });

  test("rejects verification against a code replaced after the verification read", async () => {
    const { db, repository } = await fixture();
    const service = new EmailChallengeService(repository, { now: () => 1_000 });
    const challenge = await service.create(input);
    class RacingRepository extends D1EmailChallengeRepository {
      override async get(challengeId: string) {
        const record = await super.get(challengeId);
        await this.db.prepare("UPDATE cas_email_challenges SET code_hash = ? WHERE challenge_id = ?")
          .bind("f".repeat(64), challengeId).run();
        return record;
      }
    }
    const racing = new EmailChallengeService(new RacingRepository(db), { now: () => 1_001 });
    await expect(racing.verify(challenge)).rejects.toBeInstanceOf(EmailChallengeError);
    expect(await repository.get(challenge.challengeId)).toMatchObject({ verifiedAt: null, attemptCount: 0 });
  });

  test("rate-limits new challenges across repeated authentication callbacks", async () => {
    let now = 1_000;
    let challengeNumber = 0;
    const { repository } = await fixture();
    const service = new EmailChallengeService(repository, {
      now: () => now,
      resendIntervalMs: 100,
      maxSends: 2,
      generateChallengeId: () => `challenge-${++challengeNumber}`,
      generateCode: () => "123456",
      generateSecret: () => `secret-${challengeNumber}`,
    });
    await service.create(input);
    await expect(service.create({ ...input, authenticationEventId: "authentication-event-2" }))
      .rejects.toBeInstanceOf(EmailChallengeError);
    now += 100;
    const latest = await service.create({ ...input, authenticationEventId: "authentication-event-2" });
    now += 100;
    await expect(service.create({ ...input, authenticationEventId: "authentication-event-3" }))
      .rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.resend(latest)).rejects.toBeInstanceOf(EmailChallengeError);
  });

  test("enforces exact bindings, expiry, attempt limits, and resend limits atomically", async () => {
    let now = 1_000;
    let code = "123456";
    const { repository } = await fixture();
    const service = new EmailChallengeService(repository, {
      now: () => now,
      ttlMs: 500,
      maxAttempts: 2,
      resendIntervalMs: 100,
      maxSends: 2,
      generateChallengeId: () => "challenge-1",
      generateCode: () => code,
      generateSecret: () => `secret-${code}`,
    });
    const challenge = await service.create(input);
    await expect(service.verify({
      ...challenge,
      binding: { ...challenge.binding, invitationId: "other-invitation" },
      code: challenge.code,
    })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.resend(challenge)).rejects.toBeInstanceOf(EmailChallengeError);
    now = 1_100;
    code = "654321";
    const resent = await service.resend(challenge);
    await expect(service.resend(resent)).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...resent, code: "000000" })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...resent, code: "000001" })).rejects.toBeInstanceOf(EmailChallengeError);
    await expect(service.verify({ ...resent, code: resent.code })).rejects.toBeInstanceOf(EmailChallengeError);

    const expiring = new EmailChallengeService(repository, {
      now: () => now,
      ttlMs: 10,
      generateChallengeId: () => "challenge-2",
      generateCode: () => "999999",
      generateSecret: () => "secret-2",
    });
    const expired = await expiring.create({ ...input, invitationId: "invitation-2" });
    now += 10;
    await expect(expiring.verify({ ...expired, code: expired.code })).rejects.toBeInstanceOf(EmailChallengeError);
    expect(await repository.pruneExpired(now)).toBe(1);
    expect(await repository.get(expired.challengeId)).toBeNull();
  });
});
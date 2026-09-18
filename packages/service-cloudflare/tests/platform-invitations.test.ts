import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { AccountService, PlatformInvitationService, sha256Hex } from "@unicas/service";
import { D1AccountRepository } from "../src/account-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";
import { InvitationTokenCrypto } from "../src/invitation-token-crypto.js";
import { D1PlatformInvitationRepository } from "../src/platform-invitation-repository.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

function encryptionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("D1 platform invitations", () => {
  test("seals idempotency, revokes conditionally, grants an Account, and preserves blocked state", async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
      workers: [{
        name: "platform-invitation-test",
        modules: true,
        script: "export default { fetch() { return new Response('ok'); } }",
        compatibilityDate: "2025-08-17",
        d1Databases: { DB: "platform-invitation-test" },
      }],
    }));
    await runtime.ready;
    const db = await runtime.getD1Database("DB", "platform-invitation-test");
    await migrateControlSchema(db);
    const accounts = new AccountService(new D1AccountRepository(db), () => 1000);
    const admin = await accounts.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.example",
      subject: "admin",
    });
    await db.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 1)",
    ).bind(admin.account.accountId).run();
    const repository = new D1PlatformInvitationRepository(db);
    let invitationNumber = 0;
    let tokenNumber = 0;
    const service = new PlatformInvitationService(
      repository,
      accounts,
      new InvitationTokenCrypto({ current: encryptionKey() }),
      {
        now: () => 1000,
        invitationTtlMs: 1000,
        generateInvitationId: () => `invitation-${++invitationNumber}`,
        generateInvitationToken: () => `${++tokenNumber}`.padStart(32, "t"),
        generateEventId: () => `event-${crypto.randomUUID()}`,
      },
    );
    const adminActor = {
      accountId: admin.account.accountId,
      externalIdentityId: admin.authenticatedIdentity.externalIdentityId,
    };

    const created = await service.create(adminActor, {
      emailConstraint: "creator@example.com",
      authorities: ["apps.create"],
    }, "create-1", "request-create");
    await expect(service.create(adminActor, {
      emailConstraint: "creator@example.com",
      authorities: ["apps.create"],
    }, "create-1")).resolves.toEqual(created);
    const token = created.acceptUrl.split("/")[3]!;
    const idempotency = await db.prepare(
      "SELECT actor_account_id, sealed_token FROM cas_platform_invitation_idempotency",
    ).first<{ actor_account_id: string; sealed_token: string }>();
    expect(idempotency?.actor_account_id).toBe(admin.account.accountId);
    expect(idempotency?.sealed_token).not.toContain(token);
    await expect(service.list(admin.account.accountId, {})).resolves.toMatchObject({
      items: [{
        invitationId: created.invitationId,
        createdByAccountId: admin.account.accountId,
        authorities: ["apps.create"],
      }],
    });
    await expect(service.revoke(adminActor, created.invitationId, '"1"', "request-revoke"))
      .resolves.toEqual({ revision: 2 });
    await expect(service.revoke(adminActor, created.invitationId, '"2"'))
      .resolves.toEqual({ revision: 2 });

    const invitee = await accounts.createForExternalIdentity({
      provider: "microsoft",
      issuer: "https://accounts.example",
      subject: "invitee",
    });
    const acceptedInvitation = await service.create(adminActor, {
      emailConstraint: "invitee@example.com",
      authorities: ["platform.admin"],
    }, "create-2");
    const acceptedToken = acceptedInvitation.acceptUrl.split("/")[3]!;
    await db.prepare(
      `INSERT INTO cas_email_challenges
        (challenge_id, invitation_kind, invitation_id, invitation_token_hash,
         identity_issuer, subject, authentication_event_id, normalized_email,
         code_hash, expires_at, max_attempts, last_sent_at, verified_at, created_at)
       VALUES ('challenge-platform', 'platform', ?, ?, ?, ?, 'auth-invitee',
         'invitee@example.com', ?, 2000, 5, 900, 900, 900)`,
    ).bind(
      acceptedInvitation.invitationId,
      await sha256Hex(acceptedToken),
      invitee.authenticatedIdentity.issuer,
      invitee.authenticatedIdentity.subject,
      "0".repeat(64),
    ).run();
    await service.accept({
      accountId: invitee.account.accountId,
      externalIdentityId: invitee.authenticatedIdentity.externalIdentityId,
    }, [{
      normalizedEmail: "invitee@example.com",
      source: "unicas-email-challenge",
      verifiedAt: 900,
      expiresAt: 2_000,
      authenticationEventId: "auth-invitee",
      challengeId: "challenge-platform",
    }], acceptedToken, "request-accept");
    expect(await db.prepare(
      "SELECT consumed_at FROM cas_email_challenges WHERE challenge_id = 'challenge-platform'",
    ).first()).toEqual({ consumed_at: 1000 });
    expect(await db.prepare(
      "SELECT authority FROM cas_account_platform_authorities WHERE account_id = ?",
    ).bind(invitee.account.accountId).all()).toMatchObject({
      results: [{ authority: "platform.admin" }],
    });
    expect(await db.prepare(
      "SELECT primary_verified_email FROM cas_accounts WHERE account_id = ?",
    ).bind(invitee.account.accountId).first()).toEqual({ primary_verified_email: "invitee@example.com" });

    const blocked = await accounts.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "42",
    });
    await db.prepare("UPDATE cas_accounts SET blocked_at = 999 WHERE account_id = ?")
      .bind(blocked.account.accountId).run();
    const blockedInvitation = await service.create(adminActor, {
      emailConstraint: "blocked@example.com",
      authorities: ["apps.create"],
    }, "create-3");
    await expect(service.accept({
      accountId: blocked.account.accountId,
      externalIdentityId: blocked.authenticatedIdentity.externalIdentityId,
    }, [{
      normalizedEmail: "blocked@example.com",
      source: "google-oidc",
      verifiedAt: 900,
      expiresAt: 2_000,
      authenticationEventId: "auth-blocked",
    }], blockedInvitation.acceptUrl.split("/")[3]!)).rejects.toMatchObject({
      code: "PLATFORM_ACCESS_REQUIRED",
    });
    expect(await repository.getInvitation(blockedInvitation.invitationId, 1000))
      .toMatchObject({ status: "pending" });

    const audit = await db.prepare(
      "SELECT action, actor_account_id, actor_external_identity_id, target_account_id, target_invitation_id, request_id FROM cas_platform_audit_events ORDER BY created_at, action",
    ).all();
    expect(audit.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "platform_invitation.created",
        actor_account_id: admin.account.accountId,
        actor_external_identity_id: admin.authenticatedIdentity.externalIdentityId,
        target_invitation_id: created.invitationId,
        request_id: "request-create",
      }),
      expect.objectContaining({
        action: "platform_invitation.accepted",
        actor_account_id: invitee.account.accountId,
        target_account_id: invitee.account.accountId,
        target_invitation_id: acceptedInvitation.invitationId,
        request_id: "request-accept",
      }),
    ]));
  }, 20_000);
});
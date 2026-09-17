import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { PlatformAccessService, PlatformAuditService, PlatformInvitationService } from "@unicas/service";
import { migrateControlSchema } from "../src/control-schema.js";
import { InvitationTokenCrypto } from "../src/invitation-token-crypto.js";
import { D1PlatformAccessRepository } from "../src/platform-access-repository.js";

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
  test("seals idempotency, conditionally revokes, atomically accepts, and preserves blocked state", async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
      workers: [{
        name: "platform-invitation-test",
        modules: true,
        script: "export default { fetch() { return new Response('ok'); } }",
        compatibilityDate: "2025-08-17",
        d1Databases: { DB: "platform-invitation-test" },
      }]
    }));
    await runtime.ready;
    const db = await runtime.getD1Database("DB", "platform-invitation-test");
    await migrateControlSchema(db);
    const actor = { issuer: "https://accounts.example", subject: "admin" };
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('actor-ref', ?, ?, 'active', 1, 0, 1, 1, 1)").bind(actor.issuer, actor.subject).run();
    const repository = new D1PlatformAccessRepository(db);
    const accessService = new PlatformAccessService(repository, () => 1000);
    let invitationNumber = 0;
    let tokenNumber = 0;
    const service = new PlatformInvitationService(
      repository,
      accessService,
      new InvitationTokenCrypto({ current: encryptionKey() }),
      {
        now: () => 1000,
        invitationTtlMs: 1000,
        generateInvitationId: () => `invitation-${++invitationNumber}`,
        generateInvitationToken: () => `${++tokenNumber}`.padStart(32, "t"),
        generatePrincipalRef: () => `principal-${invitationNumber}`,
        generateEventId: () => `event-${crypto.randomUUID()}`,
      },
    );

    const created = await service.create(actor, {
      emailConstraint: "creator@example.com",
      authorities: ["apps.create"],
    }, "create-1", "request-create");
    await expect(service.create(actor, {
      emailConstraint: "creator@example.com",
      authorities: ["apps.create"],
    }, "create-1")).resolves.toEqual(created);
    const token = created.acceptUrl.split("/")[3]!;
    const idempotency = await db.prepare("SELECT sealed_token FROM cas_platform_invitation_idempotency").first<{ sealed_token: string }>();
    expect(idempotency?.sealed_token).not.toContain(token);
    expect(await service.list(actor, {})).toMatchObject({
      items: [{ invitationId: created.invitationId, emailConstraint: "creator@example.com", authorities: ["apps.create"] }],
    });

    await expect(service.revoke(actor, created.invitationId, '"1"', "request-revoke")).resolves.toEqual({ revision: 2 });
    await expect(service.revoke(actor, created.invitationId, '"2"')).resolves.toEqual({ revision: 2 });

    const acceptedInvitation = await service.create(actor, {
      emailConstraint: "invitee@example.com",
      authorities: ["platform.admin"],
    }, "create-2");
    const invitee = { issuer: actor.issuer, subject: "invitee" };
    const inviteeAccountId = `acct_${"i".repeat(22)}`;
    await db.prepare(
      "INSERT INTO cas_accounts (account_id, credential_version, created_at, updated_at) VALUES (?, 1, 1, 1)",
    ).bind(inviteeAccountId).run();
    await db.prepare(
      "INSERT INTO cas_account_profiles (account_id, display_name, updated_at) VALUES (?, 'Invitee', 1)",
    ).bind(inviteeAccountId).run();
    await db.prepare(
      "INSERT INTO cas_external_identities (external_identity_id, account_id, provider, issuer, subject, linked_at) VALUES ('ext-invitee', ?, 'google', ?, ?, 1)",
    ).bind(inviteeAccountId, invitee.issuer, invitee.subject).run();
    await service.accept(
      invitee,
      { displayName: "Invitee", emailForDisplay: "invitee@example.com" },
      [{ normalizedEmail: "invitee@example.com", source: "google-oidc", verifiedAt: 900, expiresAt: 2_000, authenticationEventId: "auth-invitee" }],
      acceptedInvitation.acceptUrl.split("/")[3]!,
      "request-accept",
    );
    expect(await repository.getAccess(invitee)).toMatchObject({
      status: "active",
      authorities: ["platform.admin"],
      revision: 1,
    });
    expect(await db.prepare(
      "SELECT account_id FROM cas_platform_principals WHERE identity_issuer = ? AND subject = ?",
    ).bind(invitee.issuer, invitee.subject).first()).toEqual({ account_id: inviteeAccountId });
    expect(await db.prepare(
      "SELECT authority FROM cas_account_platform_authorities WHERE account_id = ?",
    ).bind(inviteeAccountId).all()).toMatchObject({ results: [{ authority: "platform.admin" }] });
    expect(await db.prepare(
      "SELECT primary_verified_email, email_verification_source FROM cas_accounts WHERE account_id = ?",
    ).bind(inviteeAccountId).first()).toEqual({
      primary_verified_email: "invitee@example.com",
      email_verification_source: "google-oidc",
    });
    await db.prepare("INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('app-1', 'App One', '', 'active', 1, 1)").run();
    await db.prepare("INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('app-1', ?, ?, 1, ?)").bind(invitee.issuer, invitee.subject, inviteeAccountId).run();
    await db.prepare("INSERT INTO cas_control_audit_events (event_id, app_id, identity_issuer, subject, action, target, created_at) VALUES ('activity-1', 'app-1', ?, ?, 'session.login', 'principal', 900)").bind(invitee.issuer, invitee.subject).run();
    const access = await repository.getAccess(invitee);
    expect(await repository.getPrincipal(access!.principalRef)).toMatchObject({
      lastActiveAt: 900,
      appMembershipCount: 1,
      memberships: [{ appId: "app-1", account: { accountId: inviteeAccountId, displayName: "Invitee" } }],
    });
    expect(await repository.listPrincipals({ after: "", limit: 10 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ principal: invitee, lastActiveAt: 900, appMembershipCount: 1 }),
    ]));
    expect(await accessService.listPrincipals(actor, {
      query: "invitee@example.com",
      effectiveAccess: "active",
      authority: "platform.admin",
      limit: 10,
    })).toMatchObject({ items: [{ principal: invitee }], nextCursor: null });
    const firstPrincipalPage = await accessService.listPrincipals(actor, { authority: "platform.admin", limit: 1 });
    expect(firstPrincipalPage.nextCursor).toEqual(expect.any(String));
    await expect(accessService.listPrincipals(actor, {
      authority: "none",
      limit: 1,
      cursor: firstPrincipalPage.nextCursor!,
    })).rejects.toMatchObject({ code: "INVALID_CURSOR" });

    const blocked = { issuer: actor.issuer, subject: "blocked" };
    await db.prepare("INSERT INTO cas_platform_principals (principal_ref, identity_issuer, subject, status, platform_admin, apps_create, revision, created_at, updated_at) VALUES ('blocked-ref', ?, ?, 'blocked', 0, 0, 1, 1, 1)").bind(blocked.issuer, blocked.subject).run();
    const blockedInvitation = await service.create(actor, {
      emailConstraint: "blocked@example.com",
      authorities: ["apps.create"],
    }, "create-3");
    await expect(service.accept(
      blocked,
      { displayName: "Blocked", emailForDisplay: "blocked@example.com" },
      [{ normalizedEmail: "blocked@example.com", source: "google-oidc", verifiedAt: 900, expiresAt: 2_000, authenticationEventId: "auth-blocked" }],
      blockedInvitation.acceptUrl.split("/")[3]!,
    )).rejects.toMatchObject({ code: "PLATFORM_ACCESS_REQUIRED" });
    expect(await repository.getInvitation(blockedInvitation.invitationId, 1000)).toMatchObject({ status: "pending" });
    expect(await repository.getAccess(blocked)).toMatchObject({ status: "blocked", authorities: [] });

    const audit = await db.prepare("SELECT action, target_invitation_id, request_id FROM cas_platform_audit_events ORDER BY created_at, action").all();
    expect(audit.results).toEqual(expect.arrayContaining([
      { action: "platform_invitation.created", target_invitation_id: created.invitationId, request_id: "request-create" },
      { action: "platform_invitation.revoked", target_invitation_id: created.invitationId, request_id: "request-revoke" },
      { action: "platform_invitation.accepted", target_invitation_id: acceptedInvitation.invitationId, request_id: "request-accept" },
    ]));
    const auditService = new PlatformAuditService(repository, new PlatformAccessService(repository));
    const firstAuditPage = await auditService.list(actor, { limit: 2, createdAfter: 0 });
    expect(firstAuditPage.items).toHaveLength(2);
    expect(firstAuditPage.nextCursor).toEqual(expect.any(String));
    expect(firstAuditPage.items[0]!.createdAt).toBeGreaterThanOrEqual(firstAuditPage.items[1]!.createdAt);
    expect(JSON.stringify(firstAuditPage)).not.toMatch(/platform-token|sealed_token|session/i);
    const secondAuditPage = await auditService.list(actor, { limit: 2, createdAfter: 0, cursor: firstAuditPage.nextCursor! });
    expect(secondAuditPage.items.map(event => event.eventId)).not.toEqual(expect.arrayContaining(firstAuditPage.items.map(event => event.eventId)));
    const acceptedAudit = await auditService.list(actor, { action: "platform_invitation.accepted", limit: 10 });
    expect(acceptedAudit.items).toEqual([expect.objectContaining({
      actorPrincipalRef: access!.principalRef,
      targetPrincipalRef: access!.principalRef,
      targetInvitationId: acceptedInvitation.invitationId,
      requestId: "request-accept",
    })]);
    await expect(auditService.list(actor, { action: "platform_invitation.created", cursor: firstAuditPage.nextCursor! }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  }, 15_000);
});
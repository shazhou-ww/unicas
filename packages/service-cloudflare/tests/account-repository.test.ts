import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { AccountService } from "@unicas/service";
import { D1AccountRepository } from "../src/account-repository.js";
import { migrateControlSchema } from "../src/control-schema.js";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); runtime = undefined; });

async function fixture() {
  runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "account-repository-test",
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      compatibilityDate: "2025-08-17",
      d1Databases: { DB: "account-repository-test" },
    }],
  }));
  await runtime.ready;
  const db = await runtime.getD1Database("DB", "account-repository-test");
  await migrateControlSchema(db);
  const repository = new D1AccountRepository(db);
  return { db, repository, service: new AccountService(repository, () => 1000) };
}

describe("D1 Account repository", () => {
  test("creates and resolves one Account for an exact external identity", async () => {
    const { db, service } = await fixture();
    const created = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice",
      displayName: "Alice",
    });
    expect(created.account).toMatchObject({ blockedAt: null, credentialVersion: 1, primaryVerifiedEmail: null });
    expect(created.platformAuthorities).toEqual([]);
    expect(created.hasAppMembership).toBe(false);
    expect(await service.resolveExternalIdentity("https://accounts.google.com", "alice"))
      .toMatchObject({ account: { accountId: created.account.accountId } });
    expect(await db.prepare("SELECT display_name_source FROM cas_account_profiles").first())
      .toEqual({ display_name_source: created.authenticatedIdentity.externalIdentityId });
  });

  test("rejects a duplicate active identity without leaving an orphan Account", async () => {
    const { db, service } = await fixture();
    const input = { provider: "github" as const, issuer: "https://github.com", subject: "42" };
    await service.createForExternalIdentity(input);
    await expect(service.createForExternalIdentity(input)).rejects.toMatchObject({ code: "IDENTITY_LINK_CONFLICT" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_accounts").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_account_profiles").first()).toEqual({ count: 1 });
  });

  test("enforces credential version and current identity ownership", async () => {
    const { db, service } = await fixture();
    const created = await service.createForExternalIdentity({
      provider: "microsoft",
      issuer: "https://login.microsoftonline.com/consumers/v2.0",
      subject: "pairwise-subject",
    });
    await expect(service.authorizeCredential({
      accountId: created.account.accountId,
      externalIdentityId: created.authenticatedIdentity.externalIdentityId,
      credentialVersion: 1,
    })).resolves.toMatchObject({ account: { accountId: created.account.accountId } });
    await db.prepare("UPDATE cas_accounts SET credential_version = 2 WHERE account_id = ?")
      .bind(created.account.accountId).run();
    await expect(service.authorizeCredential({
      accountId: created.account.accountId,
      externalIdentityId: created.authenticatedIdentity.externalIdentityId,
      credentialVersion: 1,
    })).rejects.toMatchObject({ code: "CREDENTIAL_VERSION_MISMATCH" });
  });

  test("atomically links and unlinks identities while advancing credential version", async () => {
    const { db, repository, service } = await fixture();
    const created = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "alice",
    });
    const linked = await service.linkExternalIdentity({
      accountId: created.account.accountId,
      currentExternalIdentityId: created.authenticatedIdentity.externalIdentityId,
      credentialVersion: 1,
      currentAuthenticatedAt: 950,
      target: {
        provider: "github",
        issuer: "https://github.com",
        subject: "42",
        displayName: "Alice",
        avatarUrl: "https://avatars.githubusercontent.com/u/42",
        accountHint: "alice",
        verifiedEmailEvidence: [],
        authenticatedAt: 975,
        authenticationEventId: "github-auth",
      },
    });
    expect(linked.account.credentialVersion).toBe(2);
    const github = await repository.getActiveIdentity("https://github.com", "42");
    expect(github).toMatchObject({ accountId: created.account.accountId, provider: "github" });
    expect(await db.prepare(
      "SELECT display_name, display_name_source, avatar_source FROM cas_account_profiles WHERE account_id = ?",
    ).bind(created.account.accountId).first()).toMatchObject({
      display_name: "Alice",
      display_name_source: github!.externalIdentityId,
      avatar_source: github!.externalIdentityId,
    });

    const remaining = await service.unlinkExternalIdentity({
      accountId: created.account.accountId,
      credentialVersion: 2,
      targetExternalIdentityId: github!.externalIdentityId,
      remainingExternalIdentityId: created.authenticatedIdentity.externalIdentityId,
      remainingAuthenticatedAt: 990,
    });
    expect(remaining.account.credentialVersion).toBe(3);
    expect(await repository.getActiveIdentity("https://github.com", "42")).toBeNull();
    expect(await db.prepare(
      "SELECT display_name, display_name_source, avatar_url, avatar_source FROM cas_account_profiles WHERE account_id = ?",
    ).bind(created.account.accountId).first()).toEqual({
      display_name: null,
      display_name_source: null,
      avatar_url: null,
      avatar_source: null,
    });
    await expect(service.unlinkExternalIdentity({
      accountId: created.account.accountId,
      credentialVersion: 3,
      targetExternalIdentityId: created.authenticatedIdentity.externalIdentityId,
      remainingExternalIdentityId: created.authenticatedIdentity.externalIdentityId,
      remainingAuthenticatedAt: 995,
    })).rejects.toMatchObject({ code: "FINAL_IDENTITY_CANNOT_BE_UNLINKED" });
  });

  test("projects self profile and applies last-write-wins field updates", async () => {
    const { repository, service } = await fixture();
    const created = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "profile-user",
      displayName: "Initial Name",
      avatarUrl: "https://lh3.googleusercontent.com/avatar",
    });
    await expect(service.getSelf(
      created.account.accountId,
      created.authenticatedIdentity.externalIdentityId,
      ["google", "github"],
    )).resolves.toMatchObject({
      displayName: "Initial Name",
      avatar: { kind: "image", url: "https://lh3.googleusercontent.com/avatar", initials: "IN", colorIndex: expect.any(Number) },
      linkableProviders: ["github"],
    });
    await service.updateProfile({
      accountId: created.account.accountId,
      displayName: "User Choice",
      avatarExternalIdentityId: null,
    });
    await expect(service.getSelf(
      created.account.accountId,
      created.authenticatedIdentity.externalIdentityId,
      ["google", "github"],
    )).resolves.toMatchObject({
      displayName: "User Choice",
      avatar: { kind: "fallback", initials: "UC" },
    });
    await expect(service.updateProfile({
      accountId: created.account.accountId,
      avatarExternalIdentityId: "missing",
    })).rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND" });
    expect(await repository.getIdentity(created.authenticatedIdentity.externalIdentityId))
      .toMatchObject({ displayName: "Initial Name", avatarUrl: "https://lh3.googleusercontent.com/avatar" });
  });

  test("lists and atomically removes App members by Account ID", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "member-admin",
      displayName: "Member Admin",
    });
    const target = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "84",
      displayName: "Target User",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_a', 'App', '', 'active', 1, 1)",
    ).run();
    for (const member of [actor, target]) {
      await db.prepare(
        "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_a', ?, ?, 1, ?)",
      ).bind(
        member.authenticatedIdentity.issuer,
        member.authenticatedIdentity.subject,
        member.account.accountId,
      ).run();
    }

    const page = await service.listAppMembers({
      actorAccountId: actor.account.accountId,
      appId: "cas_app_a",
    });
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: expect.objectContaining({ accountId: actor.account.accountId, displayName: "Member Admin" }) }),
      expect.objectContaining({ account: expect.objectContaining({ accountId: target.account.accountId, displayName: "Target User" }) }),
    ]));
    await service.removeAppMember({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_a",
      targetAccountId: target.account.accountId,
      requestId: "request-1",
      traceId: "trace-1",
      callerChannel: "admin-webui",
    });
    expect(await db.prepare("SELECT account_id FROM cas_app_members").all()).toMatchObject({
      results: [{ account_id: actor.account.accountId }],
    });
    expect(await db.prepare(
      "SELECT target, original_account_id, external_identity_id FROM cas_control_audit_events WHERE action = 'member.removed'",
    ).first()).toEqual({
      target: target.account.accountId,
      original_account_id: actor.account.accountId,
      external_identity_id: actor.authenticatedIdentity.externalIdentityId,
    });
    await service.removeAppMember({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_a",
      targetAccountId: target.account.accountId,
    });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_control_audit_events WHERE action = 'member.removed'",
    ).first()).toEqual({ count: 1 });
    await expect(service.removeAppMember({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_a",
      targetAccountId: actor.account.accountId,
    })).rejects.toMatchObject({ code: "LAST_MEMBER" });
  });

  test("manages platform authorities and block state by Account ID", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "platform-admin",
      displayName: "Platform Admin",
    });
    const target = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "101",
      displayName: "Target Account",
    });
    await db.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 1)",
    ).bind(actor.account.accountId).run();

    await expect(service.listPlatformAccounts({ actorAccountId: actor.account.accountId }))
      .resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ accountId: actor.account.accountId, platformAuthorities: ["platform.admin"] }),
          expect.objectContaining({ accountId: target.account.accountId, effectiveAccess: "no_access" }),
        ])
      });
    await expect(service.getPlatformAccount(actor.account.accountId, target.account.accountId))
      .resolves.toMatchObject({ accountId: target.account.accountId, memberships: [] });

    await service.setPlatformAuthority({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: target.account.accountId,
      authority: "apps.create",
      grant: true,
    });
    await service.setPlatformAuthority({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: target.account.accountId,
      authority: "apps.create",
      grant: true,
    });
    await expect(service.getPlatformAccount(actor.account.accountId, target.account.accountId))
      .resolves.toMatchObject({ platformAuthorities: ["apps.create"] });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_platform_audit_events WHERE action = 'platform_access.authority_changed'",
    ).first()).toEqual({ count: 1 });

    await expect(service.setPlatformAuthority({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: actor.account.accountId,
      authority: "platform.admin",
      grant: false,
    })).rejects.toMatchObject({ code: "LAST_PLATFORM_ADMIN" });
    await expect(service.setPlatformBlocked({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: actor.account.accountId,
      blocked: true,
    })).rejects.toMatchObject({ code: "SELF_BLOCK_FORBIDDEN" });

    await service.setPlatformBlocked({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: target.account.accountId,
      blocked: true,
    });
    await service.setPlatformBlocked({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: target.account.accountId,
      blocked: true,
    });
    expect(await db.prepare(
      "SELECT blocked_at, credential_version FROM cas_accounts WHERE account_id = ?",
    ).bind(target.account.accountId).first()).toEqual({ blocked_at: 1000, credential_version: 2 });
    await expect(service.getPlatformAccount(actor.account.accountId, target.account.accountId))
      .resolves.toMatchObject({ effectiveAccess: "blocked" });
    await service.setPlatformBlocked({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      targetAccountId: target.account.accountId,
      blocked: false,
    });
    expect(await db.prepare(
      "SELECT blocked_at, credential_version FROM cas_accounts WHERE account_id = ?",
    ).bind(target.account.accountId).first()).toEqual({ blocked_at: null, credential_version: 2 });
  });

  test("projects privileged audit events by Account while retaining exact historical identity", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "audit-actor",
      displayName: "Audit Actor",
    });
    const target = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "202",
      displayName: "Audit Target",
    });
    await db.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'platform.admin', 1)",
    ).bind(actor.account.accountId).run();
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_a', 'App', '', 'active', 1, 1)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_a', ?, ?, 1, ?)",
    ).bind(actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();
    await db.prepare(
      `INSERT INTO cas_control_audit_events
        (event_id, app_id, identity_issuer, subject, action, target, created_at,
         original_account_id, external_identity_id, target_account_id)
       VALUES ('app-audit', 'cas_app_a', ?, ?, 'member.removed', ?, 10, ?, ?, ?)`,
    ).bind(
      actor.authenticatedIdentity.issuer,
      actor.authenticatedIdentity.subject,
      target.account.accountId,
      actor.account.accountId,
      actor.authenticatedIdentity.externalIdentityId,
      target.account.accountId,
    ).run();
    await db.prepare(
      `INSERT INTO cas_platform_audit_events
        (event_id, actor_issuer, actor_subject, action, result, created_at,
         actor_account_id, actor_external_identity_id, target_account_id)
       VALUES ('platform-audit', ?, ?, 'platform_access.blocked', 'succeeded', 11, ?, ?, ?)`,
    ).bind(
      actor.authenticatedIdentity.issuer,
      actor.authenticatedIdentity.subject,
      actor.account.accountId,
      actor.authenticatedIdentity.externalIdentityId,
      target.account.accountId,
    ).run();
    await db.prepare(
      "UPDATE cas_external_identities SET unlinked_at = 12 WHERE external_identity_id = ?",
    ).bind(actor.authenticatedIdentity.externalIdentityId).run();

    await expect(service.listAppAuditEvents({
      actorAccountId: actor.account.accountId,
      appId: "cas_app_a",
      query: { targetAccountId: target.account.accountId },
    })).resolves.toMatchObject({
      items: [{
        actorAccount: { accountId: actor.account.accountId },
        authenticatedIdentity: {
          externalIdentityId: actor.authenticatedIdentity.externalIdentityId,
          issuer: actor.authenticatedIdentity.issuer,
          subject: actor.authenticatedIdentity.subject,
        },
        targetAccount: { accountId: target.account.accountId },
      }]
    });
    await expect(service.listPlatformAuditEvents({
      actorAccountId: actor.account.accountId,
      query: { actorAccountId: actor.account.accountId, targetAccountId: target.account.accountId },
    })).resolves.toMatchObject({
      items: [{
        actorAccount: { accountId: actor.account.accountId },
        targetAccount: { accountId: target.account.accountId },
        authenticatedIdentity: { externalIdentityId: actor.authenticatedIdentity.externalIdentityId },
      }]
    });
  });
});
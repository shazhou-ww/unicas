import { afterEach, describe, expect, test } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { AccountService, sha256Hex } from "@unicas/service";
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

    await expect(service.listApps({ actorAccountId: actor.account.accountId })).resolves.toEqual({
      items: [expect.objectContaining({ appId: "cas_app_a", displayName: "App" })],
      nextCursor: null,
    });

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

  test("atomically creates an App for an authorized Account and replays by Account idempotency", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "app-creator",
    });
    await db.prepare(
      "INSERT INTO cas_account_platform_authorities (account_id, authority, granted_at) VALUES (?, 'apps.create', 1)",
    ).bind(actor.account.accountId).run();

    const created = await service.createApp({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      displayName: "Created App",
      idempotencyKey: "create-app",
      requestId: "request-create",
    });
    const replayed = await service.createApp({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      displayName: "Created App",
      idempotencyKey: "create-app",
    });
    expect(replayed.appId).toBe(created.appId);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_apps").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT account_id FROM cas_app_members WHERE app_id = ?").bind(created.appId).first())
      .toEqual({ account_id: actor.account.accountId });
    expect(await db.prepare(
      "SELECT action, original_account_id, external_identity_id FROM cas_control_audit_events WHERE app_id = ?",
    ).bind(created.appId).first()).toEqual({
      action: "app.created",
      original_account_id: actor.account.accountId,
      external_identity_id: actor.authenticatedIdentity.externalIdentityId,
    });
    await expect(service.createApp({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      displayName: "Changed",
      idempotencyKey: "create-app",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("reads and atomically patches an App through Account membership", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "app-editor",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_edit', 'App', 'Before', 'active', 1, 1)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_edit', ?, ?, 1, ?)",
    ).bind(actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();

    await expect(service.getApp(actor.account.accountId, "cas_app_edit")).resolves.toMatchObject({
      appId: "cas_app_edit",
      description: "Before",
      revision: 1,
    });
    await expect(service.patchApp({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_edit",
      patch: { description: "After", status: "suspended" },
      ifMatch: '\"1\"',
      requestId: "request-edit",
      callerChannel: "admin-webui",
    })).resolves.toBe(2);
    expect(await db.prepare(
      "SELECT description, status, revision FROM cas_apps WHERE app_id = 'cas_app_edit'",
    ).first()).toEqual({ description: "After", status: "suspended", revision: 2 });
    expect(await db.prepare(
      "SELECT action, original_account_id, external_identity_id FROM cas_control_audit_events WHERE app_id = 'cas_app_edit'",
    ).first()).toEqual({
      action: "app.suspended",
      original_account_id: actor.account.accountId,
      external_identity_id: actor.authenticatedIdentity.externalIdentityId,
    });
    await expect(service.patchApp({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_edit",
      patch: { description: "Stale" },
      ifMatch: '\"1\"',
    })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect(await db.prepare(
      "SELECT description, revision FROM cas_apps WHERE app_id = 'cas_app_edit'",
    ).first()).toEqual({ description: "After", revision: 2 });
  });

  test("reads and atomically updates a managed issuer through Account membership", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "issuer-editor",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_issuer', 'App', '', 'active', 1, 1)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_issuer', ?, ?, 1, ?)",
    ).bind(actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();
    await db.prepare(
      `INSERT INTO cas_app_managed_issuers
        (app_id, issuer, audience, metadata_url, authorization_endpoint,
         token_endpoint, jwks_uri, scopes_supported, code_challenge_methods_supported,
         status, verified_at, jwks_digest, capability_max_lifetime_seconds, revision)
       VALUES ('cas_app_issuer', 'https://cas.example/managed-issuers/cas_app_issuer',
         'https://cas.example/stacks/cas_app_issuer', 'https://cas.example/metadata',
         'https://cas.example/authorize', 'https://cas.example/token',
         'https://cas.example/jwks', '["cas:manage"]', '["S256"]',
         'active', 1, 'digest', 3600, 4)`,
    ).run();

    await expect(service.getManagedOAuthIssuer(actor.account.accountId, "cas_app_issuer"))
      .resolves.toMatchObject({ appId: "cas_app_issuer", status: "active", revision: 4 });
    await expect(service.patchManagedOAuthIssuer({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_issuer",
      enabled: false,
      ifMatch: '"4"',
      requestId: "request-issuer",
      callerChannel: "admin-webui",
    })).resolves.toMatchObject({ status: "disabled", revision: 5 });
    expect(await db.prepare(
      "SELECT status, revision FROM cas_app_managed_issuers WHERE app_id = 'cas_app_issuer'",
    ).first()).toEqual({ status: "disabled", revision: 5 });
    expect(await db.prepare(
      "SELECT action, original_account_id, external_identity_id FROM cas_control_audit_events WHERE app_id = 'cas_app_issuer'",
    ).first()).toEqual({
      action: "managed_issuer.disabled",
      original_account_id: actor.account.accountId,
      external_identity_id: actor.authenticatedIdentity.externalIdentityId,
    });

    await expect(service.patchManagedOAuthIssuer({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_issuer",
      enabled: true,
      ifMatch: '"4"',
    })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect(await db.prepare(
      "SELECT status, revision FROM cas_app_managed_issuers WHERE app_id = 'cas_app_issuer'",
    ).first()).toEqual({ status: "disabled", revision: 5 });
  });

  test("atomically inspects and activates an external issuer for an Account member", async () => {
    const { db, repository } = await fixture();
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid: "issuer-key", alg: "ES256" };
    const service = new AccountService(repository, () => 1000, null, {
      oauthResourcePublicOrigin: "https://cas.example",
      generateOAuthInspectionId: () => "inspection-account",
      generateNonce: () => "nonce-account",
      oauthDiscovery: {
        inspectIssuer: async () => ({
          metadata: {
            issuer: "https://issuer.example",
            metadataUrl: "https://issuer.example/.well-known/openid-configuration",
            metadataType: "oidc" as const,
            authorizationEndpoint: "https://issuer.example/authorize",
            tokenEndpoint: "https://issuer.example/token",
            jwksUri: "https://issuer.example/jwks",
            registrationEndpoint: null,
            scopesSupported: ["openid"],
            codeChallengeMethodsSupported: ["S256"],
          },
          metadataDigest: "metadata-digest",
          jwksDigest: "jwks-digest",
          keys: [{ kid: "issuer-key", algorithm: "ES256" as const, publicJwk }],
        }),
      },
    });
    const actor = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "issuer-owner",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_external', 'App', '', 'active', 1, 1)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_external', ?, ?, 1, ?)",
    ).bind(actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();

    const inspection = await service.inspectAppOAuthIssuer({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_external",
      issuer: "https://issuer.example",
      callerChannel: "admin-webui",
    });
    const proof = await new CompactSign(new TextEncoder().encode(inspection.challenge))
      .setProtectedHeader({ alg: "ES256", kid: "issuer-key" })
      .sign(privateKey);
    await expect(service.activateAppOAuthIssuer({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_external",
      inspectionId: inspection.inspectionId,
      activationProof: proof,
      ifNoneMatch: "*",
      callerChannel: "admin-webui",
    })).resolves.toBe(1);
    expect(await db.prepare(
      "SELECT issuer, status, revision FROM cas_app_oauth_issuers WHERE app_id = 'cas_app_external'",
    ).first()).toEqual({ issuer: "https://issuer.example", status: "active", revision: 1 });
    expect(await db.prepare(
      "SELECT action, original_account_id, external_identity_id FROM cas_control_audit_events WHERE action = 'oauth_issuer.activated'",
    ).first()).toEqual({
      action: "oauth_issuer.activated",
      original_account_id: actor.account.accountId,
      external_identity_id: actor.authenticatedIdentity.externalIdentityId,
    });
    await expect(service.activateAppOAuthIssuer({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_external",
      inspectionId: inspection.inspectionId,
      activationProof: proof,
      ifMatch: '"1"',
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await db.prepare(
      "SELECT revision FROM cas_app_oauth_issuers WHERE app_id = 'cas_app_external'",
    ).first()).toEqual({ revision: 1 });
  });

  test("lists, expires, and revokes App invitations for an Account member", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: "invitation-owner",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_invites', 'App', '', 'active', 1, 1)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_invites', ?, ?, 1, ?)",
    ).bind(actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();
    await db.prepare(
      `INSERT INTO cas_app_member_invitations
        (invitation_id, app_id, status, email_constraint, token_hash, expires_at, created_at, revision)
       VALUES ('inv-expired', 'cas_app_invites', 'pending', 'old@example.com', 'old-hash', 999, 1, 1),
         ('inv-pending', 'cas_app_invites', 'pending', 'new@example.com', 'new-hash', 2000, 1, 3)`,
    ).run();

    await expect(service.listAppMemberInvitations({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_invites",
      status: "pending",
      callerChannel: "admin-webui",
    })).resolves.toMatchObject({ items: [{ invitationId: "inv-pending", revision: 3 }] });
    expect(await db.prepare(
      "SELECT status, revision FROM cas_app_member_invitations WHERE invitation_id = 'inv-expired'",
    ).first()).toEqual({ status: "expired", revision: 2 });
    expect(await service.revokeAppMemberInvitation({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_invites",
      invitationId: "inv-pending",
      ifMatch: '"3"',
      callerChannel: "admin-webui",
    })).toBe(4);
    expect(await db.prepare(
      "SELECT status, revision FROM cas_app_member_invitations WHERE invitation_id = 'inv-pending'",
    ).first()).toEqual({ status: "revoked", revision: 4 });
    expect(await db.prepare(
      `SELECT action, original_account_id, external_identity_id
       FROM cas_control_audit_events WHERE target IN ('inv-expired', 'inv-pending') ORDER BY action`,
    ).all()).toMatchObject({
      results: [
        { action: "member.invitation.expired", original_account_id: actor.account.accountId, external_identity_id: actor.authenticatedIdentity.externalIdentityId },
        { action: "member.invitation.revoked", original_account_id: actor.account.accountId, external_identity_id: actor.authenticatedIdentity.externalIdentityId },
      ]
    });
    await expect(service.revokeAppMemberInvitation({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_invites",
      invitationId: "inv-pending",
      ifMatch: '"3"',
    })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
  });

  test("creates App invitations with Account-scoped D1 idempotency", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "invitation-creator",
    });
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_invite_create', 'App', '', 'active', 1, 1)",
    ).run();
    await db.prepare(
      "INSERT INTO cas_app_members (app_id, identity_issuer, subject, joined_at, account_id) VALUES ('cas_app_invite_create', ?, ?, 1, ?)",
    ).bind(actor.authenticatedIdentity.issuer, actor.authenticatedIdentity.subject, actor.account.accountId).run();

    const created = await service.createAppMemberInvitation({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_invite_create",
      emailConstraint: " Invitee@Example.com ",
      idempotencyKey: "invite-once",
      callerChannel: "admin-webui",
    });
    const replayed = await service.createAppMemberInvitation({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_invite_create",
      emailConstraint: "invitee@example.com",
      idempotencyKey: "invite-once",
    });
    expect(replayed).toEqual(created);
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM cas_app_member_invitations WHERE app_id = 'cas_app_invite_create'",
    ).first()).toEqual({ count: 1 });
    expect(await db.prepare(
      `SELECT account_id, app_id, idempotency_key
       FROM cas_account_app_invitation_idempotency`,
    ).first()).toEqual({
      account_id: actor.account.accountId,
      app_id: "cas_app_invite_create",
      idempotency_key: "invite-once",
    });
    expect(await db.prepare(
      "SELECT email_constraint FROM cas_app_member_invitations WHERE app_id = 'cas_app_invite_create'",
    ).first()).toEqual({ email_constraint: "invitee@example.com" });
    await expect(service.createAppMemberInvitation({
      actorAccountId: actor.account.accountId,
      actorExternalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      appId: "cas_app_invite_create",
      emailConstraint: "other@example.com",
      idempotencyKey: "invite-once",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("accepts an App invitation into stable Account membership without Principal writes", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "microsoft",
      issuer: "https://login.microsoftonline.com/consumers/v2.0",
      subject: "pairwise-invitee",
    });
    const token = "m".repeat(32);
    const tokenHash = await sha256Hex(token);
    await db.prepare(
      "INSERT INTO cas_apps (app_id, display_name, description, status, created_at, revision) VALUES ('cas_app_accept', 'App', '', 'active', 1, 1)",
    ).run();
    await db.prepare(
      `INSERT INTO cas_app_member_invitations
        (invitation_id, app_id, status, email_constraint, token_hash, expires_at, created_at, revision)
       VALUES ('inv-accept', 'cas_app_accept', 'pending', 'invitee@example.com', ?, 2000, 1, 1)`,
    ).bind(tokenHash).run();
    await db.prepare(
      `INSERT INTO cas_email_challenges
        (challenge_id, invitation_kind, invitation_id, invitation_token_hash,
         identity_issuer, subject, authentication_event_id, normalized_email,
         code_hash, expires_at, max_attempts, last_sent_at, verified_at, created_at)
       VALUES ('challenge-accept', 'app', 'inv-accept', ?, ?, ?, 'auth-event',
         'invitee@example.com', ?, 1500, 5, 900, 950, 900)`,
    ).bind(
      tokenHash,
      actor.authenticatedIdentity.issuer,
      actor.authenticatedIdentity.subject,
      "a".repeat(64),
    ).run();

    await expect(service.acceptAppMemberInvitation({
      accountId: actor.account.accountId,
      externalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      token,
      verifiedEmailEvidence: [{
        normalizedEmail: "invitee@example.com",
        source: "unicas-email-challenge",
        verifiedAt: 950,
        expiresAt: 1500,
        authenticationEventId: "auth-event",
        challengeId: "challenge-accept",
      }],
      callerChannel: "admin-webui",
    })).resolves.toBe("cas_app_accept");
    expect(await db.prepare(
      "SELECT account_id FROM cas_app_members WHERE app_id = 'cas_app_accept'",
    ).first()).toEqual({ account_id: actor.account.accountId });
    expect(await db.prepare(
      "SELECT status, revision FROM cas_app_member_invitations WHERE invitation_id = 'inv-accept'",
    ).first()).toEqual({ status: "accepted", revision: 2 });
    expect(await db.prepare(
      "SELECT consumed_at FROM cas_email_challenges WHERE challenge_id = 'challenge-accept'",
    ).first()).toEqual({ consumed_at: 1000 });
    expect(await db.prepare(
      "SELECT primary_verified_email, email_verification_source FROM cas_accounts WHERE account_id = ?",
    ).bind(actor.account.accountId).first()).toEqual({
      primary_verified_email: "invitee@example.com",
      email_verification_source: "unicas-email-challenge",
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_operator_identities").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM cas_platform_principals").first()).toEqual({ count: 0 });
  });

  test("records session audit with stable Account and exact ExternalIdentity", async () => {
    const { db, service } = await fixture();
    const actor = await service.createForExternalIdentity({
      provider: "github",
      issuer: "https://github.com",
      subject: "session-owner",
    });
    await service.recordSessionAudit({
      accountId: actor.account.accountId,
      externalIdentityId: actor.authenticatedIdentity.externalIdentityId,
      action: "session.login",
      callerChannel: "admin-webui",
    });
    expect(await db.prepare(
      `SELECT action, original_account_id, external_identity_id, identity_issuer, subject
       FROM cas_control_audit_events WHERE action = 'session.login'`,
    ).first()).toEqual({
      action: "session.login",
      original_account_id: actor.account.accountId,
      external_identity_id: actor.authenticatedIdentity.externalIdentityId,
      identity_issuer: "https://github.com",
      subject: "session-owner",
    });
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